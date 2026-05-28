# 리뷰 인사이트 (Review Insight) — 패션 셀러용 리뷰 기반 상품 개선 리포트 MVP

> **“리뷰 엑셀만 올리면, 상품별 반복 불만과 상세페이지 수정안을 3분 안에 뽑아드립니다.”**

스마트스토어·카페24·쿠팡·자사몰에서 내려받은 리뷰 **CSV/XLSX**를 업로드하면,
상품별 반복 불만을 **패션 특화 카테고리**로 자동 분류하고, 세부 이슈를 찾아내고,
**상세페이지 수정안**과 **CS 답글 초안**까지 생성하는 MVP 웹앱입니다.

- AI를 파는 게 아니라, 셀러가 매달 반복하는 **리뷰 관리 업무를 줄여주는 운영 도구**를 지향합니다.
- 초기에는 API 연동/크롤링 없이 **엑셀/CSV 업로드** 방식만 지원합니다.
- **AI API 키가 없어도** Mock 응답으로 전체 흐름이 동작합니다.

---

## 1. 프로젝트 폴더 구조

```
review-insight-mvp/  (= 이 저장소 루트)
├── backend/                     # Node.js + Express API
│   ├── src/
│   │   ├── server.js            # 엔트리 (Express 앱)
│   │   ├── routes/
│   │   │   ├── upload.routes.js   # 업로드/파싱/자동매핑/정규화
│   │   │   ├── analysis.routes.js # 분석 실행/조회/CSV 내보내기
│   │   │   └── ai.routes.js       # 답글 템플릿 생성
│   │   ├── services/
│   │   │   ├── fileParser.service.js        # CSV/XLSX 파싱
│   │   │   ├── columnMapping.service.js     # 컬럼 자동 매핑 (점수 기반)
│   │   │   ├── normalizeReview.service.js   # 공통 스키마 정규화
│   │   │   ├── privacyMasking.service.js    # 개인정보 마스킹
│   │   │   ├── reviewClassification.service.js # 멀티라벨 분류 (규칙+LLM)
│   │   │   ├── issueDetection.service.js    # 세부 이슈 자동 생성/클러스터
│   │   │   ├── productAnalysis.service.js   # 상품별 집계 오케스트레이션
│   │   │   ├── aiClient.service.js          # LLM 추상화 (mock/openai/...)
│   │   │   └── export.service.js            # CSV 내보내기
│   │   ├── db/
│   │   │   ├── database.js       # better-sqlite3 연결
│   │   │   └── schema.sql        # 테이블 스키마
│   │   └── utils/
│   │       ├── textUtils.js
│   │       └── dateUtils.js
│   ├── scripts/makeSampleXlsx.js  # 샘플 CSV → XLSX 변환
│   ├── .env.example
│   └── package.json
│
├── frontend/                    # React + Vite + SCSS + ECharts
│   ├── src/
│   │   ├── main.jsx / App.jsx
│   │   ├── api/                 # axios 클라이언트
│   │   ├── pages/               # Landing/Upload/Mapping/Dashboard/ProductDetail/Settings
│   │   ├── components/          # FileUploader, ColumnMappingTable, SummaryCards, CategoryChart ...
│   │   └── styles/              # variables/global/layout/dashboard (SCSS)
│   ├── vite.config.js           # /api → 백엔드(4000) 프록시
│   └── package.json
│
├── sample-data/
│   └── sample_reviews_fashion.csv   # 60개 샘플 리뷰 (상품 6종)
└── README.md
```

---

## 2. 설치 방법

**권장 Node.js 버전: 20 LTS** (최소 18). better-sqlite3가 네이티브 모듈이라 설치 시 빌드 도구가 필요할 수 있습니다.

### 방법 A — 루트에서 한 번에 (권장)
```bash
npm run install:all       # backend + frontend 의존성 설치
cp backend/.env.example backend/.env   # 없어도 mock 으로 동작
```

### 방법 B — 패키지별 설치
```bash
cd backend && npm install && cp .env.example .env
cd ../frontend && npm install
```

### better-sqlite3 설치 실패 시 (특히 Windows)
better-sqlite3는 C++ 네이티브 모듈이라 prebuilt 바이너리가 없을 때 컴파일이 필요합니다.

- **Node 버전 확인**: 20 LTS 사용 권장. 홀수/최신 버전(예: 23)은 prebuilt가 없을 수 있습니다.
- **Windows**: 관리자 PowerShell에서 빌드 도구 설치 후 재설치
  ```powershell
  npm install --global windows-build-tools     # 또는 "Visual Studio Build Tools" + Python 3 설치
  cd backend && npm install
  ```
