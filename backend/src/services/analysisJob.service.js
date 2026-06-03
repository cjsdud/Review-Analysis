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

export function createPendingJob({ analysisId, uploadId, userId, totalReviews, isSample }) {
  db.prepare(
    `INSERT INTO analysis_jobs
       (id, upload_id, status, summary, user_id, is_sample, progress, total_reviews)
     VALUES (?, ?, 'pending', ?, ?, ?, 0, ?)`,
  ).run(analysisId, uploadId, JSON.stringify({}), userId || null, isSample ? 1 : 0, totalReviews);
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
export function updateProgress(analysisId, progress) {
  const p = Math.max(0, Math.min(100, Math.round(progress)));
  setStatus(analysisId, { progress: p });
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
}) {
  try {
    markProcessing(analysisId);
    updateProgress(analysisId, 20);

    const { summary, products, classifications } = await runAnalysis(
      reviews,
      corrections,
      { planCode, userId, analysisId },
    );
    // 과거 사용자 분류 수정 이력 반영 — user_corrections 테이블 참조.
    applyHistoricalCorrectionsLocal(products);

    updateProgress(analysisId, 80);

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

    if (userId) recordUsage(userId, 'analysis_created', { analysisId, uploadId });
    // 분석 완료 후 임시 파싱 데이터 제거
    db.prepare('UPDATE upload_files SET rows = NULL, sheet_parse_results = NULL WHERE id = ?').run(uploadId);
  } catch (e) {
    console.error('[analysisJob] failed', analysisId, e);
    markFailed(analysisId, e.message);
  }
}

// 단일 row → API 응답 shape.
export function getJobStatus(analysisId) {
  const row = db.prepare(
    `SELECT id, status, progress, total_reviews, error_message,
            created_at, started_at, completed_at, failed_at, user_id
     FROM analysis_jobs WHERE id = ?`,
  ).get(analysisId);
  if (!row) return null;
  // legacy 데이터 호환 — 'done' / 'error' 도 신 status 처럼 보여준다.
  const status = row.status === STATUS.LEGACY_DONE ? STATUS.COMPLETED
    : row.status === STATUS.LEGACY_ERROR ? STATUS.FAILED
    : row.status;
  return {
    id: row.id,
    status,
    progress: row.progress ?? (status === STATUS.COMPLETED ? 100 : 0),
    totalReviews: row.total_reviews,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    userId: row.user_id,
  };
}

export const STATUSES = STATUS;

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
