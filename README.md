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

요구사항: **Node.js 18+** (better-sqlite3 컴파일을 위해 빌드 도구가 필요할 수 있음)

```bash
# 1) 백엔드
cd backend
npm install
cp .env.example .env          # 필요 시 값 수정 (없어도 mock 으로 동작)

# 2) 프론트엔드
cd ../frontend
npm install
```

---

## 3. 실행 방법

터미널 2개를 사용합니다.

```bash
# 터미널 A — 백엔드 (http://localhost:4000)
cd backend
npm run dev      # 또는 npm start

# 터미널 B — 프론트엔드 (http://localhost:5173)
cd frontend
npm run dev
```

브라우저에서 **http://localhost:5173** 접속 →
랜딩에서 **“샘플 데이터로 체험하기”** 클릭하면 업로드 없이 바로 분석 결과를 볼 수 있습니다.

(선택) 샘플 XLSX 파일 생성:

```bash
cd backend
npm run seed:xlsx   # sample-data/sample_reviews_fashion.xlsx 생성
```

---

## 4. `.env.example`

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
MAX_UPLOAD_BYTES=10485760        # 10MB
DB_PATH=./data/app.db

# AI_PROVIDER: mock | openai | gemini | claude
# 키가 없거나 mock 이면 mock 응답으로 동작
AI_PROVIDER=mock
AI_API_KEY=
AI_MODEL=
```

> 실제 LLM을 붙이려면 `backend/src/services/aiClient.service.js` 의 `callLLM()` 안에서
> provider별 호출부만 구현하면 됩니다. 나머지 함수 시그니처는 그대로 유지됩니다.

---

## 5. 사용 흐름 (UI)

1. **랜딩** → “샘플 데이터로 체험하기” 또는 “리뷰 파일 업로드하기”
2. **업로드** → 플랫폼 선택 후 CSV/XLSX 업로드 (개인정보 자동 마스킹)
3. **컬럼 매핑 확인** → 자동 매핑 결과 확인/수정, 템플릿 저장 가능
4. **대시보드** → 전체 요약, 카테고리 분포 차트, 상품별 문제 TOP 10
5. **상품 상세 리포트** → 주요 이슈 + 근거 리뷰 + 상세페이지 수정안 + CS 답글 초안
6. **다운로드** → CSV 내보내기 / 인쇄(PDF)

---

## 6. 주요 로직 설명

### 컬럼 자동 매핑 (`columnMapping.service.js`)
- 플랫폼마다 다른 컬럼명을 공통 스키마(`productName, content, rating ...`)로 매핑.
- 점수: **정확 일치 100 / 공백·기호 제거 후 일치 90 / 포함 관계 70**.
- 데이터 패턴 가산점: rating 값이 1~5(+20), createdAt 날짜 형태(+20), content 긴 텍스트(+20).
- 충돌 방지를 위해 `content → productName → ...` 우선순위로 컬럼을 1:1 배정.

### 개인정보 마스킹 (`privacyMasking.service.js`)
- 전화번호 `[전화번호]`, 이메일 `[이메일]`, 10자리 이상 숫자 `[주문번호]`, 주소 `[주소]`.
- 작성자명은 첫 글자만 남기고 마스킹. **원본 파일은 디스크에 저장하지 않습니다**(메모리 파싱 후 결과만 DB 저장).

### 하이브리드 분석 (`reviewClassification` + `issueDetection` + `productAnalysis`)
- **비용 절감**을 위해 LLM에 전체 리뷰를 넣지 않습니다.
  1. 규칙(키워드) 기반 **멀티라벨** 1차 분류 (한 리뷰에 사이즈+색상+소재 동시 가능)
  2. rating(1~2 부정 / 3 중립 / 4~5 긍정), 없으면 텍스트 감성 추정
  3. 카테고리가 없거나 신뢰도가 낮은 **애매한 리뷰만** LLM에 위임
  4. 상품·카테고리별로 **규칙 라벨 + 자카드 유사도**로 세부 이슈 클러스터 생성
  5. 라벨이 안 만들어진 묶음만 LLM이 이름 생성
  6. 상품별 요약/상세페이지 액션/답글 초안 생성 → DB 저장
- 모든 결과에 **근거 리뷰(evidenceReviews)** 와 **source(rule/llm/cluster)** 를 남겨 신뢰성과 사후 수정을 지원합니다.

### 패션 분석 카테고리 (고정 10종)
`사이즈 · 핏/실루엣 · 색상/화면 차이 · 소재/두께 · 마감/불량 · 착용감 · 세탁/내구성 · 배송/포장 · 가격/가성비 · 기타`

### LLM 추상화 (`aiClient.service.js`)
- `classifyAmbiguousReviews / generateIssueLabel / generateProductImprovementReport / generateReplyTemplates / generateMonthlyReport`
- API 키가 없으면 **mock** 응답 반환 → 로컬에서 완전 동작.
- LLM 응답은 항상 JSON으로 받고, **파싱 실패 시 fallback/기본 템플릿**으로 대체.

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
| GET | `/api/analysis/:id/products/:productKey` | 상품 상세 |
| GET | `/api/analysis/:id/export.csv` | 결과 CSV 다운로드 |
| POST | `/api/ai/reply-templates` | 이슈별 답글 템플릿 생성 |

---

## 8. 샘플 데이터
`sample-data/sample_reviews_fashion.csv` — 6개 상품(린넨 와이드 팬츠, 오버핏 반팔 티셔츠, 니트 가디건,
슬림핏 셔츠, 플리츠 롱스커트, 데님 자켓), 총 60개 리뷰.
허리 작음/기장 김/색상 어두움/원단 얇음/실밥·마감/배송 지연/포장 구김/가성비/핏 예쁨/재구매 등
다양한 케이스와 개인정보(전화·이메일·주문번호) 마스킹 테스트 데이터를 포함합니다.

---

## 9. 앞으로 확장할 기능 목록
- **카페24 OAuth 연동**: 게시판 목록 조회 → 리뷰 게시판(board_no) 선택 → articles/comments 조회. (현재 `source` 필드와 서비스 레이어가 확장 지점)
- **임베딩 기반 클러스터링**: 현재 규칙+자카드 → 문장 임베딩으로 세부 이슈 정밀도 향상 (`issueDetection.service.js` 교체).
- **PostgreSQL 전환**: MVP는 SQLite, 서비스 레이어 분리로 DB 교체 용이.
- **사용자/멀티 스토어(SaaS)**: `stores`/`users` 테이블, 인증, 워크스페이스.
- **사용자 분류 수정 반영(user correction)**: `source: "user"` 로 저장 후 재학습/재집계.
- **PDF 리포트 정식 출력**, **기간별/월간 트렌드**, **표 붙여넣기 업로드**.
- **말투 옵션 확장** 및 브랜드 톤 학습.
```
