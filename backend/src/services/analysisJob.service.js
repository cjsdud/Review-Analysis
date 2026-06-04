// 분석 비동기 job 러너.
// 업로드 API 가 reviews 길이를 보고 즉시 analysis_jobs 에 pending row 를 만든 뒤,
// setImmediate 로 이 함수를 호출하면 status 를 processing → completed/failed 로
// 직접 전이시킨다.
//
// 현재는 in-process 백그라운드 (Node event loop). 장기 TODO:
//   - BullMQ/Redis 큐 도입
//   - Render Background Worker 서비스 분리
//   - 서버 재시작 시 processing 상태 복구 (DB 의 stale processing 을 failed 로)
//   - 재시도 정책 + 분석 취소
import db from '../db/database.js';
import { runAnalysis } from './productAnalysis.service.js';
import { recordUsage } from './billing.service.js';

const STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  // backward compat — 과거 데이터엔 'done' / 'error' 가 들어가 있음.
  LEGACY_DONE: 'done',
  LEGACY_ERROR: 'error',
});

export function createPendingJob({ analysisId, uploadId, userId, totalReviews, isSample, analysisMode = null }) {
  db.prepare(
    `INSERT INTO analysis_jobs
       (id, upload_id, status, summary, user_id, is_sample, progress, total_reviews, analysis_mode)
     VALUES (?, ?, 'pending', ?, ?, ?, 0, ?, ?)`,
  ).run(
    analysisId, uploadId, JSON.stringify({}),
    userId || null, isSample ? 1 : 0, totalReviews, analysisMode,
  );
}

function setStatus(analysisId, fields) {
  const cols = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    cols.push(`${k} = ?`);
    params.push(v);
  }
  if (!cols.length) return;
  params.push(analysisId);
  db.prepare(`UPDATE analysis_jobs SET ${cols.join(', ')} WHERE id = ?`).run(...params);
}

export function markProcessing(analysisId) {
  setStatus(analysisId, {
    status: STATUS.PROCESSING,
    progress: 5,
    started_at: new Date().toISOString(),
  });
}

export function markCompleted(analysisId, summaryJson) {
  setStatus(analysisId, {
    status: STATUS.COMPLETED,
    progress: 100,
    summary: summaryJson,
    completed_at: new Date().toISOString(),
  });
}

export function markFailed(analysisId, errorMessage) {
  setStatus(analysisId, {
    status: STATUS.FAILED,
    error_message: String(errorMessage || 'Unknown error').slice(0, 1000),
    failed_at: new Date().toISOString(),
  });
}

// 단계형 progress 업데이트 — runAnalysis 가 내부적으로 호출할 콜백.
// 절대 감소하지 않음 (DB 현재 값보다 작으면 무시) — 단계 콜백 + 외부 markProcessing
// 호출이 섞여도 progress 가 뒤로 가는 것처럼 보이지 않게.
//
// progress 외에 step / processedReviews / totalReviews / processedProducts /
// totalProducts / processedLlmTasks / totalLlmTasks 같은 보조 정보를 함께 받아
// progress_step / progress_meta 컬럼에 함께 저장한다. 사용자에게는
// "분석 중 25%" 만 보이지 않고 "리뷰 반응을 분류하고 있어요 240/500" 같은
// 단계 문구가 같이 표시된다.
//
// 호출자가 step 만 바꾸고 progress 는 그대로인 경우에도 (예: 같은 25% 에서 LLM
// 진입) DB 업데이트를 한 번 더 해 줘 progress_updated_at 이 갱신되고,
// 프론트가 다음 polling 때 새 step 문구를 받을 수 있게 한다.
export function updateProgress(analysisId, progressOrPayload, maybeStep, maybeMeta) {
  const payload = typeof progressOrPayload === 'object' && progressOrPayload !== null
    ? progressOrPayload
    : { progress: progressOrPayload, step: maybeStep, meta: maybeMeta };
  const p = Math.max(0, Math.min(100, Math.round(Number(payload.progress) || 0)));
  const row = db.prepare('SELECT progress, status FROM analysis_jobs WHERE id = ?').get(analysisId);
  if (!row) return;
  if (row.status === STATUS.COMPLETED || row.status === STATUS.FAILED) return;
  const fields = { progress_updated_at: new Date().toISOString() };
  if (p > (row.progress ?? 0)) fields.progress = p;
  if (payload.step) fields.progress_step = String(payload.step).slice(0, 64);
  // meta — 명시적 키만 추려 저장 (제3자 입력 안전).
  const meta = pickMeta(payload);
  if (meta) fields.progress_meta = JSON.stringify(meta);
  setStatus(analysisId, fields);
}