- **macOS**: `xcode-select --install`
- **Linux**: `sudo apt-get install -y build-essential python3`
- 그래도 실패하면 캐시 정리 후 재시도: `npm cache clean --force && npm install`
- **TODO(3차)**: 설치가 끝내 불가능한 환경을 위해 `node:sqlite`(Node 22+ 실험적) 또는 JSON 파일 기반 fallback 스토리지로 전환할 수 있게 DB 계층을 추상화할 예정입니다. (현재는 `DB_PATH`/`data` 폴더 자동 생성 로직 유지)

---

## 3. 실행 방법

### 루트 스크립트 (권장) — 터미널 2개
```bash
npm run dev:backend     # http://localhost:4000
npm run dev:frontend    # http://localhost:5173
```

### 또는 패키지별
```bash
cd backend && npm run dev      # 또는 npm start
cd frontend && npm run dev
```

브라우저에서 **http://localhost:5173** 접속 →
랜딩에서 **“샘플 데이터로 체험하기”** 클릭하면 업로드 없이 바로 분석 결과를 볼 수 있습니다.

(선택) 샘플 XLSX 파일 생성: `npm run seed:xlsx` → `sample-data/sample_reviews_fashion.xlsx`

---

## 3-1. 검증 명령어

코드를 받은 직후/수정 후 정상 동작을 빠르게 확인하는 방법입니다.

```bash
# 1) mock 기반 로컬 핵심 로직 점검 (DB/서버/네트워크 불필요)
npm run check
#   → privacyMasking / fileParser / columnMapping / reviewClassification /
#     issueDetection+productAnalysis / export / aiClient 각 항목 ✓ 출력

# 2) 프론트 빌드 점검 (타입/임포트/SCSS 오류 검출)
npm run build:frontend
#   → "✓ built in ..." 출력되면 정상

# 3) 실제 LLM provider / API 키 연결 점검 (네트워크 필요)
npm run check:llm
#   → LLM_PROVIDER=mock 이면 "mock mode, skip real LLM call" 후 종료
#   → openai/gemini/claude 면 실제 호출해 JSON 응답 파싱 성공 여부 확인
#   → 실패해도 프로세스를 죽이지 않으며 어떤 키가 필요한지 안내

# 4) (선택) 서버 띄우고 헬스 체크
npm run dev:backend
curl http://localhost:4000/api/health      # {"ok":true,"aiMode":"mock"}
```

세 명령의 역할 요약:

| 명령 | 무엇을 점검 | 네트워크 |
|---|---|---|
| `npm run check` | mock 기반 분석 파이프라인이 정상 동작하는지 | 불필요 |
| `npm run build:frontend` | 프론트가 빌드 오류 없이 번들되는지 | 불필요 |
| `npm run check:llm` | 실제 LLM provider 연결 + JSON 응답 수신 | 필요 |

> 중요: **`check:llm`이 실패해도 앱은 정상 동작합니다.** aiClient의 함수별 mock fallback이 호출 실패/JSON 파싱 실패/형식 불일치를 모두 흡수하기 때문입니다(키 없음·401/403·타임아웃 포함).

---

## 4. `.env.example`

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
MAX_UPLOAD_BYTES=10485760        # 10MB
DB_PATH=./data/app.db
UPLOAD_ROWS_TTL_MIN=60           # 업로드 파싱 rows 보관 시간(분). 경과 시 비움(PII 잔존 최소화)

