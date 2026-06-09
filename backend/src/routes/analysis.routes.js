import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import db from '../db/database.js';
import { runAnalysis } from '../services/productAnalysis.service.js';
import {
  createPendingJob,
  runAnalysisJob,
  getJobStatus,
} from '../services/analysisJob.service.js';
import {
  canUseAnalysisMode,
  defaultAnalysisModeFor,
  getAnalysisMode,
} from '../constants/analysisModes.js';
import { buildAnalysisCsv, buildAnalysisWorkbook } from '../services/export.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { checkCanCreateAnalysis, getUserSubscription, recordUsage } from '../services/billing.service.js';
import { serializeReviewForList, sentimentOf } from '../services/reviewHighlights.service.js';
import { buildPeriodComparisonAnalysis, buildRuleBasedPeriodSummary, PERIOD_MODES } from '../services/periodComparison.service.js';
import { getPlanFeatures, normalizePlan } from '../constants/plans.js';
import { deleteAnalysisCascade } from '../services/dataLifecycle.service.js';

const router = Router();

// 소유권 확인: row.user_id 와 req.user.id 가 같아야 통과.
//
// 보안 메모: 과거에는 "둘 다 null 이면 익명 데모로 허용" 패턴이었으나, 익명 모드
// (DEMO_ALLOW_ANONYMOUS=true) 에서 모든 익명 사용자의 req.user 가 null 이라
// null === null 비교가 통과되어 익명 사용자 A 가 익명 사용자 B 의 analysisId 만
// 알면 B 의 마스킹 리뷰까지 조회할 수 있었다.
// 이제는 양쪽이 모두 null 인 경우는 명시적으로 차단한다 (익명 → 익명 접근 불허).
// 익명 데모는 read-only 정적 페이지(/demo/sample-report) 중심으로 유지.
function assertOwnership(req, res, row, ownerField = 'user_id') {
  const ownerId = row[ownerField] || null;
  const reqId = req.user?.id || null;
  if (!reqId) {
    res.status(401).json({ error: 'AUTH_REQUIRED', message: '이 분석을 보려면 로그인이 필요합니다.' });
    return false;
  }
  if (ownerId !== reqId) {
    res.status(403).json({ error: 'FORBIDDEN', message: '이 분석에 접근할 권한이 없습니다.' });
    return false;
  }
  return true;
}

// 저장된 사용자 수정(user_corrections)을 상품 분석 결과에 반영.
// 입력: product(ProductAnalysis), corrections([{original,corrected}]).
// 출력: topIssues의 category/issueLabel을 수정값으로 치환하고 source='user' 표시한 product.
function applyCorrections(product, corrections) {
  if (!corrections.length) return product;
  const issues = product.topIssues.map((iss) => {
    const hit = corrections.find(
      (c) => c.original?.category === iss.category && c.original?.issueLabel === iss.issueLabel,
    );
    if (!hit) return iss;
    return {
      ...iss,
      category: hit.corrected?.category || iss.category,
      issueLabel: hit.corrected?.issueLabel || iss.issueLabel,
      source: 'user',
      corrected: true,
    };
  });
  return { ...product, topIssues: issues };
}

function loadCorrections(analysisId, productKey) {
  const rows = db
    .prepare('SELECT categories FROM user_corrections WHERE analysis_id = ? AND review_pk = ? ORDER BY created_at')
    .all(analysisId, productKey);
  return rows.map((r) => JSON.parse(r.categories));
}

