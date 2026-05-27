import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/database.js';
import { parseFile } from '../services/fileParser.service.js';
import { autoMapColumns, FIELDS, FIELD_CANDIDATES, isMappingValid } from '../services/columnMapping.service.js';
import { normalizeReviews } from '../services/normalizeReview.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// 파싱 결과를 upload_files에 저장하고 응답 페이로드를 만드는 공용 헬퍼
function persistUpload({ originalName, source, headers, rows }) {
  const mappingSuggestion = autoMapColumns(headers, rows);
  const uploadId = nanoid();
  db.prepare(
    `INSERT INTO upload_files (id, original_name, source, row_count, headers, rows, mapping_suggestion)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(uploadId, originalName, source, rows.length, JSON.stringify(headers), JSON.stringify(rows), JSON.stringify(mappingSuggestion));

  return {
    uploadId,
    originalName,
    rowCount: rows.length,
    headers,
    sampleRows: rows.slice(0, 5),
    mappingSuggestion,
    fields: FIELDS,
    fieldCandidates: FIELD_CANDIDATES,
  };
}

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const upload = multer({
  storage: multer.memoryStorage(), // 원본 파일은 디스크에 저장하지 않음
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('CSV 또는 XLSX 파일만 업로드할 수 있습니다.'), ok);
  },
});

// POST /api/uploads — 파일 업로드 + 파싱 + 컬럼 자동 매핑 후보 반환
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

  const source = (req.body.source || 'custom').toLowerCase();
  let parsed;
  try {
    parsed = parseFile(req.file.buffer, req.file.originalname);
  } catch (e) {
    return res.status(400).json({ error: `파일 파싱 실패: ${e.message}` });
  }

  if (!parsed.rows.length) return res.status(400).json({ error: '데이터 행이 없습니다.' });

  const payload = persistUpload({
    originalName: req.file.originalname,
    source,
    headers: parsed.headers,
    rows: parsed.rows,
  });
  res.json(payload);
});

// POST /api/uploads/sample — 내장 샘플 데이터로 업로드 흐름 시작 (체험하기)
router.post('/sample', (_req, res) => {
  const samplePath = path.join(__dirname, '../../../sample-data/sample_reviews_fashion.csv');
  if (!fs.existsSync(samplePath)) return res.status(404).json({ error: '샘플 파일을 찾을 수 없습니다.' });
  const buf = fs.readFileSync(samplePath);
  const parsed = parseFile(buf, 'sample_reviews_fashion.csv');
  const payload = persistUpload({
    originalName: 'sample_reviews_fashion.csv',
    source: 'smartstore',
    headers: parsed.headers,
    rows: parsed.rows,
  });
  res.json(payload);
});

// GET /api/uploads/:id — 업로드 정보 조회
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM upload_files WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '업로드를 찾을 수 없습니다.' });
  res.json({
    uploadId: row.id,
    originalName: row.original_name,
    source: row.source,
    rowCount: row.row_count,
    headers: JSON.parse(row.headers),
    sampleRows: JSON.parse(row.rows).slice(0, 5),
    mappingSuggestion: JSON.parse(row.mapping_suggestion),
    fields: FIELDS,
    fieldCandidates: FIELD_CANDIDATES,
  });
});

const mappingSchema = z.object({
  mapping: z.record(z.string(), z.string().nullable()),
  saveAsTemplate: z.boolean().optional(),
  templateName: z.string().optional(),
});

// POST /api/uploads/:id/mapping — 확정 매핑 저장 + 정규화
router.post('/:id/mapping', (req, res) => {
  const parsed = mappingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '잘못된 매핑 형식', detail: parsed.error.issues });

  const { mapping, saveAsTemplate, templateName } = parsed.data;
  // null 값 제거
  const cleanMapping = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));

  if (!isMappingValid(cleanMapping)) {
    return res.status(400).json({ error: 'content(리뷰내용) 컬럼 매핑은 필수입니다.' });
  }

  const uploadRow = db.prepare('SELECT * FROM upload_files WHERE id = ?').get(req.params.id);
  if (!uploadRow) return res.status(404).json({ error: '업로드를 찾을 수 없습니다.' });

  const rows = JSON.parse(uploadRow.rows);
  const reviews = normalizeReviews(rows, cleanMapping, {
    source: uploadRow.source,
    uploadId: uploadRow.id,
  });

  if (!reviews.length) return res.status(400).json({ error: '정규화된 리뷰가 없습니다. content 컬럼을 확인하세요.' });

  // 기존 리뷰 제거 후 재삽입 (재매핑 대비)
  db.prepare('DELETE FROM reviews WHERE upload_id = ?').run(uploadRow.id);
  const insert = db.prepare(
    `INSERT INTO reviews (id, upload_id, source, store_id, product_name, option_name, rating, title, content, writer, created_at, reply_text, review_id, raw)
     VALUES (@id,@uploadId,@source,@storeId,@productName,@optionName,@rating,@title,@content,@writer,@createdAt,@replyText,@reviewId,@raw)`,
  );
  const tx = db.transaction((items) => {
    for (const r of items) {
      insert.run({
        id: r.id,
        uploadId: r.uploadId,
        source: r.source || 'custom',
        storeId: r.storeId || null,
        productName: r.productName,
        optionName: r.optionName || null,
        rating: r.rating ?? null,
        title: r.title || null,
        content: r.content,
        writer: r.writer || null,
        createdAt: r.createdAt || null,
        replyText: r.replyText || null,
        reviewId: r.reviewId || null,
        raw: null,
      });
    }
  });
  tx(reviews);

  // 매핑 저장 (+ 템플릿)
  db.prepare(
    `INSERT INTO column_mappings (id, upload_id, template_name, source, mapping, is_template)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(nanoid(), uploadRow.id, templateName || null, uploadRow.source, JSON.stringify(cleanMapping), saveAsTemplate ? 1 : 0);

  res.json({ uploadId: uploadRow.id, normalizedCount: reviews.length, mapping: cleanMapping });
});

// GET /api/templates — 저장된 매핑 템플릿 목록
router.get('/templates/list', (_req, res) => {
  const rows = db
    .prepare('SELECT id, template_name, source, mapping, created_at FROM column_mappings WHERE is_template = 1 ORDER BY created_at DESC')
    .all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      templateName: r.template_name,
      source: r.source,
      mapping: JSON.parse(r.mapping),
      createdAt: r.created_at,
    })),
  );
});

export default router;
