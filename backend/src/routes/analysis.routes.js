import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import db from '../db/database.js';
import { runAnalysis } from '../services/productAnalysis.service.js';
import { buildAnalysisCsv } from '../services/export.service.js';

const router = Router();

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

// POST /api/analysis — 분석 실행
router.post('/', async (req, res) => {
  const schema = z.object({ uploadId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'uploadId가 필요합니다.' });

  const reviews = loadReviews(parsed.data.uploadId);
  if (!reviews.length) return res.status(400).json({ error: '정규화된 리뷰가 없습니다. 먼저 컬럼 매핑을 완료하세요.' });

  try {
    const { analysisId, summary, products, classifications } = await runAnalysis(reviews);

    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary) VALUES (?, ?, ?, ?)').run(
      analysisId,
      parsed.data.uploadId,
      'done',
      JSON.stringify(summary),
    );

    const insertPa = db.prepare(
      'INSERT INTO product_analyses (id, analysis_id, product_key, product_name, data) VALUES (?, ?, ?, ?, ?)',
    );
    const insertCls = db.prepare(
      'INSERT INTO review_classifications (id, analysis_id, review_pk, sentiment, categories) VALUES (?, ?, ?, ?, ?)',
    );
    const tx = db.transaction(() => {
      products.forEach((p, i) =>
        insertPa.run(`${analysisId}_${i}`, analysisId, p.productKey, p.productName, JSON.stringify(p)),
      );
      classifications.forEach((c, i) =>
        insertCls.run(`${analysisId}_c${i}`, analysisId, c.reviewId, c.sentiment, JSON.stringify(c.categories)),
      );
    });
    tx();

    // 분석 완료 후 더 이상 필요 없는 파싱 rows 제거 (PII 잔존 최소화)
    db.prepare('UPDATE upload_files SET rows = NULL WHERE id = ?').run(parsed.data.uploadId);

    res.json({ analysisId, summary });
  } catch (e) {
    console.error('[analysis] error', e);
    res.status(500).json({ error: `분석 중 오류: ${e.message}` });
  }
});

// GET /api/analysis/:id — 전체 결과
router.get('/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '분석 결과를 찾을 수 없습니다.' });
  res.json({ analysisId: job.id, status: job.status, summary: JSON.parse(job.summary) });
});

// GET /api/analysis/:id/products — 상품 목록
router.get('/:id/products', (req, res) => {
  const rows = db.prepare('SELECT data FROM product_analyses WHERE analysis_id = ?').all(req.params.id);
  if (!rows.length) return res.status(404).json({ error: '상품 분석 결과가 없습니다.' });
  const products = rows.map((r) => JSON.parse(r.data));
  // 목록은 요약 정보만
  res.json(
    products.map((p) => ({
      productKey: p.productKey,
      productName: p.productName,
      totalReviews: p.totalReviews,
      negativeReviews: p.negativeReviews,
      issueReviewCount: p.issueReviewCount,
      totalIssueCount: p.totalIssueCount,
      averageRating: p.averageRating,
      topIssue: p.topIssues[0] || null,
    })),
  );
});

// GET /api/analysis/:id/products/:productKey — 상품 상세 (저장된 사용자 수정 반영)
router.get('/:id/products/:productKey', (req, res) => {
  const row = db
    .prepare('SELECT data FROM product_analyses WHERE analysis_id = ? AND product_key = ?')
    .get(req.params.id, req.params.productKey);
  if (!row) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
  const product = JSON.parse(row.data);
  const corrections = loadCorrections(req.params.id, req.params.productKey);
  res.json(applyCorrections(product, corrections));
});

// GET /api/analysis/:id/export.csv — CSV 다운로드
router.get('/:id/export.csv', (req, res) => {
  const rows = db.prepare('SELECT data FROM product_analyses WHERE analysis_id = ?').all(req.params.id);
  if (!rows.length) return res.status(404).json({ error: '분석 결과가 없습니다.' });
  const products = rows.map((r) => JSON.parse(r.data));
  const csv = buildAnalysisCsv(products);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="review-analysis-${req.params.id}.csv"`);
  res.send(csv);
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
router.post('/:id/corrections', (req, res) => {
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '수정 형식이 올바르지 않습니다.', detail: parsed.error.issues });

  const job = db.prepare('SELECT id FROM analysis_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: '분석 결과를 찾을 수 없습니다.' });

  const { productKey, category, issueLabel, newCategory, newIssueLabel, reviewIds } = parsed.data;
  const id = nanoid();
  const payload = {
    productKey,
    original: { category, issueLabel },
    corrected: { category: newCategory, issueLabel: newIssueLabel },
    reviewIds: reviewIds || [],
  };
  db.prepare('INSERT INTO user_corrections (id, analysis_id, review_pk, categories) VALUES (?, ?, ?, ?)').run(
    id,
    req.params.id,
    productKey,
    JSON.stringify(payload),
  );
  res.json({ ok: true, correctionId: id, corrected: payload.corrected });
});

// GET /api/analysis/:id/corrections — 저장된 수정 목록 (검토/추후 반영용)
router.get('/:id/corrections', (req, res) => {
  const rows = db
    .prepare('SELECT id, review_pk, categories, created_at FROM user_corrections WHERE analysis_id = ? ORDER BY created_at DESC')
    .all(req.params.id);
  res.json(
    rows.map((r) => ({ id: r.id, productKey: r.review_pk, ...JSON.parse(r.categories), createdAt: r.created_at })),
  );
});

export default router;
