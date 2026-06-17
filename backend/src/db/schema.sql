-- 리뷰 인사이트 MVP 스키마 (SQLite)
-- 원본 업로드 파일은 보관하지 않고, 파싱/정규화 결과만 저장합니다.
--
-- user_id 컬럼: 현재 로그인/인증은 구현하지 않음. 추후 로그인 도입 시
-- 분석 히스토리를 사용자별로 필터링하기 위한 nullable 컬럼만 미리 둔다.
-- 인증 도입 전까지는 항상 NULL 로 저장되며, 모든 기존 API 는 user_id 없이 동작한다.

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 업로드 1건 = 파싱된 표 1개. 원본 파일 바이너리는 저장하지 않음.
CREATE TABLE IF NOT EXISTS upload_files (
  id TEXT PRIMARY KEY,
  original_name TEXT,
  source TEXT DEFAULT 'custom',
  row_count INTEGER DEFAULT 0,
  headers TEXT,            -- JSON 배열
  rows TEXT,              -- JSON 배열 (파싱 결과, 임시 보관, 마스킹 후)
  mapping_suggestion TEXT, -- JSON: 자동 매핑 후보
  -- XLSX 멀티 시트 / 헤더 행 선택 지원
  selected_sheet_name TEXT,
  selected_header_row_index INTEGER DEFAULT 0,
  sheet_metas TEXT,        -- JSON: SheetMeta[]
  sheet_parse_results TEXT, -- JSON: { [sheetName]: { headers, rows, matrix, detectedHeaderRowIndex } } (모두 마스킹 후)
  user_id TEXT,            -- 추후 로그인 연결용 (현재 항상 NULL)
  created_at TEXT DEFAULT (datetime('now'))
);

-- 사용자가 확정/저장한 컬럼 매핑 (템플릿으로 재사용 가능)
CREATE TABLE IF NOT EXISTS column_mappings (
  id TEXT PRIMARY KEY,
  upload_id TEXT,
  template_name TEXT,
  source TEXT DEFAULT 'custom',
  mapping TEXT,  -- JSON: { field: columnName }
  is_template INTEGER DEFAULT 0,
  user_id TEXT,  -- 추후 로그인 연결용 (현재 항상 NULL)
  created_at TEXT DEFAULT (datetime('now'))
);

-- 정규화된 리뷰
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  upload_id TEXT,
  source TEXT,
  store_id TEXT,
  product_name TEXT,
  option_name TEXT,
  rating REAL,
  title TEXT,
  content TEXT,
  writer TEXT,
  created_at TEXT,
  reply_text TEXT,
  review_id TEXT,
  raw TEXT,  -- JSON 원본 행 (마스킹 적용 후)
  user_id TEXT  -- 추후 로그인 연결용 (현재 항상 NULL)
);

-- 멀티라벨 분류 결과
CREATE TABLE IF NOT EXISTS review_classifications (
  id TEXT PRIMARY KEY,
  analysis_id TEXT,
  review_pk TEXT,         -- reviews.id
  sentiment TEXT,
  categories TEXT,        -- JSON 배열: [{name, issue, confidence, evidence, source}]
  created_at TEXT DEFAULT (datetime('now'))
);

-- 분석 작업 (= 분석 히스토리 1건)
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  upload_id TEXT,
  status TEXT DEFAULT 'done',  -- pending | running | done | error
  summary TEXT,                -- JSON 전체 요약
  user_id TEXT,                -- 추후 로그인 연결용 (현재 항상 NULL)
  created_at TEXT DEFAULT (datetime('now'))
);

-- 상품별 분석 결과
CREATE TABLE IF NOT EXISTS product_analyses (
  id TEXT PRIMARY KEY,
  analysis_id TEXT,
  product_key TEXT,
  product_name TEXT,
  data TEXT,  -- JSON: ProductAnalysis
  user_id TEXT,  -- 추후 로그인 연결용 (현재 항상 NULL)
  created_at TEXT DEFAULT (datetime('now'))
);

