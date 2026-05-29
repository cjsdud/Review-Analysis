import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/app.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// 기존 DB 에 새 컬럼이 없으면 추가 (idempotent 마이그레이션)
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('upload_files', 'selected_sheet_name', 'selected_sheet_name TEXT');
ensureColumn('upload_files', 'selected_header_row_index', 'selected_header_row_index INTEGER DEFAULT 0');
ensureColumn('upload_files', 'sheet_metas', 'sheet_metas TEXT');
ensureColumn('upload_files', 'sheet_parse_results', 'sheet_parse_results TEXT');

// 추후 로그인 도입 대비 nullable user_id 컬럼. 현재는 항상 NULL 로 저장되며 모든 API 는 user_id 없이 동작한다.
ensureColumn('upload_files', 'user_id', 'user_id TEXT');
ensureColumn('column_mappings', 'user_id', 'user_id TEXT');
ensureColumn('reviews', 'user_id', 'user_id TEXT');
ensureColumn('analysis_jobs', 'user_id', 'user_id TEXT');
ensureColumn('product_analyses', 'user_id', 'user_id TEXT');
ensureColumn('user_corrections', 'user_id', 'user_id TEXT');

// 일정 시간(ttlMinutes)이 지난 업로드의 파싱 rows(JSON)를 비워 PII 잔존을 줄인다.
// 정규화된 reviews 테이블은 유지되므로 분석에는 영향이 없다.
// 입력: ttlMinutes(number). 출력: 비워진 행 수(number).
export function purgeStaleUploadRows(ttlMinutes = 60) {
  const info = db
    .prepare(
      `UPDATE upload_files SET rows = NULL, sheet_parse_results = NULL
       WHERE (rows IS NOT NULL OR sheet_parse_results IS NOT NULL) AND created_at <= datetime('now', ?)`,
    )
    .run(`-${Math.max(1, Math.floor(ttlMinutes))} minutes`);
  return info.changes;
}

// 최근 분석 히스토리 목록을 반환한다(최신순).
// upload_files 와 join 해 originalName/source 를 가져오고, product_analyses 로 상품 수를 센다.
// TODO(로그인): userId 가 주어지면 analysis_jobs.user_id = ? 로 필터링한다. 현재는 전체 반환.
// 입력: { limit=20, userId=null }. 출력: 히스토리 row 배열.
export function listAnalyses({ limit = 20, userId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(Math.floor(Number(limit) || 20), 200));
  const where = userId ? 'WHERE j.user_id = ?' : '';
  const params = userId ? [userId, safeLimit] : [safeLimit];
  const rows = db
    .prepare(
      `SELECT j.id, j.upload_id, j.status, j.summary, j.created_at,
              u.original_name AS original_name, u.source AS source,
              (SELECT COUNT(*) FROM product_analyses p WHERE p.analysis_id = j.id) AS product_count
         FROM analysis_jobs j
         LEFT JOIN upload_files u ON u.id = j.upload_id
         ${where}
         ORDER BY j.created_at DESC
         LIMIT ?`,
    )
    .all(...params);

  return rows.map((r) => {
    let summary = {};
    try {
      summary = r.summary ? JSON.parse(r.summary) : {};
    } catch {
      summary = {};
    }
    return {
      id: r.id,
      uploadId: r.upload_id,
      source: r.source || summary.source || null,
      originalName: r.original_name || null,
      status: r.status,
      totalReviews: summary.totalReviews ?? null,
      productCount: r.product_count ?? summary.productCount ?? null,
      createdAt: r.created_at,
    };
  });
}

export default db;
