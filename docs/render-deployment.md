# Render 운영 배포 체크리스트 (SQLite 영구 저장)

> 본 문서는 운영(Production) 배포 기준입니다. MVP 데모/체험용 배포는
> [`docs/deploy-render.md`](./deploy-render.md) 를 참고하세요.

## 핵심 원칙

ReviewFit 은 SQLite 를 사용합니다. **Render 의 일반 컨테이너 파일시스템은 ephemeral**(재배포·재시작 시 초기화)
이므로, SQLite 파일을 그대로 두면 **모든 사용자 계정 · 분석 히스토리 · 관리자 설정이 사라집니다.**

운영 배포는 반드시 **Render Persistent Disk** 를 붙이고, `DB_PATH` 를 Disk mount path 안쪽으로 지정해야 합니다.

| 구분 | DB_PATH 예시 | 결과 |
|---|---|---|
| ❌ 잘못된 설정 | `./data/app.db` (상대경로) | 매 배포마다 DB 초기화 |
| ❌ 잘못된 설정 | `/opt/render/project/src/backend/data/app.db` | 매 배포마다 DB 초기화 |
| ✅ 권장 설정 | `/var/data/reviewfit/app.db` (Disk mount path 안쪽) | 영구 저장 |

운영 모드에서 ephemeral 경로가 의심되면 부팅 로그에 `[db][warning]` 으로 경고가 출력됩니다.

---

## 0) Render Service 설정 (Build/Start/Node)

Render 대시보드 → 해당 Web Service → **"Settings"** 에서 다음을 명시적으로 지정.

| 항목 | 값 |
|---|---|
| Runtime | Node |
| Build Command | `npm run render:build` |
| Start Command | `npm run render:start` |
| Node Version | `20` (저장소 `.node-version` + `engines.node=20.x` 기본 적용. 환경변수 `NODE_VERSION=20` 명시 권장) |

### Build 동작 (vite: not found 방지)

`render:build` 는 다음을 차례로 실행합니다:

```bash
npm --prefix frontend ci --include=dev    # vite 등 devDependencies 까지 설치
npm --prefix frontend run build           # frontend/dist 생성
npm --prefix backend  ci --omit=dev       # backend runtime 의존성만 설치
```

- `npm ci --include=dev` 는 `NODE_ENV=production` / `NPM_CONFIG_PRODUCTION=true` 에서도
  devDependencies(vite/sass/@vitejs/plugin-react)를 강제로 설치합니다.
- backend 는 `--omit=dev` 로 runtime 의존성만 설치 (이미지 크기 절약).
- lock 파일(`frontend/package-lock.json`, `backend/package-lock.json`) 이 누락되면 `npm ci` 가 실패하므로 반드시 커밋되어 있어야 합니다.