function pickMeta(payload) {
  const out = {};
  for (const k of ['processedReviews', 'totalReviews', 'processedProducts', 'totalProducts', 'processedLlmTasks', 'totalLlmTasks']) {
    if (payload[k] != null && Number.isFinite(Number(payload[k]))) out[k] = Number(payload[k]);
  }
  return Object.keys(out).length ? out : null;
}

// 중앙 progress reporter — 호출자(runAnalysis / classifyAll / maybeMiniReanalyze)는
// payload({progress, step, processed*, total*}) 만 넘기고 throttle / DB 저장은 여기서.
//
// throttle 규칙:
//   - progress 가 실제로 증가한 경우       → 즉시 저장
//   - step 만 바뀐 경우                    → 즉시 저장 (사용자가 새 문구를 보길 원함)
//   - 같은 progress + 같은 step + 5s 이내  → skip (DB 부담 방지)
//
// DB 업데이트 실패해도 분석 전체는 깨지지 않는다 — 안에서 try/catch.
export function createAnalysisProgressReporter({ analysisId, capProgress = 95 }) {
  const state = { lastProgress: 0, lastStep: null, lastPersistedAt: 0 };
  return async function report(payload = {}) {
    try {
      const next = Math.max(state.lastProgress, Math.min(capProgress, Math.round(Number(payload.progress) || 0)));
      const step = payload.step || payload.progressStep || null;
      const now = Date.now();
      const progressGrew = next > state.lastProgress;
      const stepChanged = step && step !== state.lastStep;
      const tooSoon = now - state.lastPersistedAt < 5000;
      if (!progressGrew && !stepChanged && tooSoon) return;
      state.lastProgress = next;
      if (step) state.lastStep = step;
      state.lastPersistedAt = now;
      updateProgress(analysisId, { ...payload, progress: next, step });
      console.info(`[ReviewFit Progress] id=${analysisId} progress=${next} step=${step || '-'}`
        + (payload.processedReviews != null ? ` reviews=${payload.processedReviews}/${payload.totalReviews ?? '?'}` : '')
        + (payload.processedProducts != null ? ` products=${payload.processedProducts}/${payload.totalProducts ?? '?'}` : '')
        + (payload.processedLlmTasks != null ? ` llm=${payload.processedLlmTasks}/${payload.totalLlmTasks ?? '?'}` : ''),
      );
    } catch (e) {
      console.warn(`[ReviewFit Progress] persist failed id=${analysisId}: ${e.message}`);
    }
  };
}

