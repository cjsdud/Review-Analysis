import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/database.js';
import { parseFile, rowsFromMatrix } from '../services/fileParser.service.js';
import { autoMapColumns, FIELDS, FIELD_CANDIDATES, isMappingValid } from '../services/columnMapping.service.js';
import { normalizeReviews } from '../services/normalizeReview.service.js';
import { maskRows, maskMatrix } from '../services/privacyMasking.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// 시트별 사전 계산 결과를 마스킹 + JSON 저장 가능한 형태로 변환
function maskSheetParseResults(sheetParseResults) {
  const out = {};
  for (const [name, sp] of Object.entries(sheetParseResults || {})) {
    out[name] = {
      headers: sp.headers || [],
      rows: maskRows(sp.rows || []),
      matrix: maskMatrix(sp.matrix || []),
      detectedHeaderRowIndex: sp.detectedHeaderRowIndex || 0,
    };
  }
  return out;
}

// 파싱 결과를 마스킹해 upload_files 에 저장하고 응답 페이로드를 만드는 공용 헬퍼.
// 입력: { originalName, source, parsed }  parsed = parseFile() 결과
function persistUpload({ originalName, source, parsed }) {
  const maskedRows = maskRows(parsed.rows || []);
  const headers = parsed.headers || [];
  const mappingSuggestion = autoMapColumns(headers, maskedRows, source);
  const uploadId = nanoid();

  // XLSX 멀티시트 데이터는 모두 마스킹 후 저장
  const sheetParseResults = maskSheetParseResults(parsed.sheetParseResults || {});
  const sheetMetas = parsed.sheets || [];

  db.prepare(
    `INSERT INTO upload_files
       (id, original_name, source, row_count, headers, rows, mapping_suggestion,
        selected_sheet_name, selected_header_row_index, sheet_metas, sheet_parse_results)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uploadId,
    originalName,
    source,
    maskedRows.length,
    JSON.stringify(headers),
    JSON.stringify(maskedRows),
    JSON.stringify(mappingSuggestion),
    parsed.selectedSheetName || null,
    parsed.selectedHeaderRowIndex || 0,
    JSON.stringify(sheetMetas),
    JSON.stringify(sheetParseResults),
  );

  return {
    uploadId,
    originalName,
    source,
    rowCount: maskedRows.length,
    headers,
    sampleRows: maskedRows.slice(0, 5),
    mappingSuggestion,
    fields: FIELDS,
    fieldCandidates: FIELD_CANDIDATES,
    sheets: sheetMetas,
    selectedSheetName: parsed.selectedSheetName || null,
    selectedHeaderRowIndex: parsed.selectedHeaderRowIndex || 0,
  };
}

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
const upload = multer({
  storage: multer.memoryStorage(),
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

  if (!parsed.rows.length) {
    // 멀티 시트 XLSX 에서 선택된 시트에 데이터가 없을 수 있음 → 다른 시트가 있으면 안내
    const hasOtherSheet = (parsed.sheets || []).some((s) => s.rowCount > 0);
    const msg = hasOtherSheet
      ? '선택된 시트에 데이터가 없습니다. 다른 시트를 선택해 주세요.'
      : '데이터 행이 없습니다.';
    if (!hasOtherSheet) return res.status(400).json({ error: msg });
    // 데이터 행은 없지만 다른 시트가 있는 경우에도 메타는 응답 → 프론트에서 시트 선택 가능
  }

  const payload = persistUpload({
    originalName: req.file.originalname,
    source,
    parsed,
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
    parsed,
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
    headers: row.headers ? JSON.parse(row.headers) : [],
    sampleRows: row.rows ? JSON.parse(row.rows).slice(0, 5) : [],
    mappingSuggestion: row.mapping_suggestion ? JSON.parse(row.mapping_suggestion) : {},
    fields: FIELDS,
    fieldCandidates: FIELD_CANDIDATES,
    sheets: row.sheet_metas ? JSON.parse(row.sheet_metas) : [],
    selectedSheetName: row.selected_sheet_name || null,
    selectedHeaderRowIndex: row.selected_header_row_index || 0,
  });
});

// POST /api/uploads/:id/reparse — 사용자가 시트나 헤더 행을 바꿨을 때 다시 파싱
// body: { sheetName?: string, headerRowIndex?: number }
const reparseSchema = z.object({
  sheetName: z.string().optional(),
  headerRowIndex: z.number().int().min(0).max(50).optional(),
});

router.post('/:id/reparse', (req, res) => {
  const parsedBody = reparseSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: '잘못된 요청 형식', detail: parsedBody.error.issues });
  }
  const { sheetName, headerRowIndex } = parsedBody.data;

  const row = db.prepare('SELECT * FROM upload_files WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '업로드를 찾을 수 없습니다.' });
  if (!row.sheet_parse_results) {
    return res.status(400).json({ error: '이 파일은 시트 선택을 지원하지 않습니다(CSV).' });
  }
  const sheetResults = JSON.parse(row.sheet_parse_results);
  const nextSheet = sheetName || row.selected_sheet_name;
  const sp = sheetResults[nextSheet];
  if (!sp) return res.status(400).json({ error: `존재하지 않는 시트: ${nextSheet}` });

  const nextHeaderIdx = headerRowIndex != null ? headerRowIndex : sp.detectedHeaderRowIndex || 0;
  // 저장된 matrix 는 이미 마스킹된 상태이므로 그대로 사용
  const { headers, rows } = rowsFromMatrix(sp.matrix || [], nextHeaderIdx);
  const mappingSuggestion = autoMapColumns(headers, rows, row.source);

  db.prepare(
    `UPDATE upload_files
       SET selected_sheet_name = ?,
           selected_header_row_index = ?,
           headers = ?,
           rows = ?,
           row_count = ?,
           mapping_suggestion = ?
     WHERE id = ?`,
  ).run(
    nextSheet,
    nextHeaderIdx,
    JSON.stringify(headers),
    JSON.stringify(rows),
    rows.length,
    JSON.stringify(mappingSuggestion),
    row.id,
  );

  res.json({
    uploadId: row.id,
    originalName: row.original_name,
    source: row.source,
    rowCount: rows.length,
    headers,
    sampleRows: rows.slice(0, 5),
    mappingSuggestion,
    fields: FIELDS,
    fieldCandidates: FIELD_CANDIDATES,
    sheets: row.sheet_metas ? JSON.parse(row.sheet_metas) : [],
    selectedSheetName: nextSheet,
    selectedHeaderRowIndex: nextHeaderIdx,
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
  const cleanMapping = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));

  if (!isMappingValid(cleanMapping)) {
    return res.status(400).json({ error: 'content(리뷰내용) 컬럼 매핑은 필수입니다.' });
  }

  const uploadRow = db.prepare('SELECT * FROM upload_files WHERE id = ?').get(req.params.id);
  if (!uploadRow) return res.status(404).json({ error: '업로드를 찾을 수 없습니다.' });
  if (!uploadRow.rows) {
    return res.status(410).json({ error: '업로드 데이터가 만료되어 다시 업로드가 필요합니다.' });
  }

  const rows = JSON.parse(uploadRow.rows);
  const reviews = normalizeReviews(rows, cleanMapping, {
    source: uploadRow.source,
    uploadId: uploadRow.id,
  });

  if (!reviews.length) return res.status(400).json({ error: '정규화된 리뷰가 없습니다. content 컬럼을 확인하세요.' });

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