// 전체 user_corrections payload 배열을 그대로 로드 (review-level 적용용).
export function loadAllCorrections() {
  const rows = db.prepare('SELECT review_pk, categories FROM user_corrections ORDER BY created_at').all();
  const out = [];
  for (const r of rows) {
    try {
      const p = JSON.parse(r.categories);
      const productKey = p?.productKey || r.review_pk;
      if (productKey && p?.original?.category && p?.original?.issueLabel && p?.corrected?.category && p?.corrected?.issueLabel) {
        out.push({ productKey, original: p.original, corrected: p.corrected });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

// 전체 user_corrections 를 (productKey, origCategory, origIssueLabel) → corrected 로 색인.
function buildHistoricalCorrectionMap() {
  const rows = db.prepare('SELECT review_pk, categories FROM user_corrections ORDER BY created_at').all();
  const map = new Map();
  for (const r of rows) {
    let p;
    try {
      p = JSON.parse(r.categories);
    } catch {
      continue;
    }
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

// runAnalysis 직후 호출. products[].topIssues 중 과거에 사용자가 수정한 항목과 일치하면
// 수정된 category/issueLabel 로 치환하고 source='correction', confidence=0.95.
export function applyHistoricalCorrections(products) {
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

export function loadReviews(uploadId) {
  const rows = db.prepare('SELECT * FROM reviews WHERE upload_id = ?').all(uploadId);
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    storeId: r.store_id,
    productName: r.product_name,
    optionName: r.option_name,
    rating: r.rating ?? undefined,
    title: r.title || undefined,
    content: r.content,
    writer: r.writer || undefined,
    createdAt: r.created_at || undefined,
    replyText: r.reply_text || undefined,
    reviewId: r.review_id || undefined,
  }));
}

// POST /api/analysis — 분석 *시작* (요청 시점에는 완료를 기다리지 않음).
// pending row 만 만든 뒤 즉시 analysisId 를 반환하고, 실제 분석은 setImmediate 로
// background 에서 진행. 프론트는 GET /:id/status 로 polling 한다.
// 60초 timeout 회피 + LLM 호출 시간 무관하게 UI 가 안 죽도록 한 핵심 변경.
router.post('/', requireAuth, async (req, res) => {
  const schema = z.object({
    uploadId: z.string().min(1),
    // 사용자가 업로드 화면에서 고른 분석 방식 (선택). 없으면 플랜 기본값 사용.
    analysisMode: z.enum(['quick', 'standard', 'precision', 'advanced', 'batch']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'uploadId가 필요합니다.' });

  const upload = db.prepare('SELECT id, original_name, user_id, source FROM upload_files WHERE id = ?').get(parsed.data.uploadId);
  if (!upload) return res.status(404).json({ error: '업로드를 찾을 수 없습니다.' });
  if (!assertOwnership(req, res, upload)) return;

  const reviews = loadReviews(parsed.data.uploadId);
  if (!reviews.length) return res.status(400).json({ error: '정규화된 리뷰가 없습니다. 먼저 컬럼 매핑을 완료하세요.' });

  const userId = req.user?.id || null;
  const guard = checkCanCreateAnalysis(userId, reviews.length);
  if (!guard.ok) return res.status(guard.status).json(guard.body);

  // 분석 방식 결정 — 사용자가 안 골랐으면 플랜 기본값. 플랜에 허용 안 되면 403.
  // ※ req.user.plan 이 아니라 DB 의 subscriptions 를 매번 다시 조회 — 관리자가
  //   막 plan 을 바꿔도 다음 분석 요청부터 즉시 반영. JWT 페이로드의 stale plan
  //   을 절대 신뢰하지 않는다.
  const sub = userId ? getUserSubscription(userId) : null;
  const planCode = (await import('../constants/plans.js')).normalizePlan(sub?.plan_code || 'free');
  const requestedMode = parsed.data.analysisMode || defaultAnalysisModeFor(planCode);
  console.info(
    `[ReviewFit Plan] userId=${userId || 'anon'} dbPlan=${planCode} requestedMode=${requestedMode} allowed=${canUseAnalysisMode(planCode, requestedMode)}`,
  );
  if (!canUseAnalysisMode(planCode, requestedMode)) {
    const mode = getAnalysisMode(requestedMode);
    return res.status(403).json({
      success: false,
      code: 'ANALYSIS_MODE_NOT_ALLOWED',
      message: `현재 플랜에서는 ${mode?.label || requestedMode}을(를) 사용할 수 없어요. ${mode?.minPlan === 'business' ? 'Business' : mode?.minPlan === 'pro' ? 'Pro' : 'Starter'} 이상에서 사용할 수 있습니다.`,
      upgradeRequired: true,
      requiredPlan: mode?.minPlan || 'starter',
    });
  }

  // 1) pending row 즉시 생성 — 프론트가 polling 할 id 를 응답.
  const analysisId = nanoid();
  const isSample =
    upload.source === 'sample' ||
    (upload.original_name || '').toLowerCase() === 'sample_reviews_fashion.csv';
  try {
    createPendingJob({
      analysisId,
      uploadId: parsed.data.uploadId,
      userId,
      totalReviews: reviews.length,
      isSample,
      analysisMode: requestedMode,
    });
  } catch (e) {
    return res.status(500).json({ error: `분석 작업 생성 실패: ${e.message}` });
  }

  // 2) background 분석 실행 — fire-and-forget. runAnalysisJob 내부에서 모든
  // 예외를 catch 해 status=failed 로 저장하므로 process 가 죽을 일 없음.
  const allCorrections = loadAllCorrections();
  setImmediate(() => {
    runAnalysisJob({
      analysisId,
      uploadId: parsed.data.uploadId,
      userId,
      reviews,
      corrections: allCorrections,
      planCode,
      isSample,
      analysisMode: requestedMode,
    }).catch((e) => console.error('[analysis] background error', e));
  });

  // 3) 즉시 응답 — 프론트는 /history 로 이동해서 status polling.
  res.json({
    success: true,
    analysisId,
    status: 'processing',
    message: '리뷰 분석을 시작했어요. 완료되면 분석 히스토리에서 확인할 수 있습니다.',
  });
});

// GET /api/analysis/:id/status — 분석 job 상태 (프론트 polling 용).
// 본인 분석만 조회 가능. completed 면 reportReady=true.
router.get('/:id/status', requireAuth, (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;
  const job = getJobStatus(req.params.id);
  if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: '분석을 찾을 수 없습니다.' });
  res.json({
    success: true,
    analysis: {
      ...job,
      reportReady: job.status === 'completed',
    },
  });
});

// GET /api/analysis/:id — 전체 결과 (히스토리 재조회용).
// summary 외에 products(상품별 분석 결과 JSON 배열)와 createdAt 을 함께 반환해
// 사용자가 히스토리에서 특정 분석을 다시 열 수 있게 한다.
router.get('/:id', requireAuth, (req, res) => {
  const job = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '분석 결과를 찾을 수 없습니다.' });
  if (!assertOwnership(req, res, job)) return;

  // completed/done(legacy) 가 아니면 진행 중 / 실패 응답 — 프론트 대시보드가
  // undefined report 에 깨지지 않도록.
  const isReady = job.status === 'completed' || job.status === 'done';
  if (!isReady) {
    return res.status(202).json({
      analysisId: job.id,
      status: job.status,
      progress: job.progress ?? 0,
      errorMessage: job.error_message || null,
      message: job.status === 'failed'
        ? '리뷰 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.'
        : '리뷰 분석 중입니다. 분석이 완료되면 리포트를 확인할 수 있어요.',
    });
  }

  const productRows = db
    .prepare('SELECT data FROM product_analyses WHERE analysis_id = ?')
    .all(req.params.id);
  const products = productRows.map((r) => JSON.parse(r.data));
  res.json({
    analysisId: job.id,
    status: 'completed',
    progress: 100,
    analysisMode: job.analysis_mode || null,
    summary: JSON.parse(job.summary),
    products,
    createdAt: job.created_at,
  });
});

// 소유권 확인 헬퍼 — analysis_id 만 있을 때 사용 (products/products:key/export.csv/corrections 공용)
function assertAnalysisOwnership(req, res) {
  const job = db.prepare('SELECT user_id FROM analysis_jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    res.status(404).json({ error: '분석 결과를 찾을 수 없습니다.' });
    return false;
  }
  return assertOwnership(req, res, job);
}

// GET /api/analysis/:id/products — 상품 목록 (대시보드용 요약)
router.get('/:id/products', requireAuth, (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;
  const rows = db.prepare('SELECT data FROM product_analyses WHERE analysis_id = ?').all(req.params.id);
  if (!rows.length) return res.status(404).json({ error: '상품 분석 결과가 없습니다.' });
  const products = rows.map((r) => JSON.parse(r.data));
  res.json(
    products.map((p) => ({
      productKey: p.productKey,
      productName: p.productName,
      totalReviews: p.totalReviews,
      negativeReviews: p.negativeReviews,
      negativeRatio: p.negativeRatio,
      positiveReviews: p.positiveReviews,
      neutralReviews: p.neutralReviews,
      sentimentCounts: p.sentimentCounts,
      sentimentRatios: p.sentimentRatios,
      issueReviewCount: p.issueReviewCount,
      totalIssueCount: p.totalIssueCount,
      issueRatio: p.issueRatio,
      averageRating: p.averageRating,
      productStatus: p.productStatus,
      topIssue: p.topIssues?.[0] || null,
    })),
  );
});

// GET /api/analysis/:id/products/:productKey — 상품 상세 (저장된 사용자 수정 반영)
router.get('/:id/products/:productKey', requireAuth, (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;
  // 비동기 job — 아직 진행 중이면 product_analyses 가 비어 있다. 친절한 안내로 분기.
  const jobRow = db.prepare('SELECT status, error_message FROM analysis_jobs WHERE id = ?').get(req.params.id);
  if (jobRow && jobRow.status !== 'completed' && jobRow.status !== 'done') {
    return res.status(202).json({
      status: jobRow.status,
      message: jobRow.status === 'failed'
        ? '리뷰 분석에 실패했습니다.'
        : '리뷰 분석 중입니다. 분석이 완료되면 리포트를 확인할 수 있어요.',
      errorMessage: jobRow.error_message || null,
    });
  }
  const row = db
    .prepare('SELECT data FROM product_analyses WHERE analysis_id = ? AND product_key = ?')
    .get(req.params.id, req.params.productKey);
  if (!row) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
  const product = JSON.parse(row.data);
  const corrections = loadCorrections(req.params.id, req.params.productKey);
  res.json(applyCorrections(product, corrections));
});

// GET /api/analysis/:id/reviews — 전체 보기용 리뷰 리스트 (sentiment/filter/sort/pagination)
// query:
//   sentiment=positive|neutral|negative|all (기본 all)
//   hasIssue=true|false
//   productName=...   keyword=...   rating=1-5   source=...
//   sort=latest|oldest|ratingDesc|ratingAsc|issuesDesc (기본 latest)
//   limit=20 (max 100), offset=0
router.get('/:id/reviews', requireAuth, (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;

  // product_analyses 에 저장된 product.reviews 를 모아 전체 리뷰 리스트를 구성한다.
  // (uploads.rows 는 분석 후 NULL 처리되어 있을 수 있으므로 product_analyses 가 정답)
  const productRows = db
    .prepare('SELECT data FROM product_analyses WHERE analysis_id = ?')
    .all(req.params.id);
  let allReviews = [];
  for (const pr of productRows) {
    try {
      const p = JSON.parse(pr.data);
      if (Array.isArray(p.reviews)) allReviews = allReviews.concat(p.reviews);
    } catch { /* skip corrupt */ }
  }

  // 필터
  const q = req.query;
  const sentiment = (q.sentiment || 'all').toLowerCase();
  const hasIssueFilter = q.hasIssue === 'true' ? true : q.hasIssue === 'false' ? false : null;
  const productName = (q.productName || '').trim().toLowerCase();
  const keyword = (q.keyword || '').trim().toLowerCase();
  const rating = q.rating != null && q.rating !== '' ? Number(q.rating) : null;
  const source = (q.source || '').trim();
  const category = (q.category || '').trim();
  const issueLabel = (q.issueLabel || '').trim();

  let filtered = allReviews;
  if (sentiment !== 'all') {
    filtered = filtered.filter((r) => (r.sentiment || 'neutral') === sentiment);
  }
  if (hasIssueFilter !== null) {
    filtered = filtered.filter((r) => {
      const has = (r.detectedIssues || []).some((i) => i.isActionableIssue !== false && i.category !== '기타');
      return hasIssueFilter ? has : !has;
    });
  }
  // 차트 클릭 등으로 카테고리/이슈 사전 필터가 들어오면 detectedIssues 기준으로 매칭.
  // 카테고리는 공백 차이만 허용 (정규화는 최소화 — 다른 이슈가 섞이지 않도록).
  if (category) {
    const cat = category.replace(/\s+/g, '').toLowerCase();
    filtered = filtered.filter((r) =>
      (r.detectedIssues || []).some(
        (i) => (i.category || '').replace(/\s+/g, '').toLowerCase() === cat,
      ),
    );
  }
  if (issueLabel) {
    const lbl = issueLabel.replace(/\s+/g, '').toLowerCase();
    filtered = filtered.filter((r) =>
      (r.detectedIssues || []).some((i) => {
        const v = (i.issue || i.issueLabel || '').replace(/\s+/g, '').toLowerCase();
        return v === lbl;
      }),
    );
  }
  if (productName) filtered = filtered.filter((r) => (r.productName || '').toLowerCase().includes(productName));
  if (keyword)     filtered = filtered.filter((r) => (`${r.title || ''} ${r.content || ''}`).toLowerCase().includes(keyword));
  if (rating != null && !Number.isNaN(rating)) filtered = filtered.filter((r) => r.rating === rating);
  if (source)      filtered = filtered.filter((r) => (r.source || '') === source);

  // 정렬
  const sort = q.sort || 'latest';
  const cmpDate = (a, b, dir = 1) => dir * String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  const issueCount = (r) => (r.detectedIssues || []).filter((i) => i.isActionableIssue !== false).length;
  if (sort === 'oldest')      filtered = [...filtered].sort((a, b) => -cmpDate(a, b));
  else if (sort === 'ratingDesc') filtered = [...filtered].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  else if (sort === 'ratingAsc')  filtered = [...filtered].sort((a, b) => (a.rating ?? 99) - (b.rating ?? 99));
  else if (sort === 'issuesDesc') filtered = [...filtered].sort((a, b) => issueCount(b) - issueCount(a));
  else                            filtered = [...filtered].sort((a, b) => cmpDate(a, b));

  const limit = Math.max(1, Math.min(Number(q.limit) || 20, 100));
  const offset = Math.max(0, Number(q.offset) || 0);
  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);
  res.json({ items, total, limit, offset });
});

