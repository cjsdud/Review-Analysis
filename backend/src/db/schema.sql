-- 리뷰 인사이트 MVP 스키마 (SQLite)
-- 원본 업로드 파일은 보관하지 않고, 파싱/정규화 결과만 저장합니다.

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
  raw TEXT  -- JSON 원본 행 (마스킹 적용 후)
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

-- 분석 작업
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  upload_id TEXT,
  status TEXT DEFAULT 'done',  -- pending | running | done | error
  summary TEXT,                -- JSON 전체 요약
  created_at TEXT DEFAULT (datetime('now'))
);

-- 상품별 분석 결과
CREATE TABLE IF NOT EXISTS product_analyses (
  id TEXT PRIMARY KEY,
  analysis_id TEXT,
  product_key TEXT,
  product_name TEXT,
  data TEXT,  -- JSON: ProductAnalysis
  created_at TEXT DEFAULT (datetime('now'))
);

-- 사용자가 수정한 분류 (user correction)
CREATE TABLE IF NOT EXISTS user_corrections (
  id TEXT PRIMARY KEY,
  analysis_id TEXT,
  review_pk TEXT,
  categories TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_upload ON reviews(upload_id);
CREATE INDEX IF NOT EXISTS idx_pa_analysis ON product_analyses(analysis_id);
CREATE INDEX IF NOT EXISTS idx_cls_analysis ON review_classifications(analysis_id);