-- 사용자가 수정한 분류 (user correction)
CREATE TABLE IF NOT EXISTS user_corrections (
  id TEXT PRIMARY KEY,
  analysis_id TEXT,
  review_pk TEXT,
  categories TEXT,
  user_id TEXT,  -- 추후 로그인 연결용 (현재 항상 NULL)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_upload ON reviews(upload_id);
CREATE INDEX IF NOT EXISTS idx_pa_analysis ON product_analyses(analysis_id);
CREATE INDEX IF NOT EXISTS idx_cls_analysis ON review_classifications(analysis_id);

-- ===== 로그인/요금제 기반 =====
-- 사용자 계정. 비밀번호는 항상 해시(password_hash)로만 저장.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

-- 요금제 정의 (free/starter/pro). 가격/제한은 코드 또는 seed 로 관리.
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  price_krw INTEGER NOT NULL DEFAULT 0,
  monthly_analysis_limit INTEGER,
  max_reviews_per_analysis INTEGER,
  features TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 사용자 구독 현황. 실제 PG 연동은 추후. 현재는 provider/billing_key 컬럼만 준비.
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_code TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TEXT,
  current_period_end TEXT,
  provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  billing_key_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 사용량 이벤트 (월 분석 횟수 등을 집계할 때 사용)
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  analysis_id TEXT,
  upload_id TEXT,
  amount INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 결제 기록 (현재는 PG 미연동, 구조만 준비)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT,
  provider_payment_id TEXT,
  order_id TEXT,
  amount_krw INTEGER NOT NULL,
  status TEXT NOT NULL,
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_user_event ON usage_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

-- ===== 관리자 (operations) =====
-- 관리자 변경 이력 로그. 운영 책임 추적 및 롤백 단서.
CREATE TABLE IF NOT EXISTS admin_action_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  before_value TEXT,
  after_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_user_id) REFERENCES users(id)
);

-- 운영 중 코드 배포 없이 변경 가능한 설정값. (API KEY 같은 secret 은 저장 금지)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  label TEXT,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  is_public INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 운영 공지/배너. 사용자 화면 상단에 노출.
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  is_active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

-- 사용자별 할인/이벤트 적용. 실제 결제 계산에서 참조 가능.
CREATE TABLE IF NOT EXISTS user_discounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value INTEGER NOT NULL,
  reason TEXT,
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 가벼운 페이지뷰/이벤트 추적. 개인정보(IP/UA/이름 등)는 저장하지 않는다.
-- event_name 은 서버 allowlist 로 고정, path 도 allowlist 로 제한.
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  path TEXT,
  referrer TEXT,
  user_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_action_logs(admin_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_action_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_user_discounts_user ON user_discounts(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name, created_at);

-- 리뷰 LLM 분석 캐시 — 같은 리뷰 + 같은 prompt/analysis/model 이면 결과 재사용.
-- resultJson 에는 마스킹된 리뷰 기준 분석 결과만 저장한다 (원본 텍스트 X).
CREATE TABLE IF NOT EXISTS review_analysis_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  user_id TEXT,
  analysis_id TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (review_hash, prompt_version, analysis_version, model)
);
CREATE INDEX IF NOT EXISTS idx_review_cache_hash ON review_analysis_cache(review_hash);

-- LLM 호출 단위 token usage / 비용 로깅.
-- LLM_PROVIDER=mock 일 때는 0 token 으로 provider=mock 기록.
-- review_count / cache_*_count / mini_reanalysis_count / openai_called /
-- fallback_used 는 분석 단위 요약 (request_type='analysis_summary') 에 의미를 갖는다.
CREATE TABLE IF NOT EXISTS llm_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  analysis_id TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  analysis_version TEXT,
  request_type TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL,
  review_count INTEGER,
  cache_hit_count INTEGER NOT NULL DEFAULT 0,
  cache_miss_count INTEGER NOT NULL DEFAULT 0,
  mini_reanalysis_count INTEGER NOT NULL DEFAULT 0,
  openai_called INTEGER NOT NULL DEFAULT 0,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  fallback_provider TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user ON llm_usage_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_analysis ON llm_usage_logs(analysis_id);

-- ===== 베타 샘플 분석 공유 코드 =====
-- 관리자가 특정 analysis_jobs row 에 대해 발급하는 읽기 전용 공유 코드.
-- 외부 셀러는 로그인 없이 code 만으로 분석 결과(마스킹된 리뷰 + 요약)를 조회한다.
-- 모든 마스킹 / 권한 / 다운로드 차단은 share.routes.js + 프론트 SharedReportPage 에서 강제.
CREATE TABLE IF NOT EXISTS shared_reports (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,             -- RF-XXXX-XXXX 형태, 추측 어려운 랜덤
  expires_at TEXT,                       -- ISO timestamp, NULL 이면 무기한(관리자 수동 설정용)
  revoked_at TEXT,                       -- NOT NULL 이면 회수된 코드
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,
  created_by TEXT NOT NULL,              -- admin user_id
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY (analysis_id) REFERENCES analysis_jobs(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_shared_reports_analysis ON shared_reports(analysis_id);
CREATE INDEX IF NOT EXISTS idx_shared_reports_created ON shared_reports(created_at);
