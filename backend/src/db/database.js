import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ───── SQLite 경로 해결 + 운영 영구 저장 검증 ─────
// 운영(NODE_ENV=production)에서 DB_PATH 가 ephemeral 한 앱 디렉터리 내부면 재배포 시 데이터 손실.
// Render 의 경우 Persistent Disk 를 만들고 mount path(예: /var/data) 안쪽을 DB_PATH 로 지정해야 한다.
// 자세한 가이드: docs/render-deployment.md

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/app.db');
const rawDbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
const dbPath = path.resolve(rawDbPath);
const isProd = process.env.NODE_ENV === 'production';

// 운영 환경에서 ephemeral 경로가 의심되면 경고 (강제 종료는 하지 않는다)
function isEphemeralPath(p) {
  // 1) DB_PATH 가 비어 있으면 ephemeral (default 가 앱 폴더 내부)
  if (!process.env.DB_PATH) return true;
  // 2) 절대경로가 아닌 상대경로면 cwd 기준 → ephemeral 가능성 매우 큼
  if (!path.isAbsolute(rawDbPath)) return true;
  // 3) Render 의 일반 코드 디렉터리는 영구 저장이 아님
  if (p.startsWith('/opt/render/project')) return true;
  // 4) 프로젝트 디렉터리 내부도 ephemeral 로 본다
  const projectRoot = path.resolve(__dirname, '../../..');
  if (p.startsWith(projectRoot + path.sep) || p === projectRoot) return true;
  return false;
}

const willInitNew = !fs.existsSync(dbPath);
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
} catch (e) {
  console.warn(`[db][warning] DB 디렉터리 생성 실패: ${path.dirname(dbPath)} (${e.message})`);
}

console.info(`[db] SQLite path: ${dbPath}`);
console.info(`[db] SQLite file exists: ${!willInitNew}`);
if (willInitNew) {
  console.info('[db] SQLite file not found. A new database will be initialized.');
}

