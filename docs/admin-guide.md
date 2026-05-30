# 리뷰핏 관리자 가이드

## 관리자 페이지

- 경로: `/admin`
- 접근 권한: `users.role = 'admin'` 사용자만.
- 일반 사용자가 `/api/admin/*` 호출 시 백엔드가 **403 FORBIDDEN** 반환.
- 비로그인 시 **401 UNAUTHORIZED**.

## 관리자 계정 승격

### 방법 A — 스크립트 (권장)

```bash
# 승격
npm run admin:promote -- admin@example.com
# 강등 (마지막 관리자는 자동 차단)
npm run admin:promote -- admin@example.com --demote
```

### 방법 B — 환경변수 `ADMIN_EMAILS` (권장)

`.env` 또는 배포 환경변수에 쉼표 구분으로 등록합니다. 대소문자/공백은 무시합니다.

```
ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

세 군데에서 자동으로 보정됩니다:

1. **서버 부팅 시** — `ADMIN_EMAILS` 의 이메일을 가진 기존 사용자 role 을 admin 으로 보정.
   (회원가입 전이면 `[admin] Configured admin email not found yet: <email>` 로그만 남기고 통과)
2. **신규 회원가입 시** — `POST /api/auth/register` 가 이메일을 비교해 admin 으로 즉시 생성.
3. **로그인 시** — 비밀번호 검증 성공 후 본인 이메일이 포함되어 있고 role 이 admin 이 아니면
   즉시 admin 으로 보정. **서버 재시작 없이도 다음 로그인부터 admin 반영**.

### 운영 적용 절차 (재배포 직후 확인)

1. Render 등의 환경변수에 `ADMIN_EMAILS=admin@example.com` 추가
2. 서버 재배포 (자동)
3. 부팅 로그 확인:
   ```
   [admin] ADMIN_EMAILS configured: 1
   [admin] Configured admin email not found yet: admin@example.com   ← 가입 전 정상
   [admin] Configured admin promotion complete. promoted=0
   ```
4. 해당 이메일로 `/login` 에서 회원가입 → 응답 `user.role === "admin"` 인지 확인
5. `GET /api/me` 호출 → `user.role === "admin"` 확인
6. `/admin` 접속 → 관리자 콘솔이 열리는지 확인
7. `GET /api/admin/summary` 가 200 응답인지 확인

> ⚠️ 환경변수 변경 후에는 **반드시 재배포/재시작** 이 필요합니다.
> 다만 이미 가입된 사용자는 재시작 없이도 다음 로그인 시 자동 보정됩니다.

## 메뉴별 기능

| 메뉴 | 경로 | 설명 |
| --- | --- | --- |
| 대시보드 | `/admin` | 사용자/분석/리뷰/플랜 요약 + 최근 액션 10건 |
| 사용자 관리 | `/admin/users` | 검색/role/plan 필터, role/plan/구독상태 변경, 할인 추가 |
| 리포트 추이 | `/admin/reports` | 7d/30d/90d, 일/주/월별 분석·리뷰·실패 수, 상위 사용자/source |
| 운영 설정 | `/admin/settings` | app_settings 카테고리별 수정. 변경 사유 입력 가능 |
| 공지/배너 | `/admin/announcements` | 공지 생성/수정/활성·비활성, 사용자 화면 상단 노출 |
| 액션 로그 | `/admin/action-logs` | actionType/targetType 필터 + 전/후 값 |

## 사용자 관리 시 주의사항

- **마지막 admin 보호** — 시스템에 admin 이 1명만 남아 있으면 그 계정을 user 로 변경할 수 없습니다.
- **본인 role 변경 금지** — 자기 자신의 role 은 변경할 수 없습니다(다른 admin 에게 요청).
- 변경 시 **사유(reason)** 입력을 권장합니다. 사유는 `admin_action_logs` 에 함께 저장됩니다.

## 운영 설정 (app_settings) 주의

- **API KEY 같은 secret 은 관리자 페이지에서 변경할 수 없습니다.** 환경변수로만 관리합니다.
  - `AUTH_JWT_SECRET`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_API_KEY`, `DB_PATH`
- 변경 가능한 키 목록과 의미는 [`docs/ops-settings.md`](./ops-settings.md) 참고.
- `maintenance_mode=true` 로 두면 일반 사용자 API 가 503 으로 차단됩니다.
  관리자 본인은 admin API 와 health 로 계속 접근 가능합니다.
- `signup_enabled=false` 로 두면 신규 가입이 차단됩니다.

## 공지 등록

- 타입: `info` / `warning` / `maintenance` / `promotion`.
- 활성 시작/종료 시각 지정 가능. 비워두면 항상 표시.
- 비활성 처리는 즉시 사용자 화면에서 사라지지만 데이터는 보존됩니다(감사용).
- 사용자 화면 상단 `AnnouncementBanner` 가 `GET /api/announcements/active` 결과를 표시합니다.

## 액션 로그

다음 변경은 모두 `admin_action_logs` 에 자동 기록됩니다:
- 사용자 role 변경
- 사용자 plan / 구독 상태 변경
- 사용자 할인 생성/수정
- 운영 설정 변경
- 공지 생성/수정/비활성

각 로그에 `admin_user_id`, `action_type`, `target_type`, `target_id`, `before_value`, `after_value`, `reason`,
`created_at` 이 저장되어 사후 추적이 가능합니다.

## 운영 전 보안 점검

- [ ] `AUTH_JWT_SECRET` 을 강력한 임의값으로 교체.
- [ ] `ADMIN_EMAILS` 에 운영 책임자만 포함, 평문 노출 금지.
- [ ] 관리자 계정 비밀번호 8자 이상 + 가능한 한 길게.
- [ ] `DEMO_ALLOW_ANONYMOUS=false` 로 전환.
- [ ] `BILLING_ENFORCE_LIMITS=true` 또는 app_settings 값을 true 로.
- [ ] 운영 중 변경은 항상 사유를 남길 것 (액션 로그).