# LLM_PROVIDER: mock | openai | gemini | claude
# 키가 없거나 호출/파싱 실패 시 자동으로 mock 으로 fallback 합니다.
LLM_PROVIDER=mock
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
LLM_API_KEY=                     # 공통 키 (provider별 키 미설정 시 사용)
LLM_MODEL=                       # 미지정 시 provider 기본값
LLM_TIMEOUT_MS=20000
# (구버전 호환) AI_PROVIDER / AI_API_KEY / AI_MODEL 도 인식
```

> **AI 연결 상태**: 실제 LLM 연결이 구현되어 있습니다. `LLM_PROVIDER`로 **openai / gemini / claude** 중 하나를 고르고 해당 키를 넣으면 실제 호출하며,
> 키가 없거나 호출/JSON 파싱이 실패하면 **자동으로 mock 으로 fallback** 합니다(앱은 항상 동작).
> 기본 모델: openai=`gpt-4o-mini`, gemini=`gemini-2.5-flash`, claude=`claude-sonnet-4-6` (`LLM_MODEL`로 변경).
> **모델 ID는 provider마다 자주 갱신·종료됩니다.** 특히 **Gemini 모델명은 자주 바뀌므로** 실제 사용 전 [Google AI Studio](https://aistudio.google.com/) 또는 [Gemini API 모델 문서](https://ai.google.dev/gemini-api/docs/models)에서 현재 사용 가능한 정확한 모델 ID를 확인하고 `LLM_MODEL`에 명시하세요. OpenAI/Anthropic도 마찬가지([OpenAI](https://platform.openai.com/docs/models) / [Anthropic](https://docs.anthropic.com/en/docs/about-claude/models)).
> 잘못된 모델 ID로 호출이 실패해도 앱은 **mock 으로 자동 fallback** 되어 정상 동작합니다.
> 실제 호출 지점은 `backend/src/services/aiClient.service.js`의 `callOpenAI/callGemini/callClaude` 입니다.

---

## 5. 사용 흐름 (UI)

1. **랜딩** → “샘플 데이터로 체험하기” 또는 “리뷰 파일 업로드하기”
2. **업로드** → 플랫폼 선택 후 CSV/XLSX 업로드 (업로드 즉시 개인정보 마스킹)
3. **컬럼 매핑 확인** → 자동 매핑 결과 확인/수정, 템플릿 저장 가능
4. **대시보드** → 요약 지표(부정 리뷰 vs 개선 이슈 분리), 카테고리 분포 차트, 상품별 문제 TOP 10
5. **상품 상세 리포트** → 주요 이슈 + 근거 리뷰 + 상세페이지 수정안 + CS 답글 초안, **각 이슈 “분류 수정”** 가능
6. **다운로드** → CSV 내보내기 / 인쇄(PDF)

### 5-1. 데모 시나리오 (셀러 데모용 — 5분)

실제 셀러에게 보여줄 때 이 흐름대로 시연하세요.

1. **랜딩 페이지**에서 “샘플 데이터로 체험하기” 클릭
2. **컬럼 매핑 확인** → 자동 추정 결과만 보고 “이대로 분석하기” 클릭
3. **분석 실행** (몇 초 안에 완료)
4. **대시보드**에서 “이번에 먼저 고칠 상품 TOP 3” 카드 보여주기 — “이 3개부터 손대시면 효과가 빠릅니다”
5. **상품 상세 리포트** 진입 → ‘이 상품의 핵심 문제’ 카드의 **근거 리뷰**(실제 고객 코멘트) 강조
6. **상세페이지 수정 체크리스트**를 체크하며 진행할 수 있다고 시연
7. **CS 답글 초안**의 ‘복사하기’로 답글을 즉시 사용 가능함을 시연
8. **🖨️ 인쇄 / PDF** 버튼 → 상품 리포트 인쇄 미리보기 (사이드바·버튼 자동 숨김)

---

### 5-2. 샘플 플로우 수동 검증 체크리스트

브라우저에서 다음 항목을 순서대로 클릭하며 모두 정상 동작하는지 확인하세요.

- [ ] 랜딩 페이지에서 **“샘플 데이터로 체험하기”** 클릭 → 자동으로 업로드 진행
- [ ] **컬럼 매핑 화면** 진입 (스텝퍼 `① 업로드 ✓ → ② 컬럼 매핑`)
- [ ] 자동 매핑 결과 확인 후 **“이 매핑으로 분석하기”** 클릭 → 분석 실행
- [ ] **대시보드 진입** + 요약 카드 6개 표시 (전체/부정/개선 이슈/총 이슈/평균★/상품 수)
- [ ] **부정 리뷰 수**와 **개선 이슈 발견 리뷰 수**가 별도 카드로 따로 표시되는지 확인
- [ ] **카테고리별 불만 분포 차트** 표시(`기타` 제외, 막대/원형 토글)
- [ ] **부정 리뷰가 많은 상품 TOP 10** 표시
- [ ] **개선 이슈가 많은 상품 TOP 10** 표시(이슈 발견 리뷰 수 + 총 이슈 수)
- [ ] 상품명 클릭 → **상품 상세 진입**
- [ ] 상품 헤더에 이슈 지표 3종 태그(개선 이슈 리뷰/총 이슈/이슈 비율) 표시
- [ ] **주요 이슈 TOP 5** 각 카드에 **근거 리뷰** 인용 확인
- [ ] 각 이슈 카드의 **추천 조치(상세페이지 수정안)** 확인
- [ ] **상세페이지 개선 체크리스트** 표시
- [ ] **CS 답글 초안** 3종(기본/정중/친근) + 복사하기 버튼 동작
- [ ] 이슈 카드의 **“분류 수정”** 버튼 → 카테고리/세부 이슈 변경 후 저장 → 새로고침해도 유지
- [ ] 대시보드 **CSV 내보내기** 버튼 → 파일 다운로드(상품·이슈별 행)

---

## 6. 주요 로직 설명

### 컬럼 자동 매핑 (`columnMapping.service.js`)
- 플랫폼마다 다른 컬럼명을 공통 스키마(`productName, content, rating ...`)로 매핑.
- 점수: **정확 일치 100 / 공백·기호 제거 후 일치 90 / 포함 관계 70**.
- 데이터 패턴 가산점: rating 값이 1~5(+20), createdAt 날짜 형태(+20), content 긴 텍스트(+20).
- 충돌 방지를 위해 `content → productName → ...` 우선순위로 컬럼을 1:1 배정.

### 개인정보 처리 / 마스킹 (`privacyMasking.service.js`)
- **업로드 파일 원본(바이너리)은 디스크에 저장하지 않습니다**(multer memoryStorage로 메모리에서만 파싱).
- **파싱된 rows도 DB 저장 전에 `maskRows`로 마스킹**한 뒤에만 `upload_files.rows`(JSON)에 저장합니다. 컬럼 매핑 미리보기(sampleRows)와 자동 매핑도 마스킹된 값 기준입니다.
- 마스킹 항목: 전화번호 `[전화번호]`, 이메일 `[이메일]`, 10자리 이상 숫자 `[주문번호]`, 주소 `[주소]`. 작성자명은 첫 글자만 남김.
- **분석 완료 후 `upload_files.rows`는 `NULL`로 비웁니다**(정규화된 `reviews`만 유지). 또한 `UPLOAD_ROWS_TTL_MIN`(기본 60분)이 지난 업로드의 rows를 서버가 주기적으로 비웁니다(`purgeStaleUploadRows`). → 마스킹 + 단기 보관으로 PII 잔존을 이중으로 줄입니다.
- **AI 기본 동작은 mock**입니다(`LLM_PROVIDER=mock`이 기본값). 실제 OpenAI/Gemini/Claude 연동 코드는 포함되어 있으나 키를 설정해야 활성화되며, 키가 없거나 실패하면 mock으로 동작합니다.

### 하이브리드 분석 (`reviewClassification` + `issueDetection` + `productAnalysis`)
- **비용 절감**을 위해 LLM에 전체 리뷰를 넣지 않습니다.
  1. 문장을 **절(clause) 단위**로 쪼개 규칙 기반 **멀티라벨** 분류 (한 리뷰에 사이즈+색상+소재 동시 가능)
  2. **부정어/극성 게이팅**: `"작지 않아요"`, `"비침 없어요"`, 긍정 문장은 불만으로 잡지 않음
  3. rating(1~2 부정 / 3 중립 / 4~5 긍정), 없으면 텍스트 감성 추정
  4. 트리거 토큰 겹침으로 같은 카테고리의 중복 이슈 제거(사이즈는 허리/어깨/소매 등 부위별 복수 허용)
  5. 카테고리가 없는 **애매한 부정 리뷰만** LLM(또는 mock)에 위임
  6. 세부 이슈 규칙이 **카테고리 + 라벨 + 맞춤 추천액션**을 함께 생성, 라벨 없는 묶음만 자카드 유사도 클러스터 → LLM 라벨링
  7. 근거 리뷰는 **부정도·매칭강도·길이** 기준으로 선별 + 유사 중복 제거
- 모든 결과에 **근거 리뷰(evidenceReviews)** 와 **source(rule/llm/cluster/user)** 를 남겨 신뢰성과 사후 수정을 지원합니다.

### 지표 분리 (혼동 방지)
- `negativeReviews` — 별점/감성 기준 **부정 리뷰 수**
- `issueReviewCount` — 개선 이슈가 1개 이상 발견된 **리뷰 수**
- `totalIssueCount` — 발견된 **세부 이슈 총 개수**
- `issueRatio` — 전체 리뷰 중 개선 이슈가 발견된 비율
- 위 지표는 summary와 각 ProductAnalysis에 모두 포함되고, 대시보드/상품 상세 카드에 표시됩니다.

### 사용자 분류 수정 (`user_corrections`)
- 상품 상세의 각 이슈 카드에서 **카테고리·세부이슈를 수정** → `POST /api/analysis/:id/corrections`로 저장.
- 상품 상세 조회 시 저장된 수정을 **즉시 반영**(`source: "user"`)합니다. 재학습은 3차 작업 예정이며, 지금은 수정값을 보존해 추후 반영할 수 있는 구조만 마련했습니다.

### 패션 분석 카테고리 (고정 10종)
`사이즈 · 핏/실루엣 · 색상/화면 차이 · 소재/두께 · 마감/불량 · 착용감 · 세탁/내구성 · 배송/포장 · 가격/가성비 · 기타`

### LLM 추상화 (`aiClient.service.js`)
- 함수: `classifyAmbiguousReviews / generateIssueLabel / generateProductImprovementReport / generateReplyTemplates / generateMonthlyReport`
- **provider 선택**: `LLM_PROVIDER`(mock|openai|gemini|claude). 실제 호출은 `callOpenAI`(chat completions, `response_format=json_object`) / `callGemini`(`responseMimeType=application/json`) / `callClaude`(messages API)로 구현.
- **안전장치**:
  - 키가 없으면 처음부터 `mock` 모드.
  - 모든 응답을 `parseJsonSafe`로 파싱하고, 호출 실패·JSON 파싱 실패·형식 불일치면 **함수별 mock 기본값** 반환 → 앱이 항상 동작.
  - 호출 타임아웃(`LLM_TIMEOUT_MS`, AbortController), **401/403 발생 시 이후 호출은 즉시 mock**으로 차단(비용/지연 방지).

---

## 7. 백엔드 API 요약

| Method | Path | 설명 |
|---|---|---|
| POST | `/api/uploads` | 파일 업로드 + 파싱 + 자동 매핑 후보 |
| POST | `/api/uploads/sample` | 내장 샘플로 업로드 흐름 시작 |
| GET | `/api/uploads/:id` | 업로드 정보 조회 |
| POST | `/api/uploads/:id/mapping` | 확정 매핑 저장 + 정규화 |
| GET | `/api/uploads/templates/list` | 저장된 매핑 템플릿 |
| POST | `/api/analysis` | 분석 실행 (`{uploadId}`) |
| GET | `/api/analysis/:id` | 전체 분석 결과(요약) |
| GET | `/api/analysis/:id/products` | 상품별 목록 |
| GET | `/api/analysis/:id/products/:productKey` | 상품 상세 (저장된 수정 반영) |
| GET | `/api/analysis/:id/export.csv` | 결과 CSV 다운로드 |
| POST | `/api/analysis/:id/corrections` | 사용자 분류 수정 저장 |
| GET | `/api/analysis/:id/corrections` | 저장된 수정 목록 |
| POST | `/api/ai/reply-templates` | 이슈별 답글 템플릿 생성 |

---

## 8. 샘플 데이터
`sample-data/sample_reviews_fashion.csv` — 6개 상품(린넨 와이드 팬츠, 오버핏 반팔 티셔츠, 니트 가디건,
슬림핏 셔츠, 플리츠 롱스커트, 데님 자켓), 총 60개 리뷰.
허리 작음/기장 김/색상 어두움/원단 얇음/실밥·마감/배송 지연/포장 구김/가성비/핏 예쁨/재구매 등
다양한 케이스와 개인정보(전화·이메일·주문번호) 마스킹 테스트 데이터를 포함합니다.

---

## 9. 앞으로 확장할 기능 목록 (TODO)
- **[완료] 실제 LLM 연동**: `LLM_PROVIDER`로 OpenAI / Gemini / Claude 연결(키 없거나 실패 시 mock fallback).
- **[다음] 프롬프트 캐싱 / 배치 호출**: 상품·이슈별 호출이 많아질 때 비용·지연 최적화(특히 분류·답글 배치).
- **[다음] user correction 재학습/재집계**: 저장된 `user_corrections`를 분석 파이프라인에 반영(룰 보정/재집계).
- **[3차] DB 계층 추상화 + fallback**: better-sqlite3 설치 불가 환경을 위한 `node:sqlite` 또는 JSON 파일 스토리지 fallback.
- **카페24 OAuth 연동**: 게시판 목록 조회 → 리뷰 게시판(board_no) 선택 → articles/comments 조회. (현재 `source` 필드와 서비스 레이어가 확장 지점)
- **임베딩 기반 클러스터링**: 현재 규칙+자카드 → 문장 임베딩으로 세부 이슈 정밀도 향상 (`issueDetection.service.js` 교체).
- **PostgreSQL 전환**: MVP는 SQLite, 서비스 레이어 분리로 DB 교체 용이.
- **사용자/멀티 스토어(SaaS)**: `stores`/`users` 테이블, 인증, 워크스페이스.
- **PDF 리포트 정식 출력**, **기간별/월간 트렌드**, **표 붙여넣기 업로드**.
- **말투 옵션 확장** 및 브랜드 톤 학습.