// heartbeat — 실제 progress 가 멈춰 있어도 8초마다 1%씩 올려 사용자에게 "분석이
// 멈췄다" 느낌을 주지 않게 한다. capProgress(기본 92) 까지만 올리고 실제 reporter
// 가 먼저 도달했으면 더 올리지 않는다.
//
// 사용:
//   const stop = startProgressHeartbeat(analysisId);
//   try { ... } finally { stop(); }
export function startProgressHeartbeat(analysisId, { capProgress = 92, intervalMs = 8000 } = {}) {
  const timer = setInterval(() => {
    try {
      const row = db.prepare('SELECT progress, status FROM analysis_jobs WHERE id = ?').get(analysisId);
      if (!row) return;
      if (row.status === STATUS.COMPLETED || row.status === STATUS.FAILED) {
        clearInterval(timer);
        return;
      }
      const cur = row.progress ?? 0;
      if (cur >= capProgress) return;
      // 실제 진행이 늦는 단계에서만 +1. 너무 빠르게 올라가지 않게 한다.
      setStatus(analysisId, { progress: cur + 1, progress_updated_at: new Date().toISOString() });
    } catch (e) {
      console.warn(`[ReviewFit Progress] heartbeat failed id=${analysisId}: ${e.message}`);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

// 백그라운드 분석 실행 — 업로드 라우트가 setImmediate 로 한 번 호출하고 forget.
// 모든 예외를 catch 해서 status=failed 로 저장 — 처리 안 되는 promise rejection
// 으로 새는 일이 없도록.
export async function runAnalysisJob({
  analysisId,
  uploadId,
  userId,
  reviews,
  corrections,
  planCode,
  isSample,
  analysisMode = null,
}) {
  // 중앙 reporter — runAnalysis 내부 단계 + LLM task 단위 progress 를 한 곳에서 throttle/저장.
  // capProgress=95 — 마지막 DB 저장 + markCompleted(100%) 를 위한 헤드룸 5%.
  const reportProgress = createAnalysisProgressReporter({ analysisId, capProgress: 95 });
  // 긴 LLM 호출 동안 progress 가 멈춘 것처럼 보이지 않도록 heartbeat 추가.
  // 실제 reporter 가 더 빠르게 진행하면 heartbeat 는 영향 없음 (DB 의 현재 progress 기준).
  const stopHeartbeat = startProgressHeartbeat(analysisId);
  try {
    markProcessing(analysisId);
    await reportProgress({ progress: 8, step: 'job_started', totalReviews: reviews.length });
    // runAnalysis 가 자체 단계별 progress (10/25/45/55/60/60~85/92) 를 onProgress 로
    // 보낸다. 추가로 classifyAll / maybeMiniReanalyze / 상품 루프 / LLM task 진행률을
    // 같은 reporter 로 통일. 캡 95 까지 허용 — DB 저장 후 markCompleted 가 100% 로 마감.
    const { summary, products, classifications } = await runAnalysis(
      reviews,
      corrections,
      {
        planCode, userId, analysisId, analysisMode,
        onProgress: reportProgress,
      },
    );
    // 과거 사용자 분류 수정 이력 반영 — user_corrections 테이블 참조.
    applyHistoricalCorrectionsLocal(products);

    await reportProgress({ progress: 95, step: 'saving_report' });

    summary.isSample = Boolean(isSample);

    const insertPa = db.prepare(
      'INSERT INTO product_analyses (id, analysis_id, product_key, product_name, data, user_id) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertCls = db.prepare(
      'INSERT INTO review_classifications (id, analysis_id, review_pk, sentiment, categories, user_id) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const tx = db.transaction(() => {
      products.forEach((p, i) =>
        insertPa.run(`${analysisId}_${i}`, analysisId, p.productKey, p.productName, JSON.stringify(p), userId),
      );
      classifications.forEach((c, i) =>
        insertCls.run(`${analysisId}_c${i}`, analysisId, c.reviewId, c.sentiment, JSON.stringify(c.categories), userId),
      );
    });
    tx();

    markCompleted(analysisId, JSON.stringify(summary));
    // completed 도 step 으로 명시 — UI 가 100% + "분석이 완료됐어요" 함께 표시.
    setStatus(analysisId, { progress_step: 'completed', progress_updated_at: new Date().toISOString() });

    if (userId) recordUsage(userId, 'analysis_created', { analysisId, uploadId });
    // 분석 완료 후 임시 파싱 데이터 제거
    db.prepare('UPDATE upload_files SET rows = NULL, sheet_parse_results = NULL WHERE id = ?').run(uploadId);
  } catch (e) {
    console.error('[analysisJob] failed', analysisId, e);
    markFailed(analysisId, e.message);
  } finally {
    stopHeartbeat();
  }
}

// 단일 row → API 응답 shape.
export function getJobStatus(analysisId) {
  const row = db.prepare(
    `SELECT id, status, progress, progress_step, progress_meta, progress_updated_at,
            total_reviews, error_message,
            created_at, started_at, completed_at, failed_at, user_id, analysis_mode
     FROM analysis_jobs WHERE id = ?`,
  ).get(analysisId);
  if (!row) return null;
  // legacy 데이터 호환 — 'done' / 'error' 도 신 status 처럼 보여준다.
  const status = row.status === STATUS.LEGACY_DONE ? STATUS.COMPLETED
    : row.status === STATUS.LEGACY_ERROR ? STATUS.FAILED
    : row.status;
  let progressMeta = null;
  try { progressMeta = row.progress_meta ? JSON.parse(row.progress_meta) : null; } catch { progressMeta = null; }
  return {
    id: row.id,
    status,
    progress: row.progress ?? (status === STATUS.COMPLETED ? 100 : 0),
    progressStep: row.progress_step || (status === STATUS.COMPLETED ? 'completed' : null),
    progressMeta,
    progressUpdatedAt: row.progress_updated_at || null,
    totalReviews: row.total_reviews,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    userId: row.user_id,
    analysisMode: row.analysis_mode || null,
  };
}

export const STATUSES = STATUS;

// 서버 시작 시 호출 — in-process background job 이라서 재시작/배포/crash 가
// 일어나면 status='processing' 인 row 가 영원히 그 상태로 남는다. 일정 시간
// 이상 진행 중인 row 를 일괄로 failed 로 전환해 관리자/사용자에게 명시.
// 막 생성된 row (예: 부팅 직전 1분 안) 는 보호한다.
//
// env:
//   ANALYSIS_STALE_PROCESSING_MINUTES (기본 30)
//   ENABLE_ANALYSIS_STARTUP_RECOVERY (기본 true, 'false' 면 skip)
//
// 장기 TODO: BullMQ/Redis 큐 + Render Background Worker 분리 시 이 함수는
// 사라지고 큐 retry 정책으로 대체.
export function recoverStaleAnalysisJobs() {
  if (String(process.env.ENABLE_ANALYSIS_STARTUP_RECOVERY || 'true').toLowerCase() === 'false') {
    console.info('[analysisJob] startup recovery disabled');
    return { recovered: 0 };
  }
  const minutes = Math.max(1, Number(process.env.ANALYSIS_STALE_PROCESSING_MINUTES || 30));
  // SQLite datetime('now', '-X minutes') — created_at 이 cutoff 이전이면 stale.
  const stale = db.prepare(
    `SELECT id FROM analysis_jobs
     WHERE status IN (?, ?)
       AND created_at < datetime('now', ?)`,
  ).all(STATUS.PENDING, STATUS.PROCESSING, `-${minutes} minutes`);
  if (!stale.length) return { recovered: 0 };
  const msg = '서버 재시작 또는 작업 중단으로 분석이 완료되지 않았습니다. 다시 분석을 실행해 주세요.';
  const tx = db.transaction(() => {
    for (const r of stale) {
      db.prepare(
        `UPDATE analysis_jobs SET status = ?, error_message = ?, failed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(STATUS.FAILED, msg, r.id);
    }
  });
  tx();
  console.info(`[analysisJob] startup recovery — marked ${stale.length} stale row(s) as failed (cutoff=${minutes}m)`);
  return { recovered: stale.length };
}

// 관리자 콘솔 — pending/processing/completed/failed 카운트 + 최근 실패/진행 목록.
export function getAnalysisStatusSummary({ recentLimit = 5 } = {}) {
  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'pending'    THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN status IN ('completed','done') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status IN ('failed','error')   THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS last24h
     FROM analysis_jobs`,
  ).get();
  const recentFailed = db.prepare(
    `SELECT j.id, j.error_message, j.failed_at, j.created_at,
            u.original_name AS file_name, usr.email AS user_email
       FROM analysis_jobs j
       LEFT JOIN upload_files u ON u.id = j.upload_id
       LEFT JOIN users usr ON usr.id = j.user_id
      WHERE j.status IN ('failed', 'error')
      ORDER BY COALESCE(j.failed_at, j.created_at) DESC
      LIMIT ?`,
  ).all(recentLimit);
  const recentProcessing = db.prepare(
    `SELECT j.id, j.progress, j.started_at, j.created_at,
            u.original_name AS file_name, usr.email AS user_email
       FROM analysis_jobs j
       LEFT JOIN upload_files u ON u.id = j.upload_id
       LEFT JOIN users usr ON usr.id = j.user_id
      WHERE j.status IN ('pending', 'processing')
      ORDER BY j.created_at DESC
      LIMIT ?`,
  ).all(recentLimit);
  return {
    pendingCount: Number(counts?.pending || 0),
    processingCount: Number(counts?.processing || 0),
    completedCount: Number(counts?.completed || 0),
    failedCount: Number(counts?.failed || 0),
    last24hCount: Number(counts?.last24h || 0),
    recentFailed: recentFailed.map((r) => ({
      id: r.id, fileName: r.file_name, userEmail: r.user_email,
      errorMessage: r.error_message, failedAt: r.failed_at || r.created_at,
    })),
    recentProcessing: recentProcessing.map((r) => ({
      id: r.id, fileName: r.file_name, userEmail: r.user_email,
      progress: r.progress ?? 0, startedAt: r.started_at, createdAt: r.created_at,
    })),
  };
}

// 관리자 retry — failed analysis 를 다시 pending → background job 으로.
// 정책 결정:
//   · completed 는 retry 불가 (관리자가 정말 필요하면 별도 강제 기능 추가)
//   · processing 은 중복 실행 차단
//   · 사용자 plan 사용량은 재차감 X (테스트/복구 목적). LLM token usage 는 실제 호출되면
//     기존 경로(recordLlmUsage) 가 자동 기록.
export async function retryAnalysisJob(analysisId) {
  const job = db.prepare(
    'SELECT id, upload_id, user_id, status, is_sample FROM analysis_jobs WHERE id = ?',
  ).get(analysisId);
  if (!job) return { ok: false, status: 404, error: '분석을 찾을 수 없습니다.' };
  if (job.status === 'processing' || job.status === 'pending') {
    return { ok: false, status: 409, error: '이미 진행 중인 분석은 다시 실행할 수 없습니다.' };
  }
  // 입력 데이터 — upload_files.rows 는 분석 완료 시 NULL 처리되므로 review_classifications
  // 가 살아 있을 때만 가능. 여기서는 raw reviews 가 필요한데 그건 보존되지 않을 수
  // 있으므로 caller (라우트) 에게 reviews loader 를 요청한다.
  // 이 함수는 "재실행 가능 여부" 만 판단하고 실제 job 시작은 호출 측에서.
  return { ok: true, job };
}

// user_corrections 테이블에서 (productKey, original) → corrected 매핑을 만든다.
// 회귀: 기존 analysis.routes.js 의 buildHistoricalCorrectionMap 와 동일한 로직 —
// 비동기 job 흐름으로 옮기면서 route 모듈에 순환 의존을 만들지 않도록 인라인.
function buildHistoricalCorrectionMap() {
  const rows = db.prepare('SELECT review_pk, categories FROM user_corrections ORDER BY created_at').all();
  const map = new Map();
  for (const r of rows) {
    let p;
    try { p = JSON.parse(r.categories); } catch { continue; }
    const productKey = p?.productKey || r.review_pk;
    const oc = p?.original?.category;
    const ol = p?.original?.issueLabel;
    const cc = p?.corrected?.category;
    const cl = p?.corrected?.issueLabel;
    if (!productKey || !oc || !ol || !cc || !cl) continue;
    map.set(`${productKey}||${oc}||${ol}`, { category: cc, issueLabel: cl });
  }
  return map;
}

function applyHistoricalCorrectionsLocal(products) {
  const map = buildHistoricalCorrectionMap();
  if (map.size === 0) return;
  for (const p of products) {
    for (const iss of p.topIssues) {
      const hit = map.get(`${p.productKey}||${iss.category}||${iss.issueLabel}`);
      if (!hit) continue;
      iss.category = hit.category;
      iss.issueLabel = hit.issueLabel;
      iss.source = 'correction';
      iss.confidence = 0.95;
    }
  }
}
