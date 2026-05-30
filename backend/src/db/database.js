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
ensureColumn('review_classifications', 'user_id', 'user_id TEXT');

// 기본 요금제 seed (free/starter/pro). 가격은 미확정이므로 0 으로 두고 README/docs 에서 TODO.
// 인덱스 기반 monthly_analysis_limit / max_reviews_per_analysis 도 함께 정의.
const SEED_PLANS = [
  { code: 'free',    name: 'Free',    price_krw: 0, monthly_analysis_limit: 1,  max_reviews_per_analysis: 100,  features: 'basic' },
  { code: 'starter', name: 'Starter', price_krw: 0, monthly_analysis_limit: 10, max_reviews_per_analysis: 1000, features: 'standard' },
  { code: 'pro',     name: 'Pro',     price_krw: 0, monthly_analysis_limit: 50, max_reviews_per_analysis: 5000, features: 'pro' },
];
const upsertPlan = db.prepare(
  `INSERT INTO plans (id, code, name, price_krw, monthly_analysis_limit, max_reviews_per_analysis, features)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(code) DO UPDATE SET
     name = excluded.name,
     monthly_analysis_limit = excluded.monthly_analysis_limit,
     max_reviews_per_analysis = excluded.max_reviews_per_analysis,
     features = excluded.features`,
);
for (const p of SEED_PLANS) {
  upsertPlan.run(`plan_${p.code}`, p.code, p.name, p.price_krw, p.monthly_analysis_limit, p.max_reviews_per_analysis, p.features);
}

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
// 입력:
//   - limit (기본 20)
//   - userId: 로그인 사용자 ID. null 이고 includeAnonymous=true 면 user_id IS NULL 만.
//   - includeAnonymous: userId 가 null 일 때 true 면 익명(user_id IS NULL) 분석만 반환.
//     false 면 전체 반환(관리자/디버그용).
export function listAnalyses({ limit = 20, userId = null, includeAnonymous = false } = {}) {
  const safeLimit = Math.max(1, Math.min(Math.floor(Number(limit) || 20), 200));
  let where = '';
  let params = [safeLimit];
  if (userId) {
    where = 'WHERE j.user_id = ?';
    params = [userId, safeLimit];
  } else if (includeAnonymous) {
    where = 'WHERE j.user_id IS NULL';
  }
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