// GET /api/analysis/:id/period-comparison — 기간별 리뷰 반응 변화.
//
// Pro 이상 전용. 기본은 recent_30_vs_previous_30, 다른 모드는 query 로:
//   ?mode=recent_30_vs_previous_30 | recent_90_vs_previous_90 | custom | monthly_trend | weekly_trend
//   ?currentStart=YYYY-MM-DD&currentEnd=YYYY-MM-DD&previousStart=...&previousEnd=...  (custom 전용)
//
// 응답: periodComparison shape (locked / unavailable / available 중 하나).
router.get('/:id/period-comparison', requireAuth, async (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;

  const job = db.prepare('SELECT user_id, status FROM analysis_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '분석 결과를 찾을 수 없습니다.' });
  if (job.status !== 'completed' && job.status !== 'done') {
    return res.status(202).json({
      available: false,
      locked: false,
      reason: 'analysis_in_progress',
      message: '리뷰 분석이 완료되면 기간별 변화도 함께 확인할 수 있어요.',
    });
  }

  // 사용자 플랜 확인 — DB 의 subscriptions 를 매번 다시 조회 (관리자 직접 변경 즉시 반영).
  const userId = req.user?.id || null;
  const sub = userId ? getUserSubscription(userId) : null;
  const planCode = normalizePlan(sub?.plan_code || 'free');
  const features = getPlanFeatures(planCode);
  const allowed = features.periodComparison === true;
  if (!allowed) {
    return res.status(200).json({
      available: false,
      locked: true,
      requiredPlan: 'pro',
      reason: 'plan_locked',
      message: '기간별 리뷰 변화 분석은 Pro 이상에서 사용할 수 있어요.',
    });
  }

  // products 로드. productKey query 가 있으면 해당 상품만 — 상품 상세 페이지의
  // 기간별 변화 섹션 전용. 없으면 전체 (대시보드).
  const q = req.query || {};
  const productKey = (q.productKey || '').trim();
  let productRows;
  if (productKey) {
    productRows = db
      .prepare('SELECT data FROM product_analyses WHERE analysis_id = ? AND product_key = ?')
      .all(req.params.id, productKey);
  } else {
    productRows = db
      .prepare('SELECT data FROM product_analyses WHERE analysis_id = ?')
      .all(req.params.id);
  }
  const products = productRows.map((r) => JSON.parse(r.data));
  if (productKey && !products.length) {
    return res.status(404).json({
      available: false,
      locked: false,
      reason: 'product_not_found',
      message: '해당 상품의 분석 결과를 찾을 수 없어요.',
    });
  }

  const requestedMode = String(q.mode || PERIOD_MODES.RECENT_30_VS_PREVIOUS_30);
  const validModes = Object.values(PERIOD_MODES);
  const mode = validModes.includes(requestedMode) ? requestedMode : PERIOD_MODES.RECENT_30_VS_PREVIOUS_30;
  const customOpts = mode === PERIOD_MODES.CUSTOM
    ? {
        currentStart: String(q.currentStart || ''),
        currentEnd: String(q.currentEnd || ''),
        previousStart: String(q.previousStart || ''),
        previousEnd: String(q.previousEnd || ''),
      }
    : {};

  // 동적 계산 — 매 요청마다 fresh.
  const comparison = buildPeriodComparisonAnalysis(products, {
    planCode,
    periodComparisonAllowed: true,
    mode,
    ...customOpts,
  });

  // 요약은 기본으로 rule 기반이 들어와 있다 — custom/주차/월별 모드에선 LLM 재호출 비용을
  // 피하기 위해 rule 기반 그대로 사용. 기본 recent30 요약은 analysis 저장 시 LLM 결과가
  // summary 안에 박혀 있다 (대시보드 첫 진입 응답).
  if (comparison.available && !comparison.summary) {
    comparison.summary = buildRuleBasedPeriodSummary(comparison);
  }
  res.json(comparison);
});

// GET /api/analysis/:id/export.csv — CSV 다운로드 (fallback / 단순 통합본)
router.get('/:id/export.csv', requireAuth, (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;
  const rows = db.prepare('SELECT data FROM product_analyses WHERE analysis_id = ?').all(req.params.id);
  if (!rows.length) return res.status(404).json({ error: '분석 결과가 없습니다.' });
  const products = rows.map((r) => JSON.parse(r.data));
  const csv = buildAnalysisCsv(products);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="review-analysis-${req.params.id}.csv"`);
  res.send(csv);
});

// GET /api/analysis/:id/export.xlsx — 사용자용 다중 시트 엑셀 리포트.
// query: productKey (있으면 해당 상품만 — 상품 상세 리포트용)
router.get('/:id/export.xlsx', requireAuth, async (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;
  const job = db.prepare('SELECT summary FROM analysis_jobs WHERE id = ?').get(req.params.id);
  let summary = {};
  try { summary = job?.summary ? JSON.parse(job.summary) : {}; } catch { summary = {}; }

  const productKey = (req.query.productKey || '').trim();
  let rows;
  if (productKey) {
    rows = db
      .prepare('SELECT data FROM product_analyses WHERE analysis_id = ? AND product_key = ?')
      .all(req.params.id, productKey);
  } else {
    rows = db.prepare('SELECT data FROM product_analyses WHERE analysis_id = ?').all(req.params.id);
  }
  if (!rows.length) return res.status(404).json({ error: '분석 결과가 없습니다.' });
  const products = rows.map((r) => JSON.parse(r.data));

  const date = new Date().toISOString().slice(0, 10);
  // 한글 파일명은 RFC 5987 filename* 로 인코딩 (브라우저 호환).
  const baseName = productKey
    ? `ReviewFit_상품상세리포트_${products[0]?.productName || productKey}_${date}.xlsx`
    : `ReviewFit_전체리포트_${date}.xlsx`;
  const buf = await buildAnalysisWorkbook(products, summary, {
    analysisDate: date,
    productName: productKey ? products[0]?.productName : undefined,
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="review-report-${req.params.id}.xlsx"; filename*=UTF-8''${encodeURIComponent(baseName)}`,
  );
  res.send(buf);
});

