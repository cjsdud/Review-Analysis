# 리뷰핏 (ReviewFit) — 패션 셀러용 리뷰 기반 상품 개선 리포트 MVP

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
│   └── sample_reviews_fashion.csv   # 133개 샘플 리뷰 (상품 14종)
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
- **TODO(3차)**: 설치가 끝내 불가능한 환경을 위해 `node:sqlite`(Node 22+ 실험적)
  또는 JSON 파일 기반 fallback 스토리지로 전환할 수 있게 DB 계층을 추상화할 예정입니다.
  (현재는 `DB_PATH`/`data` 폴더 자동 생성 로직 유지)

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

> 중요: **`check:llm`이 실패해도 앱은 정상 동작합니다.**
> aiClient의 함수별 mock fallback이 호출 실패 / JSON 파싱 실패 / 형식 불일치를 모두 흡수하기 때문입니다
> (키 없음·401/403·타임아웃 포함).

---

## 4. `.env.example`

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
MAX_UPLOAD_BYTES=10485760        # 10MB
DB_PATH=./data/app.db
UPLOAD_ROWS_TTL_MIN=60           # 업로드 파싱 임시 데이터(rows/sheet_parse_results) 보관 시간(분)
UPLOAD_CLEANUP_INTERVAL_MIN=10   # 임시 데이터 정리(cleanup) 실행 주기(분)

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
> **모델 ID는 provider마다 자주 갱신·종료됩니다.**
> 특히 **Gemini 모델명은 자주 바뀌므로** 실제 사용 전
> [Google AI Studio](https://aistudio.google.com/) 또는
> [Gemini API 모델 문서](https://ai.google.dev/gemini-api/docs/models)에서
> 현재 사용 가능한 정확한 모델 ID를 확인하고 `LLM_MODEL`에 명시하세요.
> OpenAI/Anthropic도 마찬가지
> ([OpenAI](https://platform.openai.com/docs/models) /
> [Anthropic](https://docs.anthropic.com/en/docs/about-claude/models)).
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

### 5-3. 실제 셀러 검증 방법

실제 패션 셀러에게 검증을 받을 때 따라가는 표준 흐름입니다.

1. **실제 리뷰 파일 확보**
   - 스마트스토어 / 카페24 / 쿠팡 / 자사몰 어느 곳에서 받은 CSV·XLSX 든 사용 가능합니다.
   - 셀러에게 받기 전 NDA·삭제 동의 등 별도 확보 권장.

2. **개인정보 컬럼 제거 권장 (선택)**
   - 리뷰핏은 업로드 후 자동 마스킹하지만, 신경이 쓰이면 업로드 전에
     주문번호 / 전화번호 / 이메일 컬럼을 미리 지워도 됩니다.
   - 분석에는 **상품명 · 별점 · 리뷰 내용** 만 있어도 충분합니다.

3. **파일 업로드**
   - 랜딩 → “리뷰 파일 업로드” → 플랫폼 선택 → 파일 첨부.

4. **컬럼 매핑 확인**
   - 자동 매핑 결과를 셀러와 함께 확인하고, 필요하면 수정합니다.
   - 자주 쓰는 매핑은 “이 매핑을 다음에도 쓰게 저장” 으로 템플릿 보관.

5. **분석 결과 확인**
   - 대시보드 → “이번에 먼저 고칠 상품 TOP 3” → 상품 상세 리포트 순서로 시연.
   - 셀러가 가장 먼저 손대고 싶다고 말한 상품 1~2개를 인터뷰의 중심 사례로 사용.

6. **`docs/seller-validation-template.md` 에 평가 기록**
   - 셀러당 1부 양식을 채워 컬럼 매핑 / 분류 정확도 / 액션 가능성 / 가격 의향 / 개인정보 불안 요소를 정리합니다.

7. **`docs/validation-results.md` 에 누적 기록**
   - 셀러 1회 검증 → `## 검증 N` 블록 1개를 채워 누적합니다.
   - 상단 **검증 요약** 표에 한 줄 추가해 빠르게 비교할 수 있게 합니다.

8. **틀린 분류를 바탕으로 규칙 개선**
   - 자주 틀린 분류는 `backend/src/services/fashionLexicon.js` 의 키워드/규칙 보완으로 다음 분석에 반영합니다.
   - 같은 (productKey, 원래 라벨)로 반복 수정되는 항목은 `user_corrections` 기반 자동 적용(`source='correction'`)으로 누적 학습됩니다.

> 모집·DM 카피는 `docs/landing-copy.md`, 리포트 예시는 `docs/sample-report.md` 참고.

---

### 5-4. 웹 배포 (Render — 단일 Web Service)

핸드폰에서 바로 데모해야 할 때는 Render 무료 Web Service 하나로 backend API +
frontend 정적 파일을 같이 서빙합니다. 같은 origin 에서 `/api/*` 가 호출되므로
CORS·도메인 설정이 별도 필요 없습니다.

```bash
# 로컬에서 production 흉내내기
npm run render:build
NODE_ENV=production PORT=4000 npm run render:start
# → http://localhost:4000 에서 동일하게 동작
```

| 항목 | 값 |
|---|---|
| Build Command | `npm run render:build` |
| Start Command | `npm run render:start` |
| 환경변수 | `NODE_ENV=production`, `LLM_PROVIDER=mock`, `DB_PATH=./data/app.db`, `UPLOAD_ROWS_TTL_MIN=60` 등 |

**주의 — SQLite 영속성**: Render Free 인스턴스 디스크는 재배포·재시작 시
초기화됩니다. **MVP 검증용 임시 저장**으로만 쓰고, 영구 저장이 필요하면
Render Disk(유료) 또는 외부 DB로 옮기세요.

상세 설정값·환경변수·체크리스트는 [`docs/deploy-render.md`](docs/deploy-render.md) 참고.

---

## 6. 주요 로직 설명

### 컬럼 자동 매핑 (`columnMapping.service.js`)
- 플랫폼마다 다른 컬럼명을 공통 스키마(`productName, content, rating ...`)로 매핑.
- 점수: **정확 일치 100 / 공백·기호 제거 후 일치 90 / 포함 관계 70**.
- 데이터 패턴 가산점: rating 값이 1~5(+20), createdAt 날짜 형태(+20), content 긴 텍스트(+20).
- 충돌 방지를 위해 `content → productName → ...` 우선순위로 컬럼을 1:1 배정.

#### 플랫폼(source)별 후보 — 자동 매핑 정확도 향상
업로드 화면에서 선택한 플랫폼에 따라 `SOURCE_FIELD_CANDIDATES` 의 후보가 함께 적용되고,
소스 후보에 매칭되면 **+10 가산점**이 붙어 같은 점수의 공통 후보보다 우선 선택됩니다.

| source | 보강된 컬럼명 예시 |
|---|---|
| `smartstore` | `구매자평점` · `리뷰상세내용` · `등록일시` · `구매자명` · `상품주문번호` 등 |
| `cafe24` | `게시글번호` · `글제목` · `글내용` · `상품정보` · `관리자답변내용` 등 |
| `coupang` | `노출상품명` · `구매옵션명` · `상품평점` · `상품평내용` · `상품평작성일` 등 |
| `custom` (자사몰/기타) | 공통 후보만 사용 (`product` / `review` / `score` 같은 영문 헤더 포함) |

> **주의** — 플랫폼별 엑셀 양식은 판매자센터의 설정/다운로드 메뉴 종류에 따라 달라질 수 있습니다.
> 자동 매핑 결과는 컬럼 매핑 화면에서 **항상 사용자 확인**을 권장하며, 다르면 직접 보정할 수 있습니다.
> 카페24는 엑셀 양식을 직접 구성하는 경우가 많아 자동 매핑이 빗나갈 가능성이 가장 높습니다.

#### 분석 핵심 컬럼
- **`productName`, `content`** — 상품별 분석의 핵심. `productName` 이 비면 모든 리뷰가
  ‘미지정 상품’으로 묶이므로, 컬럼 매핑 화면에서 경고 배너를 노출합니다(분석은 계속 가능).
- `rating`, `optionName`, `createdAt` — 있으면 분석 품질(감성/옵션별 이슈/월간 트렌드)이 좋아집니다.
- 알 수 없는 `source` 가 들어와도 에러 없이 `custom` 처럼 공통 후보만으로 동작합니다.

### 개인정보 처리 / 마스킹 (`privacyMasking.service.js`)
- **업로드 파일 원본(바이너리)은 디스크에 저장하지 않습니다**(multer memoryStorage로 메모리에서만 파싱).
- **파싱된 rows도 DB 저장 전에 `maskRows`로 마스킹**한 뒤에만 `upload_files.rows`(JSON)에 저장합니다.
  컬럼 매핑 미리보기(sampleRows)와 자동 매핑도 마스킹된 값 기준입니다.
- 마스킹 항목: 전화번호 `[전화번호]`, 이메일 `[이메일]`, 10자리 이상 숫자 `[주문번호]`, 주소 `[주소]`. 작성자명은 첫 글자만 남김.
- **분석 완료 후 `upload_files.rows`와 `sheet_parse_results`를 모두 `NULL`로 비웁니다**(정규화된 `reviews`만 유지).
  또한 `UPLOAD_ROWS_TTL_MIN`(기본 60분)이 지난 업로드의 임시 데이터를 서버가 주기적으로 비웁니다(`purgeStaleUploadRows`).
  cleanup 은 서버 시작 시 1회 + `UPLOAD_CLEANUP_INTERVAL_MIN`(기본 10분)마다 실행됩니다.
  → 마스킹 + 단기 보관으로 PII 잔존을 이중으로 줄입니다.
- 자세한 보관 정책은 [`docs/data-retention-policy.md`](docs/data-retention-policy.md), 추후 로그인 기반 히스토리 계획은
  [`docs/future-auth-history-plan.md`](docs/future-auth-history-plan.md) 참고.
- **AI 기본 동작은 mock**입니다 (`LLM_PROVIDER=mock`이 기본값).
  실제 OpenAI / Gemini / Claude 연동 코드는 포함되어 있으나 키를 설정해야 활성화되며,
  키가 없거나 실패하면 mock으로 동작합니다.

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

### 데이터 저장 및 보관 정책
요약 정책입니다. 자세한 표/계획은 [`docs/data-retention-policy.md`](docs/data-retention-policy.md) 참고.

1. **원본 파일** — CSV/XLSX 바이너리는 **저장하지 않습니다**(메모리에서만 파싱).
2. **업로드 임시 파싱 데이터** (`upload_files.rows`, `upload_files.sheet_parse_results`)
   - 컬럼 매핑과 XLSX 시트/헤더 선택을 위해 **개인정보 마스킹 후 임시 저장**됩니다.
   - **분석 완료 직후 둘 다 즉시 `NULL` 처리**됩니다.
   - 분석이 완료되지 않은 업로드도 기본 **60분**(`UPLOAD_ROWS_TTL_MIN`)이 지나면 cleanup 으로 삭제됩니다.
   - cleanup 은 서버 시작 시 1회 + 기본 **10분**(`UPLOAD_CLEANUP_INTERVAL_MIN`)마다 실행됩니다.
3. **분석 결과(히스토리)** — 다시 보기/히스토리를 위해 저장됩니다.
   - 저장 대상: 정규화 리뷰(`reviews`), 리뷰별 감성/이슈 분류(`review_classifications`),
     전체 요약과 상품별 분석 결과(`analysis_jobs`, `product_analyses`), 사용자 수정 내역(`user_corrections`).
   - 추후 로그인 도입 시 `user_id` 컬럼(현재 nullable, 항상 NULL)으로 **사용자별 히스토리**로 필터링됩니다.
4. **개인정보 주의** — 리뷰에 작성자명/전화/이메일/주문번호가 포함될 수 있으므로 **업로드 전 제거를 권장**합니다.
   리뷰핏은 업로드 단계에서 마스킹하지만, 민감한 컬럼은 올리기 전에 지우는 것이 가장 안전합니다.
5. **현재 MVP 한계** — 로그인이 없어 서버 DB의 분석 결과가 **사용자별로 분리되지 않습니다**.
   실제 운영 전에는 로그인, 사용자별 권한, 보관 기간, 삭제 기능이 필요합니다.

#### 운영 전환 전 익명 테스트 데이터 정리
MVP 동안 쌓인 익명(`user_id IS NULL`) 분석/업로드/리뷰는 운영 전환 직전에 일괄 정리할 수 있습니다.

```bash
npm run cleanup:anonymous          # dry-run: 삭제 대상 개수만 출력
npm run cleanup:anonymous:confirm  # 실제 삭제 (--confirm)
```

- 삭제 대상: `user_corrections`, `review_classifications`, `product_analyses`, `analysis_jobs`,
  `reviews`, `column_mappings`, `upload_files` 의 `user_id IS NULL` 행 (자식→부모 순 트랜잭션).
- 보존: `users`, `plans`, `subscriptions`, `payments`, `usage_events`.
- 실제 삭제 전 DB 백업 권장. 자세한 내용은 [`docs/data-retention-policy.md`](docs/data-retention-policy.md) 참고.

### 분석 히스토리 (다시 보기)
- `analysis_jobs` 1건 = 분석 1회 실행 단위(upload_id, status, summary, created_at, user_id).
- `GET /api/analyses?limit=20` — 최근 분석 목록(최신순). **로그인 사용자는 본인 분석만 반환**,
  익명 데모 모드(`DEMO_ALLOW_ANONYMOUS=true`)에서는 user_id=NULL 인 분석만 반환.
- `GET /api/analysis/:id` — 특정 분석 재조회(summary + products + createdAt). 소유자 확인.
- 프론트 `/history` 화면에서 최근 분석을 카드형으로 보고 클릭 시 대시보드로 이동합니다.

### 로그인 / 회원가입 / 플랜
- 이메일+비밀번호 기반 인증. 비밀번호는 `bcryptjs` 로 해시 저장(평문 저장 금지).
- 토큰은 JWT를 httpOnly cookie(`AUTH_COOKIE_NAME`, 기본 `reviewfit_token`)로 발급.
  production 에서는 `secure: true`, `sameSite: 'lax'`.
- API:
  - `POST /api/auth/register` — `{ email, password, name? }` → 201 + cookie + `{ user }`
  - `POST /api/auth/login` — `{ email, password }` → 200 + cookie + `{ user }`
  - `POST /api/auth/logout` — cookie 제거
  - `GET /api/me` (혹은 `/api/auth/me`) — `{ user, subscription, usage, billingEnforced }`
  - `GET /api/billing/plans` — 공개 플랜 목록
- 환경변수:
  - `AUTH_JWT_SECRET` — JWT 서명 비밀키 (운영에서 반드시 교체)
  - `AUTH_COOKIE_NAME=reviewfit_token`, `AUTH_TOKEN_EXPIRES_IN=7d`
  - `DEMO_ALLOW_ANONYMOUS` — true 면 보호 라우트에서도 미인증을 허용 (MVP/체험용)
  - `BILLING_ENFORCE_LIMITS` — true 면 플랜 월 분석 횟수 / 리뷰 수 제한이 실제로 차단

#### 플랜 (현재 가격 미정, MVP 기준)
| 플랜 | 월 분석 횟수 | 파일당 리뷰 수 |
|---|---|---|
| Free | 1회 | 100개 |
| Starter | 10회 | 1,000개 |
| Pro | 50회 | 5,000개 |

- 회원가입 시 free 구독이 자동 생성됩니다.
- `BILLING_ENFORCE_LIMITS=true` 일 때 분석 실행 전에 위 한도를 확인하고,
  초과 시 `402 PLAN_LIMIT_EXCEEDED` 또는 `403 REVIEW_LIMIT_EXCEEDED` 를 반환합니다.
- 실제 PG 결제 연동(토스페이먼츠/포트원)은 미구현 — [`docs/billing-integration-plan.md`](docs/billing-integration-plan.md) 참고.

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
- 함수:
  - `classifyAmbiguousReviews`
  - `generateIssueLabel`
  - `generateProductImprovementReport`
  - `generateReplyTemplates`
  - `generateMonthlyReport`
- **provider 선택**: `LLM_PROVIDER` (mock | openai | gemini | claude). 실제 호출 구현:
  - `callOpenAI` — chat completions, `response_format=json_object`
  - `callGemini` — `responseMimeType=application/json`
  - `callClaude` — messages API
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
`sample-data/sample_reviews_fashion.csv` — **14개 상품, 총 133개 리뷰**.

| 상품군 | 상품 |
|---|---|
| 의류(상의/하의) | 린넨 와이드 팬츠 · 오버핏 반팔 티셔츠 · 니트 가디건 · 슬림핏 셔츠 · 플리츠 롱스커트 · 크롭 니트 · 코튼 조거팬츠 |
| 의류(아우터) | 데님 자켓 · 오버핏 후드 집업 · 트렌치 코트 |
| 신발 | 러닝화 · 첼시 부츠 |
| 가방 | 숄더백 |
| 원피스 | 여름 원피스 |

다양한 케이스 포함: 사이즈 / 핏 / 색상 / 소재 / 마감 불량 / 세탁 변형 / 배송 지연 /
포장 구김 / 가성비 / 핏 예쁨 / 재구매 / 보풀 / 냄새 / 발볼 / 쿠션감 / 뒤꿈치 / 수납·끈 마감 등.

일부 상품은 부정 리뷰가 많고 일부는 긍정 리뷰가 많도록 의도적으로 불균등하게 구성했으며,
**개인정보 마스킹 테스트용 전화번호·이메일·주문번호**도 포함되어 있습니다.

133개 중 후반 17개(ID 15001–15017)는 **분류 품질 검증용** — 긍정/문제 없음 표현,
대조 구조(`괜찮은데/예쁜데/지만`), 완화(`조금/살짝/가격 생각하면`), 사이즈 방향 반전
(`한 치수 작게/크게 사세요`), 색상/사이즈 혼동 회피 등 까다로운 케이스를 담고 있습니다.

---

## 8-A. XLSX 멀티 시트 / 헤더 행 자동 감지

업로드된 엑셀 파일은 다음과 같이 처리됩니다.

- **모든 시트를 읽는다.** workbook.SheetNames 전체를 순회하고 각 시트의
  `rowCount`, `columnCount`, `detectedHeaderRowIndex`, `score`, `reason` 을 계산합니다.
- **리뷰 데이터 시트를 자동 추천한다.**
  - 시트명에 `리뷰`, `후기`, `상품평`, `데이터`, `review` 가 들어가면 가산점.
  - 헤더 후보 행에 `상품명`, `리뷰내용`, `별점`, `작성일` 같은 컬럼명이 많을수록 가산점.
  - `README`, `요약`, `summary`, `설명`, `guide` 같은 시트명은 감점.
  - 행/컬럼 수가 너무 적으면 감점. 점수가 가장 높은 시트가 `selectedSheetName`.
- **헤더 행을 자동 감지한다.** 상위 20행 안에서 다음 기준으로 점수화합니다.
  - 컬럼명 후보 매칭 수
  - 다음 행이 별점(1~5) / 날짜 / 긴 텍스트 같은 데이터 패턴인지
  - "리뷰핏 샘플", "아래 데이터는…", "README" 같은 안내문 패턴은 감점.
  - 비어 있지 않은 셀이 3개 이상이면 가산점.
- **사용자가 시트와 헤더 행을 직접 바꿀 수 있다.** 컬럼 매핑 화면 상단에서
  다른 시트 카드를 클릭하거나 "컬럼명으로 사용할 행" 셀렉트를 변경하면
  `POST /api/uploads/:id/reparse` 가 호출되어 headers/sampleRows/mappingSuggestion
  이 즉시 갱신됩니다.
- **첫 행에 안내문이 있어도 실제 컬럼명 행이 선택된다.** 헤더 자동 감지가
  안내문 행을 건너뛰며, 사용자가 직접 헤더 행을 1~20행 중에서 고를 수도 있습니다.
- 컬럼 매핑 select 옵션에는 헤더만 들어가고, 데이터 셀이나 타이틀 문구는 들어가지 않습니다.

### 데이터 저장과 PII 마스킹

- 업로드 시 모든 시트의 `matrix`/`rows` 는 `maskRows` / `maskMatrix` 로 마스킹된 뒤
  `upload_files.sheet_parse_results` (JSON) 에 저장됩니다.
- 사용자가 시트를 바꿀 때 backend 는 저장된 (마스킹된) matrix 로 재파싱합니다.
- TTL(`UPLOAD_ROWS_TTL_MIN`, 기본 60분) 경과 시 `rows` / `sheet_parse_results` 가 NULL 로 비워집니다.

---

## 8-B. 상품 인사이트 / CS 답글 / 리뷰 탐색

### 감성 분포 (긍정/중립/부정)

대시보드 요약 카드와 상품별 테이블에서 별점·문장 감성 기준의 분포를 표시합니다.

- 별점 1~2 → negative, 3 → neutral, 4~5 → positive (별점 없으면 문장 기반 추정)
- **개선 이슈 발견 리뷰** 는 별도로 계산합니다. 긍정 리뷰 안에도 사이즈·색상·소재 같은
  개선 포인트가 있을 수 있어, 부정 리뷰 수와 개선 이슈 리뷰 수는 다를 수 있습니다.
- 상품마다 `productStatus` 배지를 자동 부여:
  - **만족도 높음** — positiveRatio ≥ 0.75 & negativeRatio ≤ 0.1
  - **좋은데 고칠 점 있음** — positiveRatio ≥ 0.7 & issueRatio ≥ 0.25
  - **개선 우선** — negativeRatio ≥ 0.15 & issueRatio ≥ 0.3
  - **주의 필요** — negativeRatio ≥ 0.25
  - **리뷰 부족** — totalReviews < 10
  - **보통** — 위 조건에 해당하지 않을 때

### CS 답글 초안

내부 분류 라벨(`issueLabel`)을 고객용 답글에 그대로 노출하지 않습니다.
`getCustomerFacingIssuePhrase()` 가 자연스러운 표현으로 변환합니다.

예:
- `기장이 김` → "기장감이 기대보다 길게 느껴지셨을 수 있을 것 같습니다"
- `실물 색상이 화면보다 밝음` → "받아보신 상품의 색감이 화면보다 밝게 느껴지셨을 수 있을 것 같습니다"
- `배송이 지연됨` → "상품을 기다리시는 동안 배송이 늦어져 불편하셨을 것 같습니다"

강한 불편 이슈(불량/하자/파손/누락/지연 등)나 severity=high 인 이슈에는 "죄송합니다" 사과
표현을 포함하고, 약한 개선 의견에는 사과를 남발하지 않습니다.
긍정/non-actionable/generic("~ 관련 의견") 이슈는 답글 자체를 생성하지 않습니다.

실제 답글 등록 전 셀러가 최종 확인하시는 것을 권장합니다.

### 전체 이슈 / 리뷰 데이터 보기

상품 상세 페이지에서 두 가지 모달을 제공합니다.

- **전체 이슈 보기** — 핵심 문제 5개에 표시되지 않은 낮은 우선순위 이슈까지 모두 확인.
  - 카테고리 필터는 **"전체"가 맨 앞에 고정**되고, 나머지는 **발견 개수가 많은 순**으로 정렬됩니다.
  - 각 필터 옆에 해당 카테고리의 **발견 개수가 숫자로 표시**됩니다(예: `전체 24` · `사이즈 9`). 0건 카테고리는 숨겨집니다.
  - 이슈 목록 기본 정렬은 **많이 나온 순**(count → 심각도 → 비율 → 라벨순). 심각도순/카테고리순도 선택 가능.
  - 이슈별 "관련 리뷰 보기" 로 해당 이슈가 감지된 리뷰만 모아 볼 수 있습니다.
- **리뷰 데이터 보기** — 이 상품의 분석에 사용된 마스킹된 리뷰 데이터.
  - 긍정/중립/부정/개선 이슈 있음·없음 필터, 카테고리·별점 필터, 본문 검색, 정렬(최신순/별점/이슈 많은 순).
  - 각 리뷰 카드의 **"상세 보기"** 펼침으로 상품명·옵션·작성일·답글·리뷰ID 등 리뷰 원본 정보를 확인할 수 있습니다.
  - 현재 필터링된 목록을 CSV 로 내보낼 수 있습니다.

개인정보(전화/이메일/주문번호)는 업로드 직후 마스킹되며, 리뷰 데이터 보기에서도 항상 마스킹된
데이터만 표시합니다.

---

## 8-1. 분류 품질 개선 기준

`backend/src/services/reviewClassification.service.js` + `fashionLexicon.js` 에서
다음 원칙으로 절(clause) 단위 멀티라벨 분류를 수행합니다.

- **긍정/문제 없음 표현은 핵심 문제에서 제외**
  - 카테고리별 긍정 표현(`CATEGORY_POSITIVE_PHRASES`)이 절에 있으면 해당 카테고리는 이슈로 잡지 않습니다.
  - `ANY_POSITIVE_PHRASES`(예: "더 사고 싶어요", "재구매", "오래 입을 수 있을 것 같")가 있으면 actionable 이슈로 잡지 않습니다.
  - `SOFT_POSITIVE_PHRASES`(`나쁘지 않`)는 무난/긍정으로 해석합니다.
  - "비침이 거의 없어서 좋아요" 같이 부정 어휘가 부정 문맥(`없/안/않`) 안에 있으면 negative 로 치지 않습니다.
- **카테고리 문맥 가드**
  - `CATEGORY_CONTEXT` 키워드가 절에 있어야 그 카테고리로 분류됩니다.
  - `사이즈`: '사이즈/치수/허리/어깨/소매/기장/품/핏/…' 중 하나가 있어야 사이즈 이슈가 됩니다.
    "사진보다 색감이 조금 밝게 느껴졌어요" 는 절대 사이즈 이슈로 잡지 않습니다.
- **사이즈 방향성 보정**
  - "한 치수 작게 사세요" = 상품이 크게 나옴, "한 치수 크게 사세요" = 상품이 작게 나옴.
  - `SIZE_DIRECTION_TOKENS.STRONG_LARGE`(헐렁/넉넉/품이 커) 와 `STRONG_SMALL`(타이트/꽉/품이 작) 로 충돌을 자동 해소합니다.
  - 같은 리뷰에서 `전반적으로 작게 나옴` 과 `전반적으로 크게 나옴` 이 동시에 잡히면 리뷰 단위 conflict resolver 가 정리합니다.
- **부위별 "문제 없음" 차단**
  - "기장은 괜찮은데 어깨가 크게 느껴져요" 에서 '기장은 괜찮'을 감지해 기장 이슈를 제거하고 어깨 이슈만 남깁니다.
  - `PART_NO_PROBLEM` (라벨 단위) 매핑으로 처리합니다.
- **severity (low/medium/high)**
  - 완화 표현(`조금/살짝/약간/제 기준에는/가격 생각하면/나쁘지 않`)이 있으면 절 단위 severity 를 `low` 로 낮춥니다.
  - 강조 표현(`너무/진짜/완전/심하게`)이 있으면 `high`. 같은 이슈가 5건 이상 반복되면 클러스터에서 `high` 로 부스트됩니다.
- **topIssues 필터**
  - "~ 관련 의견" 같은 generic label, `기타` 카테고리, positive/neutral polarity 클러스터는 핵심 문제에서 제외합니다.
- **대조 구조 분리**
  - "~는데/은데/지만/쁜데/싼데" 등을 절 분리자로 처리해 앞 절의 긍정과 뒤 절의 불만을 분리합니다.
- 실제 셀러 파일에서 발견된 오분류는 `user_corrections`(키워드 ≥2개 substring 매칭)와
  `fashionLexicon` 규칙 보강으로 다음 분석부터 자동 반영됩니다.

검증: `backend/scripts/check.js` 의 "문맥 #1 ~ #20" 케이스로 회귀를 확인합니다.

---

## 9. 완료된 항목

- 대시보드/상품 상세 SaaS 카드형 UI ('리뷰핏' 브랜드 통일)
- 모바일 **390px** 렌더링 확인 (사이드바 가로바, 카드 1열, 테이블 가로 스크롤)
- 실제 LLM provider 연결(openai/gemini/claude) + 키 없음·실패 시 mock fallback
- `check:llm` 스크립트 추가 (provider/키 진단)
- 차트 lazy split — 초기 번들에서 ECharts 제외(번들 1.29MB → 243KB)
- `issueReviewCount` / `totalIssueCount` / `issueRatio` 지표 분리 (`기타` 제외)
- 개인정보 자동 마스킹(전화/이메일/주문번호/주소) + 분석 후 `upload_files.rows = NULL`
- 절(clause) 단위 멀티라벨 분류 + 부정어/극성 게이팅
- 사용자 수정(`user_corrections`) **다음 분석에서 룰 기반 우선 적용**
  - **review-level**: 본문에 핵심어 ≥2개 매칭 시 분류 단계에서 corrected 치환
  - **cluster-level**: 같은 (productKey, 원래 카테고리, 원래 라벨)이면 topIssue 치환 (안전망)
- 체크리스트 체크 상태 localStorage 영속화 (key=`reviewfit:checklist:{aid}:{pkey}`, **action 텍스트 기반**)
- Sass `lighten()` → `color.adjust()` 마이그레이션 (deprecation 경고 제거)
- 검증 스크립트 3종: `npm run check` / `build:frontend` / `check:llm`
- 데모 데이터 확장 — 14개 상품 / 133개 리뷰 (분류 품질 검증용 17건 포함)

## 10. 남은 TODO

| 우선순위 | 항목 | 비고 |
|---|---|---|
| 🟥 높음 | **체크리스트 DB 영속화** | 현재 localStorage. 멀티 디바이스 대응. 별도 라우트 1개 추가 예정 |
| 🟥 높음 | **실제 셀러 파일 기반 검증** | `docs/seller-validation-template.md` 양식으로 인터뷰 수집 |
| 🟧 중간 | **카페24 OAuth 실제 연동** | 설계: `docs/cafe24-oauth-plan.md` |
| 🟧 중간 | **`user_corrections` 고도화** | 현재 키워드 ≥2개 substring 매칭. 임베딩/유사도 매칭으로 정밀도 ↑ |
| 🟧 중간 | **샘플 데이터 지속 확장** | 14상품/133건 → 카테고리/상품군 추가 |
| 🟨 낮음 | **ECharts tree-shaking 세부 최적화** | 필요 차트만 import → gzipped 추가 절감 |
| 🟨 낮음 | **프롬프트 캐싱 / 배치 호출** | 설계: `docs/llm-cost-optimization.md` |
| 🟨 낮음 | **PDF 정식 출력** | 현재 `window.print` 기반 + 인쇄 전용 CSS |
| 🟨 낮음 | **기간별 트렌드** | 작성일 기반 월간 추세 차트 |
| 🟨 낮음 | **표 붙여넣기 업로드** | 엑셀 셀 복사→붙여넣기 직접 분석 |
| 🟨 낮음 | **말투 옵션 확장** | 현재 기본/정중/친근 3종 → 브랜드 톤 학습 |
| 🟨 낮음 | DB 추상화 / PostgreSQL 전환 / SaaS 사용자·워크스페이스 | |

### 별도 문서

- `docs/deploy-render.md` — Render 단일 Web Service 배포 가이드
- `docs/seller-validation-template.md` — 셀러당 1부 작성하는 인터뷰/평가 양식
- `docs/validation-results.md` — 실제 셀러 검증 결과 누적 기록 (검증 요약표 + 검증 N 블록)
- `docs/sample-report.md` — 셀러용 샘플 리포트 (116건/14상품 실제 분석값)
- `docs/landing-copy.md` — 무료 진단 모집·DM·랜딩 카피 모음
- `docs/llm-cost-optimization.md` — 캐싱·배치 호출 설계 (구현 보류)
- `docs/cafe24-oauth-plan.md` — 카페24 OAuth 8단계 계획 (구현 보류, 크롤링 비추천 명시)
