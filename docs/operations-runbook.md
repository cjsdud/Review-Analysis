# ReviewFit 운영 런북 (Operations Runbook)

> 베타 운영 중 문제가 발생했을 때 무엇을, 어디서, 어떻게 확인하고 복구할지 정리한 단일 진입점.
> 개별 설정은 `docs/deploy-render.md`, `docs/render-deployment.md`, `docs/google-login-setup.md`,
> `docs/ops-settings.md`, `docs/beta-release-checklist.md` 를 함께 참고하세요.

ReviewFit은 셀러가 직접 내려받은 리뷰 **CSV/XLSX** 파일을 업로드해 분석하는 서비스입니다.
자동 크롤링 / 쇼핑몰 OAuth 자동 수집은 제공하지 않습니다.

**로그인은 Google 로그인 only** 입니다. 이메일/비밀번호 가입·로그인 엔드포인트(`/api/auth/register`,
`/api/auth/login`)는 제거되었으며, 모든 사용자 인증은 Google ID Token 검증으로 진행됩니다.
`GOOGLE_CLIENT_ID` 와 `VITE_GOOGLE_CLIENT_ID` 가 설정되어 있지 않으면 사용자가 로그인 자체를 할 수 없으므로
운영 환경에서는 **필수** 입니다.

---

## 0-A. Google 로그인 only 전환 시 1회 마이그레이션 (구버전 DB)

이메일/비밀번호 로그인이 운영 중이던 구버전 DB 가 있다면, 기존 user/analysis/공유 코드는
새 정책에서 영원히 접근 불가능합니다. **클린 시작** 정책을 따릅니다:

1. (선택) 백업: Render Shell 에서 `cp $DB_PATH /var/data/backup-pre-google-only.db`
2. DB 파일 삭제: `rm $DB_PATH $DB_PATH-wal $DB_PATH-shm 2>/dev/null || true`
3. 재배포 → 첫 부팅에서 빈 스키마가 다시 생성됨
4. `SEED_ADMIN_EMAIL` 또는 `ADMIN_EMAILS` 에 운영자 Google 이메일 등록
5. 운영자가 Google 로그인 → 자동으로 admin role 부여
6. 베타 셀러는 다시 안내 후 Google 로그인 → 신규 user 로 가입 → 다시 업로드/분석

기존 회원의 분석 결과는 복구되지 않습니다. 신규 베타라면 무관합니다.

---

## 0. 운영 전 1회 점검 (배포 직전)

이 항목이 빠지면 부팅이 실패하거나 운영 중 데이터가 사라집니다.

| # | 항목 | 확인 방법 |
|---|---|---|
| 1 | `AUTH_JWT_SECRET` 가 32자 이상 임의 값 | 부팅 로그에 `AUTH_JWT_SECRET ... must be ...` 메시지가 없는지 |
| 2 | `DEMO_ALLOW_ANONYMOUS` 가 `false` 또는 미설정 | `production + true` 면 부팅 거부 |
| 3 | `DB_PATH` 가 Persistent Disk 내부 (`/var/data/...`) | `[db] SQLite path: /var/data/...` 로그 |
| 4 | `CLIENT_ORIGIN` 가 실제 서비스 URL (슬래시 없이) | `https://your-app.onrender.com` |
| 5 | `GOOGLE_CLIENT_ID` 와 **`VITE_GOOGLE_CLIENT_ID` 동일 값** | 두 값이 다르면 버튼이 떠도 인증 실패 |
| 6 | `ADMIN_EMAILS` 에 운영 관리자 1명 이상 | 부팅 로그에 `[admin] Promoted configured admin email: ...` |
| 7 | `SEED_ADMIN_EMAIL` / `SEED_ACCOUNTS_ENABLED` 사용 시 비밀번호는 env 로만 | `docs/ops-settings.md` 참조 |
| 8 | `OPENAI_API_KEY` + `LLM_PROVIDER=openai` | `GET /api/health` → `{ "ok": true, "aiMode": "openai" }` |
| 9 | Render Persistent Disk 가 실제 attach 되었는지 | Render 대시보드 → Disks 탭에 mount path 표시 |

---

## 1. 운영 환경 변수 한 장 요약