const correctionSchema = z.object({
  productKey: z.string().min(1),
  category: z.string().min(1), // 원래 카테고리
  issueLabel: z.string().min(1), // 원래 세부 이슈
  newCategory: z.string().min(1), // 수정 카테고리
  newIssueLabel: z.string().min(1), // 수정 세부 이슈
  reviewIds: z.array(z.string()).optional(),
});

// POST /api/analysis/:id/corrections — 사용자 분류 수정 저장
// 재학습은 추후. 지금은 수정값을 user_corrections에 저장하고 상세 조회 시 반영한다.
router.post('/:id/corrections', requireAuth, (req, res) => {
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '수정 형식이 올바르지 않습니다.', detail: parsed.error.issues });

  if (!assertAnalysisOwnership(req, res)) return;

  const { productKey, category, issueLabel, newCategory, newIssueLabel, reviewIds } = parsed.data;
  const id = nanoid();
  const payload = {
    productKey,
    original: { category, issueLabel },
    corrected: { category: newCategory, issueLabel: newIssueLabel },
    reviewIds: reviewIds || [],
  };
  db.prepare('INSERT INTO user_corrections (id, analysis_id, review_pk, categories, user_id) VALUES (?, ?, ?, ?, ?)').run(
    id,
    req.params.id,
    productKey,
    JSON.stringify(payload),
    req.user?.id || null,
  );
  res.json({ ok: true, correctionId: id, corrected: payload.corrected });
});

