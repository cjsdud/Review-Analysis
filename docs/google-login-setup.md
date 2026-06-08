# Google 로그인 설정 가이드

ReviewFit 의 "Google로 계속하기" 로그인을 운영하려면 Google Cloud Console 에서 OAuth 2.0 Client ID 를 발급받고, 백엔드/프론트 환경 변수에 동일한 Client ID 를 넣어야 합니다.

이 로그인은 **사용자 인증 수단** 입니다. 쇼핑몰 플랫폼 자동 연결이나 외부 자동 수집 기능이 아닙니다. ReviewFit 은 Google 의 ID Token 만 검증하고, access token / refresh token 은 저장하지 않으며 Google API 도 호출하지 않습니다.

---

## 1. Google Cloud Console 접속

1. https://console.cloud.google.com 에 ReviewFit 운영용 Google 계정으로 로그인.
2. 우상단 프로젝트 셀렉터에서 ReviewFit 전용 프로젝트를 새로 만들거나 선택.

## 2. OAuth consent screen 설정

1. 좌측 메뉴 → `APIs & Services` → `OAuth consent screen`.
2. User Type 은 베타 운영 단계에서는 `External` 로 선택.
3. App name 은 `ReviewFit`, support email 은 운영팀 이메일.
4. Scopes 는 기본값(`openid`, `email`, `profile`) 만 추가.
5. Test users 단계에서는 베타에 초대할 이메일을 미리 등록 (publish 전이면 등록된 사용자만 로그인 가능).

## 3. OAuth Client ID 생성

1. 좌측 메뉴 → `APIs & Services` → `Credentials`.
2. `Create Credentials` → `OAuth client ID` 클릭.
3. Application type: **Web application**.
4. Name: `ReviewFit Web`.

### Authorized JavaScript origins

서비스를 띄울 모든 도메인을 등록합니다.

- 로컬 개발: `http://localhost:5173`
- Render 프론트(예시): `https://reviewfit-ribyupis.onrender.com`

### Authorized redirect URIs

ReviewFit 의 구현은 **Google Identity Services 의 ID Token callback 방식** 입니다. 별도 redirect URI 가 필요 없으므로 비워 두어도 됩니다. (다른 redirect flow 를 추가로 쓰는 경우에만 등록.)

5. 생성된 **Client ID** (예: `12345-xxxxx.apps.googleusercontent.com`) 를 복사합니다.

## 4. 환경 변수 설정

같은 Client ID 를 **백엔드와 프론트엔드 양쪽** 에 넣습니다.

### Backend (.env)

```env
GOOGLE_CLIENT_ID=12345-xxxxx.apps.googleusercontent.com
```

미설정 시:
- `POST /api/auth/google` 은 `503 GOOGLE_NOT_CONFIGURED` 응답.
- 다른 인증 라우트(`/login`, `/register` 등) 는 영향 없음.

### Frontend (.env.local 또는 빌드 환경)

```env
VITE_GOOGLE_CLIENT_ID=12345-xxxxx.apps.googleusercontent.com
```

미설정 시:
- `GoogleLoginButton` 컴포넌트가 자동으로 렌더되지 않음.
- 기존 이메일/비밀번호 로그인 화면은 그대로 노출.

## 5. Render 등 PaaS 환경 변수

Render Dashboard → 해당 서비스 → `Environment` 탭에서 위 두 변수를 동일한 값으로 추가합니다. 변경 후 서비스를 다시 배포해야 환경 변수가 적용됩니다.

> ⚠️ Client **Secret** 은 이 방식에서 사용하지 않습니다. 저장소에 절대 커밋하지 마세요.

## 6. 동작 확인

1. 로그인 페이지 접속.
2. "Google로 계속하기" 버튼이 가장 위에 노출되는지 확인 (`VITE_GOOGLE_CLIENT_ID` 설정 시).
3. 버튼 클릭 → Google 계정 선택 → ReviewFit 분석 히스토리 화면으로 이동.
4. `/api/me` 응답에 `user.email`, `user.role`, `subscription.planCode` 가 정상 반환되는지 확인.

## 7. 계정 연결 정책 요약

- 같은 Google `sub` 로 다시 로그인 → 기존 user 반환. `role`/`plan`/`auth_provider` 절대 덮어쓰지 않음.
- 같은 `email` 의 local 계정이 있으면 → 해당 user 에 `google_sub` 만 연결 (email_verified=true 일 때만). 기존 `role`/`plan` 유지.
- 어떤 user 도 없으면 → 새 user 생성 (`auth_provider='google'`, `role='user'`, 기본 free 구독). `ADMIN_EMAILS` 매칭이면 `admin` 으로 생성.

## 8. 안전 원칙

- 백엔드는 프론트가 보낸 email / sub 를 **신뢰하지 않습니다**. 반드시 Google ID Token payload 에서만 읽습니다.
- ID Token 의 `aud` 가 `GOOGLE_CLIENT_ID` 와 일치하지 않으면 거부.
- `email_verified` 가 false 인 계정은 거부.
- `credential` 원문 / `access_token` / `refresh_token` 은 저장하지 않고 로그에도 남기지 않습니다.
- 기존 P0 보안 가드(`AUTH_JWT_SECRET` 강제, 익명 교차 접근 차단, rate limit) 모두 그대로 유효합니다.