| 변수 | 필수? | 운영 권장값 | 영향 |
|---|---|---|---|
| `NODE_ENV` | ✅ | `production` | 부팅 가드(JWT, 익명 차단, ephemeral 경로 경고) 활성화 |
| `AUTH_JWT_SECRET` | ✅ | 32자 이상 임의 값 | 미설정/짧음/dev fallback → **부팅 거부** |
| `DEMO_ALLOW_ANONYMOUS` | ✅ | `false` (또는 미설정) | `true` 면 부팅 거부 — 익명 분석 교차 접근 차단 |
| `CLIENT_ORIGIN` | ✅ | `https://<domain>` | CORS / 쿠키 도메인 |
| `DB_PATH` | ✅ | `/var/data/reviewfit/app.db` | Disk 외부면 재배포마다 DB 초기화 |
| `GOOGLE_CLIENT_ID` | **✅** | Google Cloud Web Client ID | 미설정 시 모든 사용자가 로그인 불가 (Google only 정책) |
| `VITE_GOOGLE_CLIENT_ID` | **✅** | 위와 동일 값 | **변경 시 frontend 재빌드 필수** |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | 선택 | seed 1회용 | 비밀번호 노출 금지, 로그에 출력되지 않음 |
| `ADMIN_EMAILS` | 권장 | 콤마 구분 이메일 | 부팅 시 자동 role=admin 보정 |
| `OPENAI_API_KEY` | 선택 | sk-... | 없으면 mock 모드 (운영 비추천) |
| `LLM_PROVIDER` | 선택 | `openai` | `mock` 이면 결과가 더미 |
| `MAX_UPLOAD_BYTES` | 선택 | `10485760` (10MB) | 파일 크기 한도 |
| `UPLOAD_ROWS_TTL_MIN` | 선택 | `60` | 임시 파싱 데이터 보존 시간 |
| `BILLING_ENFORCE_LIMITS` | 선택 | `false` (베타) | `true` 면 플랜 한도 실제 차단 |
| `AUTH_RATE_LIMIT_MAX` 등 | 선택 | 기본값 충분 | `docs/render-deployment.md` 참조 |

`Google` 키만 빠져 있어도 부팅은 정상이며 Google 버튼만 사라집니다 — 즉 **나중에 키만 채우고 재배포**하면 Google 로그인이 켜집니다. 코드 변경 불필요.

---

## 2. Google OAuth 설정 (요약)

자세한 절차는 `docs/google-login-setup.md`. 운영 진입 전 확인 항목만 정리.

1. Google Cloud Console → APIs & Services → **Credentials** → **OAuth 2.0 Client IDs** → **Web application**
2. **Authorized JavaScript origins** 에 다음 모두 추가:
   - `https://<your-app>.onrender.com` (운영)
   - `http://localhost:5173` (로컬 개발 시)
3. **Authorized redirect URIs** 는 비워둬도 됨 (ID Token 검증 방식이라 redirect 사용 X)
4. 발급된 **Client ID** 를 Render env 의 `GOOGLE_CLIENT_ID` + `VITE_GOOGLE_CLIENT_ID` **양쪽에 같은 값**으로 설정
5. `VITE_GOOGLE_CLIENT_ID` 는 빌드 시점에 번들에 박힌다 — **값 변경 후에는 반드시 Render "Clear build cache & deploy"**
6. 운영 배포 후 `/login` 진입 → Google 버튼 표시 + 클릭 시 Google 계정 선택 팝업이 뜨는지 확인

> **Google 로그인 only 정책** — 키가 없으면 사용자가 로그인 자체를 할 수 없습니다.
> 베타 진입 전 반드시 `GOOGLE_CLIENT_ID` + `VITE_GOOGLE_CLIENT_ID` 를 설정해야 합니다.
> (이메일/비밀번호 가입·로그인 엔드포인트는 제거되었습니다.)

---

## 3. 배포 직후 Smoke Test

배포 완료 후 5분 내에 아래를 사람이 직접 확인합니다. 실패 시 § 7 참조.