// DELETE /api/analysis/:id — 본인 분석 결과를 cascade 삭제.
// 권한:
//   - requireAuth (로그인 필수)
//   - 본인 소유가 아니면 403 (assertAnalysisOwnership)
//   - processing/pending 상태(IN_PROGRESS)는 409 — 진행 중 분석은 background job 이 row 를 다시 쓸 수 있어 차단.
// 응답:
//   200 { ok:true, message, counts:{...} }
//   404 / 403 / 409 / 401
router.delete('/:id', requireAuth, (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;
  const userId = req.user?.id || null;
  const result = deleteAnalysisCascade(req.params.id, userId);
  if (!result.ok) {
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND', message: '분석 결과를 찾을 수 없습니다.' });
    if (result.error === 'FORBIDDEN') return res.status(403).json({ error: 'FORBIDDEN', message: '이 분석에 접근할 권한이 없습니다.' });
    if (result.error === 'IN_PROGRESS') {
      return res.status(409).json({
        error: 'IN_PROGRESS',
        message: '분석이 진행 중인 항목은 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    return res.status(500).json({ error: 'DELETE_FAILED', message: '분석 결과 삭제 중 일시적인 문제가 있었어요.' });
  }
  res.json({ ok: true, message: '분석 결과가 삭제되었습니다.', counts: result.counts });
});

// GET /api/analysis/:id/corrections — 저장된 수정 목록 (검토/추후 반영용)
router.get('/:id/corrections', requireAuth, (req, res) => {
  if (!assertAnalysisOwnership(req, res)) return;
  const rows = db
    .prepare('SELECT id, review_pk, categories, created_at FROM user_corrections WHERE analysis_id = ? ORDER BY created_at DESC')
    .all(req.params.id);
  res.json(
    rows.map((r) => ({ id: r.id, productKey: r.review_pk, ...JSON.parse(r.categories), createdAt: r.created_at })),
  );
});

export default router;
