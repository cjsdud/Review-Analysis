import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import db from '../db/database.js';
import { runAnalysis } from '../services/productAnalysis.service.js';
import { buildAnalysisCsv, buildAnalysisWorkbook } from '../services/export.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { checkCanCreateAnalysis, recordUsage } from '../services/billing.service.js';
import { serializeReviewForList, sentimentOf } from '../services/reviewHighlights.service.js';

const router = Router();

// 소유권 확인: row.user_id 와 req.user.id 가 같아야 통과. 둘 다 null 이면 익명 데모로 허용.
function assertOwnership(req, res, row, ownerField = 'user_id') {
  const ownerId = row[ownerField] || null;
  const reqId = req.user?.id || null;
  if (ownerId === reqId) return true;
  res.status(403).json({ error: 'FORBIDDEN', message: '이 분석에 접근할 권한이 없습니다.' });
  return false;
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
function loadAllCorrections() {
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
function applyHistoricalCorrections(products) {
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

function loadReviews(uploadId) {
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

// POST /api/analysis — 분석 실행 (로그인 필요 / 익명 데모는 환경변수로 허용)
router.post('/', requireAuth, async (req, res) => {
  const schema = z.object({ uploadId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'uploadId가 필요합니다.' });

  // 업로드 소유권 확인
  const upload = db.prepare('SELECT id, original_name, user_id FROM upload_files WHERE id = ?').get(parsed.data.uploadId);
  if (!upload) return res.status(404).json({ error: '업로드를 찾을 수 없습니다.' });
  if (!assertOwnership(req, res, upload)) return;

  const reviews = loadReviews(parsed.data.uploadId);
  if (!reviews.length) return res.status(400).json({ error: '정규화된 리뷰가 없습니다. 먼저 컬럼 매핑을 완료하세요.' });

  // 플랜 제한 확인 (BILLING_ENFORCE_LIMITS=true 일 때만 실제 차단)
  const userId = req.user?.id || null;
  const guard = checkCanCreateAnalysis(userId, reviews.length);
  if (!guard.ok) return res.status(guard.status).json(guard.body);

  try {
    const allCorrections = loadAllCorrections();
    const { analysisId, summary, products, classifications } = await runAnalysis(reviews, allCorrections);
    applyHistoricalCorrections(products);

    // 샘플 판별 표준: source === 'sample' 우선. 과거 데이터 호환을 위해 우리가
    // 고정으로 사용하는 sample 파일명 매칭은 fallback.
    summary.isSample =
      upload.source === 'sample' ||
      (upload.original_name || '').toLowerCase() === 'sample_reviews_fashion.csv';

    db.prepare(
      'INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id, is_sample) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(analysisId, parsed.data.uploadId, 'done', JSON.stringify(summary), userId, summary.isSample ? 1 : 0);

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

    // 사용량 기록 (로그인 사용자만; 익명은 기록 안 함)
    if (userId) recordUsage(userId, 'analysis_created', { analysisId, uploadId: parsed.data.uploadId });

    // 분석 완료 후 임시 파싱 데이터 제거
    db.prepare('UPDATE upload_files SET rows = NULL, sheet_parse_results = NULL WHERE id = ?').run(
      parsed.data.uploadId,
    );

    res.json({ analysisId, summary });
  } catch (e) {
    console.error('[analysis] error', e);
    res.status(500).json({ error: `분석 중 오류: ${e.message}` });
  }
});

// GET /api/analysis/:id — 전체 결과 (히스토리 재조회용).
// summary 외에 products(상품별 분석 결과 JSON 배열)와 createdAt 을 함께 반환해
// 사용자가 히스토리에서 특정 분석을 다시 열 수 있게 한다.
router.get('/:id', requireAuth, (req, res) => {
  const job = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '분석 결과를 찾을 수 없습니다.' });
  if (!assertOwnership(req, res, job)) return;
  const productRows = db
    .prepare('SELECT data FROM product_analyses WHERE analysis_id = ?')
    .all(req.params.id);
  const products = productRows.map((r) => JSON.parse(r.data));
  res.json({
    analysisId: job.id,
    status: job.status,
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