| # | 경로 | 기대 결과 |
|---|---|---|
| 1 | `GET /api/health` | `{"ok":true,"aiMode":"openai"}` (mock 이면 LLM env 누락) |
| 2 | `/` | 비로그인: 랜딩 / 로그인: `/history` 로 리다이렉트 |
| 3 | `/login` | 이메일 폼 + (env 설정 시) Google 버튼 |
| 4 | `/history` (로그인 후) | 분석 히스토리 또는 "분석이 없습니다" 빈 상태 |
| 5 | `/terms`, `/privacy` | 비로그인에서도 접근 가능, 문구가 자동 수집/매출 보장을 약속하지 않음 |
| 6 | `/samples/reviewfit_beta_demo_reviews.xlsx` | 베타 데모 엑셀 다운로드 (200) |
| 7 | `/demo/sample-report` | 정적 샘플 리포트 (비로그인 OK) |
| 8 | `/share` | 공유 코드 입력 폼 (비로그인 OK) |
| 9 | `/admin` (admin 로그인) | 관리자 콘솔 진입 |
| 10 | Render 로그 | `AUTH_JWT_SECRET ...` / `DEMO_ALLOW_ANONYMOUS ...` 에러 없음, `[db] SQLite path: /var/data/...` |

브라우저 콘솔에 `Each child in a list should have a unique "key" prop` 같은 경고가 없으면 OK.

---

## 4. 운영 QA 체크리스트 (배포 후 1회)

`docs/beta-release-checklist.md` 의 상세 항목을 운영 도메인에서 다시 한 번. 빠뜨리기 쉬운 항목만 추려두면:

### 4-1. 인증 / 권한
- 이메일+비밀번호 가입 → 자동 로그인 → 분석 1건 실행
- Google 로그인 → 같은 이메일 local 계정과 자동 연결 (분석/플랜 보존)
- 잘못된 비밀번호 5회 → `429` (잠금)
- `ADMIN_EMAILS` 이메일이 admin role 로 부팅됨 → `/admin` 진입 가능
- 일반 사용자가 `/admin` 접근 → `403`

### 4-2. 파일 업로드
- 베타 데모 엑셀 (`/samples/reviewfit_beta_demo_reviews.xlsx`) 업로드 → 자동 매핑 → 분석 → 리포트
- 실제 셀러 엑셀(스마트스토어/카페24/쿠팡 중 1개) 업로드 → 컬럼 자동 매핑 정확도
- 작성일 컬럼이 **있는** 파일 → 기간별 리뷰 변화 섹션 정상 (Pro+)
- 작성일 컬럼이 **없는** 파일 → 전체 분석 정상 + 기간 섹션 빈 상태 안내

### 4-3. 분석 / 리포트
- 분석 진행률이 25%/45%에서 단계 문구 갱신 (멈춰 보이지 않음)
- 대시보드 → 상품 상세 → 핵심 문제 → 관련 리뷰 모달 (전화/이메일/주문번호 마스킹)
- CS 답글 5종 톤 전환 시 다른 문체 답글 (같은 톤 재클릭 시 재요청 없음)
- 긍정 리뷰 기반 답글에 불필요한 "죄송합니다" 없음
- 분석 모드 chip 이 플랜에 맞게만 노출 (Free 는 quick 만)

### 4-4. 사용량 / 플랜
- topbar 플랜 chip 클릭 → 이번 달 분석/파일/CS 답글 게이지 3개
- 분석 1건 실행 후 chip 카운트 +1 (자동 refresh)
- PricingPage 의 한도가 `/api/plans/features` 의 실제 한도와 일치

### 4-5. 관리자
- AI 분석 로그 — 데스크톱 테이블 + 모바일(≤768px) 카드 reflow, 콘솔에 key warning 없음
- 비용이 `$0.0000` 이 아닌 실제 값 또는 `< $0.0001`
- 사용자 plan 변경 → 해당 사용자가 **다음 요청부터** 새 plan 적용 (JWT 의 stale plan 신뢰 X)
- 실패 분석 retry → pending 전환 + 재실행

### 4-6. 삭제 / 탈퇴
- 분석 삭제 → 즉시 목록에서 사라짐
- 진행 중 분석은 삭제 버튼 자체가 보이지 않음
- 다른 계정의 `analysisId` URL 직접 접근 → 403/404
- 계정 탈퇴 → 재로그인 불가 + 같은 이메일 재가입 가능 (신규)
- 마지막 admin 탈퇴 시도 → 차단