> 자세한 트러블슈팅: [`docs/deploy-render.md` § vite: not found 해결](./deploy-render.md#vite-not-found-해결)

## 1) Persistent Disk 생성

Render 대시보드 → 해당 Web Service → **"Disks"** 탭 → **Add Disk**

| 항목 | 값 |
|---|---|
| Name | `reviewfit-data` (자유) |
| Mount Path | `/var/data` |
| Size (GB) | 1 GB (시작용. 추후 확장 가능) |

Disk 를 추가하면 서비스가 자동으로 재배포되며, 컨테이너 안 `/var/data/` 가 영구 저장 경로가 됩니다.

> ⚠️ Disk 는 **유료**입니다(1 GB = 약 $0.25/월 수준). Free 인스턴스는 Disk 미지원이므로
> 최소 **Starter** 이상이 필요합니다.

---

## 2) Mount path 확인

Render 대시보드의 Disk 정보에서 mount path 를 정확히 확인하세요. 예: `/var/data`

> mount path 가 `/var/data` 라면, 그 **안쪽 경로**(예: `/var/data/reviewfit/app.db`)를 DB_PATH 로 씁니다.
> mount path 바깥(`/var/app.db` 등)에 두면 영구 저장이 되지 않습니다.

---

## 3) 환경변수 설정

Render 대시보드 → **"Environment"** 탭 → 다음 값을 추가/수정.

```env
NODE_ENV=production
# ★ Node 버전 고정 — 저장소 루트의 .node-version / engines 가 기본 적용되지만
#    환경변수로도 한 번 더 명시해 두면 가장 안전합니다.
NODE_VERSION=20
PORT=10000
CLIENT_ORIGIN=https://your-app.onrender.com

# ★ 영구 저장 핵심 — Persistent Disk mount path 안쪽 경로
DB_PATH=/var/data/reviewfit/app.db

# 운영 기준 — DEMO_ALLOW_ANONYMOUS 는 환경변수를 빠뜨려도 기본값이 false 라 안전하지만,
# 명시적으로 false 를 설정해 두는 것을 권장합니다.
DEMO_ALLOW_ANONYMOUS=false
BILLING_ENFORCE_LIMITS=true
AUTH_JWT_SECRET=<반드시 강력한 임의값으로 교체>

# 관리자 부트스트랩
ADMIN_EMAILS=ops@yourcompany.com

# LLM (필요 시)
LLM_PROVIDER=mock
```

저장 후 자동 재배포됩니다.

---

## 4) 배포 로그에서 SQLite 경로 확인

배포 로그 또는 **"Logs"** 탭에서 다음 줄이 보여야 합니다.

```
[db] SQLite path: /var/data/reviewfit/app.db
[db] SQLite file exists: true
```

DB 파일이 없는 첫 부팅은 다음과 같이 출력됩니다.

```
[db] SQLite path: /var/data/reviewfit/app.db
[db] SQLite file exists: false
[db] SQLite file not found. A new database will be initialized.
```

DB_PATH 가 ephemeral 경로로 보이면 **반드시 다음 경고가 함께 출력**됩니다 — 즉시 수정하세요.

```
[db][warning] DB path "..." looks ephemeral on this host. ...
```

---

## 5) 새 배포 후 영속성 검증

운영 모드 전환 후, 한 번 더 **수동 배포**를 트리거해 데이터가 살아남는지 직접 확인합니다.

1. `/login` → 회원가입 (테스트 계정)
2. 샘플 데이터로 분석 1회 실행 → `/history` 에 표시되는지 확인
3. `/admin/settings` 에서 임의의 설정값 변경
4. Render 대시보드 → **Manual Deploy** → 같은 커밋으로 재배포
5. 재배포 후:
   - [ ] 로그인 계정이 유지되는가
   - [ ] `/history` 에 분석이 그대로 보이는가
   - [ ] `/admin/settings` 의 변경값이 유지되는가
   - [ ] `[db] SQLite file exists: true` 로그가 보이는가

위 4가지가 모두 통과하면 운영 영속성 OK.

---

## 6) DB 백업

SQLite 는 단일 파일이라 백업이 간단합니다.

### Render Shell 에서 수동 백업

```bash
# Render 대시보드 → "Shell" 탭 (Starter 이상)
DB_BACKUP_DIR=/var/data/reviewfit/backups npm run db:backup
```

결과 예:
```
[backup] source: /var/data/reviewfit/app.db
[backup] target: /var/data/reviewfit/backups/app-20260530-143000.db
[backup] 완료: /var/data/reviewfit/backups/app-20260530-143000.db (812.3 KB)
```

- `VACUUM INTO` 를 사용하므로 **실시간 쓰기 중에도 안전**합니다.
- 백업 폴더는 같은 Persistent Disk 안에 두면 디스크 장애 시 함께 잃을 수 있으니,
  정기적으로 **로컬/외부 스토리지로 다운로드**하는 것을 권장합니다.
  (Render CLI 또는 Shell 의 `sftp`/`scp` 사용)

### 자동화 TODO

- [ ] Render Cron Job 으로 매일 백업 + S3 업로드
- [ ] 백업 retention 정책(예: 최근 30일)

---

## 7) 주의사항 / 운영 권고

- **`backend/data/app.db` 는 운영 저장소로 사용 금지** — 매 배포마다 초기화됩니다.
- **새 배포 전 백업 권장** — `npm run db:backup` 으로 스냅샷 후 배포.
- **장기 운영 시 PostgreSQL / Supabase 이전 권장** — 동시성, 백업 자동화, 고가용성, 스케일아웃 측면에서
  SQLite + 단일 인스턴스 구조는 명확한 한계가 있습니다.
- **Render Disk 는 한 인스턴스에만 마운트** 가능 — 다중 인스턴스 / blue-green 배포 시에는 외부 DB 필수.
- **JWT secret** — 운영에서는 반드시 `AUTH_JWT_SECRET` 을 강력한 임의값으로 교체.
- **ADMIN_EMAILS** — 운영 책임자만 등록. 부팅 시마다 자동 보정됩니다.

---

## Render Free 베타 환경 (Persistent Disk 없이)

Render Free 인스턴스는 Persistent Disk 가 지원되지 않아 재배포 시 SQLite DB 가 초기화됩니다.
정식 운영 전 베타 검증 단계에서는 **서버 시작 시 관리자/베타 테스터 계정을 자동 생성**해
로그인 테스트를 즉시 가능하게 합니다.

### 환경변수

```env
NODE_ENV=production
DEMO_ALLOW_ANONYMOUS=false
AUTH_JWT_SECRET=<강력한 랜덤 문자열>
ADMIN_EMAILS=admin@example.com

# ★ 베타 계정 seed (운영 전환 시 false 로)
SEED_ACCOUNTS_ENABLED=true
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=<강력한_관리자_비밀번호>
SEED_TESTER_EMAIL=beta@example.com
SEED_TESTER_PASSWORD=<강력한_테스터_비밀번호>
```

### 동작 보장

- 비밀번호는 **bcrypt 해시로만** 저장 — 로그/응답에 절대 노출되지 않음.
- 같은 이메일 사용자가 이미 있으면 새로 만들지 않음 (중복 방지).
- seed admin 이메일이 이미 `role=user` 면 `admin` 으로 자동 보정.
- seed tester 이메일이 이미 `admin` 이면 자동 강등하지 않음 (마지막 admin 보호).
- 신규 시드 계정은 자동으로 free 구독 생성.
- 비밀번호 8자 미만은 해당 시드만 skip + warning.

### 부팅 로그 (정상 예시)
```
[seed] Seed accounts enabled. Ensuring configured accounts...
[seed] Admin seed email configured: admin@example.com
[seed] Created seed admin account: admin@example.com
[seed] Beta tester seed email configured: beta@example.com
[seed] Created seed beta tester account: beta@example.com
```

### 베타 → 정식 운영 전환 시

| 항목 | 베타 | 정식 운영 |
|---|---|---|
| Persistent Disk | 없음 (Free) | **반드시 설정** (Starter 이상) |
| `SEED_ACCOUNTS_ENABLED` | `true` | **`false`** |
| `SEED_*_PASSWORD` | env 에 임시 | env 에서 제거 / seed 계정 비밀번호 변경 |
| `DB_PATH` | 기본값 (ephemeral) | `/var/data/reviewfit/app.db` |

> ⚠️ 운영 전환 후에는 seed 계정의 비밀번호를 실제 운영자 계정으로 교체하거나 삭제하세요.
> seed 계정은 베타 검증용이므로 장기간 그대로 두지 마세요.

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 재배포 후 모든 계정 사라짐 | Persistent Disk 미설정 또는 DB_PATH 가 mount path 바깥. 로그의 `[db] SQLite path:` 확인 |
| `[db][warning] ephemeral` 경고 | DB_PATH 를 Persistent Disk mount path 안쪽으로 수정 |
| `EACCES: permission denied` (DB 경로) | Persistent Disk 마운트 권한 확인. Render 자동 처리되지만 mount path 오타 가능성 |
| 첫 부팅에서 `file exists: false` | 정상 (신규 DB 생성). 두 번째 부팅부터 `true` 가 보여야 함 |
| `database is locked` | WAL 모드 사용 중이므로 일반적으로 발생 안 함. Disk I/O 성능 또는 백업 도구 충돌 확인 |
