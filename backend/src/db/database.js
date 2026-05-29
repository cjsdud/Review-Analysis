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

export default db;