### 4-7. 공유 코드 (베타 영업용)
- admin 이 분석에 공유 코드 발급 → `RF-XXXX-XXXX` 형식
- 비로그인 사용자가 `/share/<code>` 접근 → 읽기 전용 리포트
- 만료 / 회수 / 잘못된 코드 모두 동일한 "공유 코드를 확인할 수 없습니다." (코드 존재 여부 미노출)

### 4-8. 모바일 (390px)
- 로그인 / 업로드 / 매핑 / 히스토리 / 대시보드 / 상품 상세 가로 깨짐 없음
- 리뷰 모달이 화면 안에 들어옴
- topbar 의 사용량 chip 이 플랜명만 간결하게

### 4-9. 문구 / 법적
- 랜딩·가격표·로그인 어디에도 자동 수집/플랫폼 계정 연동/정확도·매출 보장 표현 없음
- "raw", "row", "업로드 데이터" 같은 개발자 표현 미노출
- "LLM", "token", "mini", "API" 같은 내부 표현 미노출
- `/terms`, `/privacy` 접근 가능 + 로그인 화면 동의 안내 링크 정상

---

## 5. 모니터링 / 일상 점검 (주 1회)

| 항목 | 어디서 | 임계치 |
|---|---|---|
| 부팅 로그에 `[db][warning]` | Render Logs | 0건 |
| `GET /api/health` aiMode | curl | `openai` (운영 시) |
| 관리자 콘솔 → AI 분석 로그 → 이번 달 예상 비용 | `/admin/llm-logs` | 예산 대비 확인 |
| 실패 분석 비율 | `/admin/analysis-status-summary` | 부분 상승 시 § 7-1 |
| Persistent Disk 사용량 | Render Disks | 70% 이상이면 정리 / 확장 검토 |
| 관리자 액션 로그 | `/admin/action-logs` | 의도하지 않은 권한 변경 없는지 |
| 공유 코드 누적 / 만료 | `/admin/shares` | 더 이상 안 쓰는 코드 회수 |

---

## 6. 운영 백업 / 복구

현재 단계:
- DB 는 SQLite 단일 파일 (`DB_PATH` 가 가리키는 위치).
- Render Persistent Disk 는 disk-level snapshot 을 별도로 제공하지 않습니다.
- 임시 백업 절차: Render Shell 에서 `sqlite3 $DB_PATH ".backup '/tmp/backup.db'"` → 다운로드.
- 자동화는 P1 TODO `feat/admin-db-backup-download` 로 추적합니다.

복구 절차:
1. 새 Render 서비스 만들기 → 같은 env 설정 + Persistent Disk 부착
2. Render Shell 에서 백업 파일을 `$DB_PATH` 위치에 복사
3. 재배포 → 부팅 로그 `[db] SQLite path: /var/data/...` 확인

---

## 7. 실패 대응 시나리오

증상 → 1순위 의심 → 확인 명령/위치 → 즉시 조치 순서.

### 7-1. 분석이 `failed` 로 마감됨

| 단계 | 확인 |
|---|---|
| 1 | 관리자 콘솔 → 분석 히스토리 → 해당 분석의 `errorMessage` |
| 2 | Render Logs 에서 같은 시각 `[analysis] background error ...` 검색 |
| 3 | `/admin/llm-logs` 에서 해당 `analysisId` 의 마지막 호출 status / errorMessage |

**조치**
- LLM 호출 실패 (rate limit / 5xx) → 5분 대기 후 `/admin/analyses/:id/retry` 또는 `adminApi.retryAnalysis(id, "재시도")`
- 입력 파일 자체 문제 (헤더 매핑 실패 등) → 셀러에게 매핑 안내 + 재업로드
- 같은 분석에서 3회 연속 실패 → `OPENAI_API_KEY` / 모델명 점검 후 재시도

### 7-2. 분석이 `processing` 에서 멈춰 있음 (1시간+)

| 단계 | 확인 |
|---|---|
| 1 | Render 가 그동안 재시작/배포된 적이 있는지 (배포 직후 분석은 stale 처리되어야 함) |
| 2 | `recoverStaleAnalysisJobs` 가 부팅 시 실행되었는지 (server.js, "analysisJob recovery skipped" 같은 메시지가 있으면 실패) |
| 3 | `analysis_jobs` 에서 status='processing' + started_at 이 오래된 row 직접 확인 |