if (isProd) {
  if (!process.env.DB_PATH) {
    console.warn('[db][warning] DB_PATH is not set in production. SQLite may be created in ephemeral storage and lost on next deploy/restart.');
  }
  if (isEphemeralPath(dbPath)) {
    console.warn(
      `[db][warning] DB path "${dbPath}" looks ephemeral on this host. ` +
      'On Render, attach a Persistent Disk and set DB_PATH inside the mount path ' +
      '(e.g. /var/data/reviewfit/app.db). See docs/render-deployment.md.',
    );
  }
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 외부에서 진단/백업 스크립트에서 사용할 수 있도록 export
export const DB_PATH = dbPath;

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

// 샘플 분석 표식 — 파일명/source 추론 없이 명시적 판별. 0=일반 업로드, 1=샘플 분석.
ensureColumn('analysis_jobs', 'is_sample', 'is_sample INTEGER NOT NULL DEFAULT 0');

// 비동기 분석 job 상태 추적 — 업로드 즉시 pending 으로 row 가 생성되고
// background 가 processing → completed/failed 로 전이시킨다. progress 는
// 0~100 단계형 (5/20/50/80/100).
ensureColumn('analysis_jobs', 'progress', 'progress INTEGER NOT NULL DEFAULT 0');
ensureColumn('analysis_jobs', 'total_reviews', 'total_reviews INTEGER');
ensureColumn('analysis_jobs', 'error_message', 'error_message TEXT');
ensureColumn('analysis_jobs', 'started_at', 'started_at TEXT');
ensureColumn('analysis_jobs', 'completed_at', 'completed_at TEXT');
ensureColumn('analysis_jobs', 'failed_at', 'failed_at TEXT');

// llm_usage_logs 확장 컬럼 (이전 마이그레이션엔 없었음 — idempotent 추가).
// 관리자 콘솔 "AI 분석 로그" 화면이 한 row 로 분석 단위 요약을 보여줄 수 있게 한다.
ensureColumn('llm_usage_logs', 'analysis_version', 'analysis_version TEXT');
ensureColumn('llm_usage_logs', 'review_count', 'review_count INTEGER');
ensureColumn('llm_usage_logs', 'cache_hit_count', 'cache_hit_count INTEGER NOT NULL DEFAULT 0');
ensureColumn('llm_usage_logs', 'cache_miss_count', 'cache_miss_count INTEGER NOT NULL DEFAULT 0');
ensureColumn('llm_usage_logs', 'mini_reanalysis_count', 'mini_reanalysis_count INTEGER NOT NULL DEFAULT 0');
ensureColumn('llm_usage_logs', 'openai_called', 'openai_called INTEGER NOT NULL DEFAULT 0');
ensureColumn('llm_usage_logs', 'fallback_used', 'fallback_used INTEGER NOT NULL DEFAULT 0');
ensureColumn('llm_usage_logs', 'fallback_provider', 'fallback_provider TEXT');
// 기존 source='sample' 데이터 보정 (한 번만 의미 있음, 이미 1 이면 변화 없음)
db.exec(`
  UPDATE analysis_jobs
  SET is_sample = 1
  WHERE is_sample = 0
    AND upload_id IN (SELECT id FROM upload_files WHERE source = 'sample')
`);

// 기본 요금제 seed (free/starter/pro). 가격은 미확정이므로 0 으로 두고 README/docs 에서 TODO.
// 인덱스 기반 monthly_analysis_limit / max_reviews_per_analysis 도 함께 정의.
const SEED_PLANS = [
  { code: 'free',     name: 'Free',     price_krw: 0, monthly_analysis_limit: 1,   max_reviews_per_analysis: 100,   features: 'basic' },
  { code: 'starter',  name: 'Starter',  price_krw: 0, monthly_analysis_limit: 10,  max_reviews_per_analysis: 1000,  features: 'standard' },
  { code: 'pro',      name: 'Pro',      price_krw: 0, monthly_analysis_limit: 50,  max_reviews_per_analysis: 5000,  features: 'pro' },
  // Business: 결제 미연동 — 관리자 수동 설정 / 별도 문의 용도.
  { code: 'business', name: 'Business', price_krw: 0, monthly_analysis_limit: 200, max_reviews_per_analysis: 50000, features: 'business' },
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

// app_settings 기본 시드 — 이미 있으면 INSERT OR IGNORE (운영 중 값 덮어쓰지 않음).
const SEED_SETTINGS = [
  // general
  { key: 'maintenance_mode', value: 'false', type: 'boolean', category: 'general', label: '점검 모드', desc: 'true 면 일반 사용자 API 차단(관리자/health/공지 제외)' },
  { key: 'signup_enabled',   value: 'true',  type: 'boolean', category: 'general', label: '회원가입 허용', desc: 'false 면 신규 가입 차단' },
  // billing
  { key: 'billing_enforce_limits', value: 'false', type: 'boolean', category: 'billing', label: '플랜 제한 실제 차단', desc: '환경변수 BILLING_ENFORCE_LIMITS 보다 우선 적용' },
  // limits (plans 테이블의 override 역할)
  { key: 'free_monthly_analysis_limit',    value: '1',   type: 'number', category: 'limits', label: 'Free: 월 분석 횟수' },
  { key: 'free_max_reviews_per_analysis',  value: '100', type: 'number', category: 'limits', label: 'Free: 파일당 리뷰 수' },
  { key: 'starter_monthly_analysis_limit', value: '10',  type: 'number', category: 'limits', label: 'Starter: 월 분석 횟수' },
  { key: 'starter_max_reviews_per_analysis', value: '1000', type: 'number', category: 'limits', label: 'Starter: 파일당 리뷰 수' },
  { key: 'pro_monthly_analysis_limit',     value: '50',  type: 'number', category: 'limits', label: 'Pro: 월 분석 횟수' },
  { key: 'pro_max_reviews_per_analysis',   value: '5000', type: 'number', category: 'limits', label: 'Pro: 파일당 리뷰 수' },
  { key: 'business_monthly_analysis_limit',  value: '200',  type: 'number', category: 'limits', label: 'Business: 월 분석 횟수' },
  { key: 'business_max_reviews_per_analysis', value: '50000', type: 'number', category: 'limits', label: 'Business: 파일당 리뷰 수' },
  // ui / notice
  { key: 'notice_banner_enabled', value: 'false', type: 'boolean', category: 'notice', label: '공지 배너 표시', desc: 'announcements 와 별개로 단일 텍스트 배너 토글' },
  { key: 'notice_banner_text',    value: '',      type: 'string',  category: 'notice', label: '공지 배너 텍스트' },
  // report
  { key: 'report_default_sort',   value: 'priority', type: 'string', category: 'report', label: '상품별 문제 정리 기본 정렬', desc: 'priority | negativeRatio | issues | reviews' },
];
const insertSetting = db.prepare(
  `INSERT OR IGNORE INTO app_settings (key, value, value_type, label, description, category, is_public, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
);
for (const s of SEED_SETTINGS) {
  insertSetting.run(s.key, s.value, s.type, s.label || null, s.desc || null, s.category, 0);
}

// ADMIN_EMAILS 환경변수에 포함된 이메일은 부팅 시 자동으로 role=admin 으로 보정.
// 운영 초기 관리자 계정 부트스트랩용. 콤마/공백 구분, 대소문자 무시.
// (services/adminEmails.service.js 의 promoteConfiguredAdminEmails 와 동일 정책 —
//  database.js 는 서비스 import 가 어려워 inline 으로 유지하되 동일한 로그 포맷을 사용.)
const adminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
if (adminEmails.length) {
  console.info(`[admin] ADMIN_EMAILS configured: ${adminEmails.length}`);
  const findUser = db.prepare('SELECT id, role FROM users WHERE LOWER(email) = ?');
  const promote = db.prepare(
    `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );
  let promoted = 0;
  for (const email of adminEmails) {
    const u = findUser.get(email);
    if (!u) {
      console.info(`[admin] Configured admin email not found yet: ${email}`);
      continue;
    }
    if (u.role === 'admin') continue;
    promote.run(u.id);
    promoted++;
    console.info(`[admin] Promoted configured admin email: ${email}`);
  }
  console.info(`[admin] Configured admin promotion complete. promoted=${promoted}`);
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
      `SELECT j.id, j.upload_id, j.status, j.summary, j.created_at, j.is_sample,
              j.progress, j.total_reviews, j.error_message,
              j.started_at, j.completed_at, j.failed_at,
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
    const src = r.source || summary.source || null;
    // 샘플 판별 우선순위:
    //   1. analysis_jobs.is_sample 컬럼 (신규 표준)
    //   2. upload_files.source === 'sample'
    //   3. 고정 sample 파일명 정확 일치 (legacy 데이터 호환)
    // 사용자 임의 파일명은 더 이상 sample 로 인정하지 않음.
    const isSample =
      r.is_sample === 1 ||
      src === 'sample' ||
      (typeof r.original_name === 'string' &&
        r.original_name.toLowerCase() === 'sample_reviews_fashion.csv');
    // status 노멀라이즈 — 신/구 값 통합. 'done' → 'completed', 'error' → 'failed'.
    const normalizedStatus = r.status === 'done' ? 'completed'
      : r.status === 'error' ? 'failed'
      : r.status;
    return {
      id: r.id,
      uploadId: r.upload_id,
      source: src,
      isSample,
      originalName: r.original_name || null,
      status: normalizedStatus,
      progress: r.progress ?? (normalizedStatus === 'completed' ? 100 : 0),
      totalReviews: r.total_reviews ?? summary.totalReviews ?? null,
      productCount: r.product_count ?? summary.productCount ?? null,
      errorMessage: r.error_message || null,
      createdAt: r.created_at,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      failedAt: r.failed_at,
    };
  });
}

export default db;
