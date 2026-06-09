# Render Blueprint (`render.yaml`) 배포 가이드

이 문서는 저장소 루트의 `render.yaml` 을 사용한 자동 배포와 향후 worker 분리 계획을 설명합니다.
수동 단계별 설정은 `docs/deploy-render.md` 를, SQLite 영구 저장 운영 체크리스트는
`docs/render-deployment.md` 를 함께 참고하세요.

---

## 현재 구조

```
[Render Web Service: reviewfit]
  ├─ buildCommand: npm run render:build
  │   └─ frontend ci(--include=dev) + frontend build + backend ci(--omit=dev)
  ├─ startCommand: npm run render:start  →  backend Express
  ├─ healthCheckPath: /api/health
  └─ disk: /var/data (1GB Persistent Disk for SQLite)
```

- **단일 web service** — Express 가 `/api/*` 와 `frontend/dist` 정적 파일 모두 서빙.
- **분석 job 은 in-process** — `setImmediate` + heartbeat. 외부 큐 미사용.
- **DB 는 SQLite** — `DB_PATH=/var/data/reviewfit/app.db` 로 Persistent Disk 마운트.

---

## 빠른 시작

1. Render Dashboard → **New +** → **Blueprint** → 이 저장소 선택.
2. `render.yaml` 이 자동 감지되면 **Apply** 클릭.
3. `sync: false` 로 표시된 변수는 Dashboard 에서 직접 입력:
   - `CLIENT_ORIGIN` — 본 서비스가 받은 URL (첫 배포 후 확인 가능).
   - `AUTH_JWT_SECRET` — 32자 이상 강한 임의 값. dev fallback / 짧은 값 → production 부팅 거부.
   - `ADMIN_EMAILS` — 운영 관리자 이메일 (쉼표 구분).
   - `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` — Google 로그인 사용 시 (둘 다 같은 값).
   - `OPENAI_API_KEY` — 실제 LLM 사용 시.
4. 첫 배포 끝나면 URL 을 `CLIENT_ORIGIN` 에 채워 넣고 재배포.

`AUTH_JWT_SECRET` 생성:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> ⚠️ `VITE_GOOGLE_CLIENT_ID` 는 **빌드 타임 인라인** 변수입니다. 추가/변경 후 반드시
> **Manual Deploy → Deploy latest commit** 으로 새 빌드를 띄워야 적용됩니다.

---

## 부팅 강제 검사

production 환경에서 다음이 잘못되면 web 이 **부팅 거부** 합니다 (P0 안전 패치).

| 변수 | 값 | 미설정/잘못 시 로그 |
|---|---|---|
| `AUTH_JWT_SECRET` | 32자 이상 강한 임의 값 | `AUTH_JWT_SECRET is required in production` |
| `AUTH_JWT_SECRET` | dev fallback `reviewfit-dev-secret-change-me` | `AUTH_JWT_SECRET must not be the development fallback value` |
| `AUTH_JWT_SECRET` | 32자 미만 | `AUTH_JWT_SECRET is too short` |
| `DEMO_ALLOW_ANONYMOUS` | `true` | `DEMO_ALLOW_ANONYMOUS=true is not allowed in production` |

---

## In-process 분석 job — 운영 한계와 회복 정책

| 상황 | 동작 |
|---|---|
| 분석 중 web 재시작 / 배포 | `recoverStaleAnalysisJobs()` 가 부팅 시 `processing`/`pending` 상태로 30분 (`ANALYSIS_STALE_PROCESSING_MINUTES`) 넘은 row 를 `failed` 로 전이. 사용자는 "다시 분석" 버튼으로 재시작. |
| 분석 중 메모리 부족 (OOM) | web 이 죽고 위와 동일 흐름. |
| 동시 분석 다수 | web 프로세스 1개에 메모리 부담 누적. Starter+ 플랜으로 상향 검토. |
| 외부 LLM 응답 지연 | progress chip 이 멈춰 보일 수 있음. `LLM_TIMEOUT_MS` 로 차단 (기본 20s). |

---

## Worker 분리 계획 (이번 PR 범위 밖)

### Phase 1: Render Background Worker

`render.yaml` 하단 주석에 worker 블록 예시가 있습니다. web 은 enqueue/응답, worker 는 분석 실행.

활성화 조건:
- 동시 분석 사용자가 늘어 web 의 OOM/지연이 발생.
- 또는 분석 시간이 길어져 web 응답성에 영향.

### Phase 2: Redis + BullMQ

- 외부 Redis (Render Managed Redis / Upstash).
- `analysisJob.service.js` 의 `setImmediate(runAnalysisJob)` 호출을 `queue.add(...)` 로 교체.
- worker 가 `queue.process(...)` 로 pull.
- BullMQ `attempts`/`backoff` 로 재시도 정책.

### Phase 3: DB 분리 검토

SQLite + Persistent Disk 는 web/worker 동시 쓰기 시 잠금 경쟁이 발생합니다. 도입 시:

- **단순**: worker 는 큐 메시지로 결과 전달 → web 이 commit (DB 쓰기는 web 단독).
- **본격**: PostgreSQL (Render Managed) 마이그레이션 + `better-sqlite3` → `pg`/`drizzle`.

---

## 검증

배포 직후:

1. `https://<url>/api/health` → `{"ok":true,"aiMode":"mock"}` (또는 openai)
2. 회원가입/로그인 → 분석 히스토리 진입
3. 샘플 업로드 → 분석 완료 → 리포트 확인
4. (Google 설정 시) `/login` 에서 "Google로 계속하기" 버튼 보임 → 정상 로그인

---

## 참고 문서

- `docs/deploy-render.md` — Blueprint 없이 Dashboard 수동 설정.
- `docs/render-deployment.md` — SQLite 영구 저장 운영 체크리스트.
- `docs/google-login-setup.md` — Google OAuth Client 발급.
- `docs/data-retention-policy.md` — 사용자 데이터 보존 정책.
- `docs/billing-integration-plan.md` — PG 결제 도입 계획.