**조치**
- 부팅 시 자동 복구 — 재시작만 해도 stale → failed 로 전환
- 그래도 남아 있으면 `/admin` → 해당 분석 retry → 그래도 안 되면 admin SQL 로 `status='failed', error_message='수동 복구'` 마킹 후 사용자에게 재업로드 안내
- P1 TODO `fix/stale-analysis-job-recovery` 로 자동 감지 강화 예정

### 7-3. OpenAI 호출이 계속 실패함

| 단계 | 확인 |
|---|---|
| 1 | `GET /api/health` → aiMode 가 `openai` 인지 |
| 2 | `/admin/llm-logs` → status 가 `error` 또는 fallback_used=1 비율 |
| 3 | Render Logs 에 `OpenAI` / `429` / `rate_limit` / `insufficient_quota` 검색 |

**조치**
- Quota 초과 → 결제 정보 / OpenAI 대시보드 확인
- 모델명 이슈 → env 의 모델명 (`OPENAI_MODEL` 등) 확인, 기본값 사용
- 일시 장애 → `LLM_PROVIDER=mock` 임시 전환으로 베타 영업 중단 회피 (CS 답글 / 인사이트 품질은 떨어짐 — 사용자에게 안내)

### 7-4. Google 로그인이 안 됨

Google 로그인 only 환경이므로 이 케이스는 **모든 신규 사용자가 사이트를 사용할 수 없음** 을 의미합니다 — 최우선 대응.

| 단계 | 확인 |
|---|---|
| 1 | `/login` 페이지에 Google 버튼이 보이는가? | 안 보이면 `VITE_GOOGLE_CLIENT_ID` 미설정 → env 추가 후 **Clear build cache & deploy** |
| 2 | 클릭 시 "Sign in with Google" 팝업이 뜨는가? | 안 뜨면 Authorized JS origin 누락 |
| 3 | 팝업 후 401 / 403 | `GOOGLE_CLIENT_ID` (백엔드) 와 `VITE_GOOGLE_CLIENT_ID` (프론트) 값이 다름 |
| 4 | "이메일이 확인되지 않았습니다" 에러 | 사용자 Google 계정의 email_verified=false — 안내 후 이메일 인증 요청 |
| 5 | "Google 로그인 설정이 완료되지 않았어요" | 백엔드 `GOOGLE_CLIENT_ID` 미설정 또는 부팅 후 변경됨 — 재배포 |

**조치**
- env 값 둘이 다르면 동일하게 맞춘 뒤 **Clear build cache & deploy**
- Authorized JS origins 에 운영 도메인 추가 후 5분 대기 (Google 캐시)
- 임시 운영 안내: 사이트 점검 공지 (관리자 콘솔 → 공지/배너) 로 안내 후 빠르게 env 수정

### 7-5. 환경 변수 누락으로 부팅 실패

| 증상 | 원인 | 조치 |
|---|---|---|
| `AUTH_JWT_SECRET is required in production` | env 미설정 | 32자 이상 임의 값 설정 → 재배포 |
| `AUTH_JWT_SECRET must not be the development fallback value` | dev fallback 그대로 사용 | 강한 임의 값으로 교체 |
| `AUTH_JWT_SECRET is too short` | 32자 미만 | 32자 이상으로 교체 |
| `DEMO_ALLOW_ANONYMOUS=true is not allowed in production` | env 잘못 설정 | `false` 로 교체 또는 env 제거 |

위 4가지는 부팅이 즉시 실패하므로 Render Logs 에 명확하게 노출됩니다.

### 7-6. DB_PATH 오류 (데이터 사라짐)

| 증상 | 원인 |
|---|---|
| 재배포 후 모든 계정/분석이 사라짐 | `DB_PATH` 가 ephemeral 경로 (앱 디렉터리 / 미설정) |
| `[db][warning] DB path "..." looks ephemeral on this host.` | 위와 동일 |

**조치**
1. Render → 서비스 → **Disks** → "Add Persistent Disk" → mount path `/var/data` (또는 임의)
2. env 에 `DB_PATH=/var/data/reviewfit/app.db` 추가
3. 재배포 → 부팅 로그에 `[db] SQLite path: /var/data/reviewfit/app.db` 확인
4. 이전 데이터는 ephemeral 에서 소실됨 — 베타 단계라면 사용자에게 재가입 안내 / 정식 운영 단계에서는 백업 복구 (§ 6)

### 7-7. Render 재배포 실패

| 증상 | 원인 | 조치 |
|---|---|---|
| `vite: not found` | frontend devDependencies 미설치 | Build Command 가 `npm run render:build` 인지 확인 (`docs/render-deployment.md`) |
| `npm ERR! ENOSPC` | 디스크 가득 참 | Render 캐시 정리, Disk 확장 |
| `Module not found: '...'` | branch 가 잘못된 commit 을 가리킴 | 올바른 commit 으로 강제 재배포 |
| 부팅 후 즉시 종료 | env 가드 (§ 7-5) | 로그 메시지대로 env 수정 |

### 7-8. 점검 모드 (Maintenance) 가 필요할 때

`/admin/settings` → `maintenance_mode` 를 `true` 로 변경 시:
- 일반 사용자 API 는 503 반환
- `/api/health`, `/api/auth/*`, `/api/admin/*`, `/api/announcements/active`, `/api/shared-reports/*` 는 통과
- 즉, 운영팀은 계속 admin / 공유 코드 영업 가능

복구: 설정 다시 `false` 로 변경.

### 7-9. 사용자가 비밀번호를 잊었거나 잠겼다고 신고

- 5회 연속 비밀번호 오입력 → IP 기준 15분 잠금. 시간이 지나면 풀림.
- 비밀번호 분실 셀프 리셋은 현재 미구현 → 운영자가 admin 콘솔에서 이메일 확인 후 재안내.
- (P2) 비밀번호 재설정 메일 흐름은 정식 운영 진입 시 추가.

---

## 8. 사용자 데이터 / 개인정보

- 모든 리뷰는 분석 시점에 `privacyMasking.service` 가 전화/이메일/주소/주문번호 등을 마스킹한 결과만 저장합니다.
- 원본 업로드 row(`upload_files.rows`) 는 `UPLOAD_ROWS_TTL_MIN` (기본 60분) 후 자동 삭제됩니다.
- 공유 코드 페이지(`/share/:code`)도 같은 마스킹 결과만 보여줍니다.
- API key / 리뷰 원문 / 비밀번호 / Google credential 은 절대 로그에 기록하지 않습니다.
- 사용자 탈퇴 시 본인 분석/업로드/공유 코드를 cascade 삭제하며 `admin_action_logs` 에 기록됩니다.

---

## 9. 운영 진입 직전 / 직후 체크 (요약)

**진입 직전**
- [ ] § 0 의 9가지 환경 점검 통과
- [ ] `docs/beta-release-checklist.md` 의 8 섹션 모두 ✓
- [ ] `npm run check` / `npm test` / `npm run build` 통과 (이번 커밋 기준)
- [ ] 베타 데모 엑셀 다운로드 / 업로드 / 분석 / 리포트 흐름 e2e 확인
- [ ] Persistent Disk attach 확인 + `DB_PATH` 로그 확인

**진입 직후 (24시간 내)**
- [ ] `GET /api/health` 가 5분 간격 5회 모두 200 (Render Free 의 cold start 포함)
- [ ] Render Logs 에 error / `[db][warning]` 없음
- [ ] 관리자 콘솔 → 분석 / LLM 로그 / 액션 로그 정상 표시
- [ ] 첫 베타 셀러 공유 코드 발급 → 외부 브라우저(로그인 없이)에서 정상 조회
- [ ] OpenAI 예상 비용 (이번 달) 가 예산 대비 정상

---

## 10. 관련 문서

- `docs/deploy-render.md` — Render 단일 Web Service 배포
- `docs/render-deployment.md` — Persistent Disk / 영구 저장 운영 배포
- `docs/google-login-setup.md` — Google OAuth Client 설정 절차
- `docs/ops-settings.md` — app_settings / 점검 모드 / 사용량 reset
- `docs/beta-release-checklist.md` — 베타 출시 수동 QA 상세
- `docs/data-retention-policy.md` — 데이터 보관/삭제 정책
- `docs/billing-integration-plan.md` — PG 연동 (미구현, 설계만)
- `docs/cafe24-oauth-plan.md` — 카페24 OAuth (검토 중 / 미구현, 설계만)
