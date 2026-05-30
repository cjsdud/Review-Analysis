# 운영 설정 관리 항목 (`app_settings`)

관리자 페이지 `/admin/settings` 에서 변경할 수 있는 설정값과 의미입니다.
모든 변경은 `admin_action_logs` 에 자동 기록됩니다.

> API KEY 등 민감값은 환경변수로만 관리합니다. 관리자 페이지에서는 표시/수정 불가.

## 카테고리: `general`

| key | 설명 | 타입 | 기본값 | 주의 |
| --- | --- | --- | --- | --- |
| `maintenance_mode` | 점검 모드 ON/OFF. true 면 일반 사용자 API 차단(관리자/health/공지는 통과) | boolean | `false` | 켜는 즉시 모든 일반 사용자 트래픽이 503. 사전 공지 권장. |
| `signup_enabled` | 신규 가입 허용 여부 | boolean | `true` | false 면 `POST /api/auth/register` 가 `403 SIGNUP_DISABLED`. |

## 카테고리: `billing`

| key | 설명 | 타입 | 기본값 | 주의 |
| --- | --- | --- | --- | --- |
| `billing_enforce_limits` | 플랜 월 분석 횟수/리뷰 수 제한 실제 차단 여부 | boolean | `false` | 환경변수 `BILLING_ENFORCE_LIMITS` 보다 **우선** 적용. |

## 카테고리: `limits` (플랜별 한도 — `plans` 테이블 값을 override)

| key | 설명 | 타입 | 기본값 |
| --- | --- | --- | --- |
| `free_monthly_analysis_limit` | Free 월 분석 횟수 | number | `1` |
| `free_max_reviews_per_analysis` | Free 파일당 최대 리뷰 수 | number | `100` |
| `starter_monthly_analysis_limit` | Starter 월 분석 횟수 | number | `10` |
| `starter_max_reviews_per_analysis` | Starter 파일당 최대 리뷰 수 | number | `1000` |
| `pro_monthly_analysis_limit` | Pro 월 분석 횟수 | number | `50` |
| `pro_max_reviews_per_analysis` | Pro 파일당 최대 리뷰 수 | number | `5000` |

> `getPlanByCode(code)` 가 위 값을 우선 적용하므로, 운영 중 즉시 한도를 바꿀 수 있습니다.

## 카테고리: `notice`

| key | 설명 | 타입 | 기본값 |
| --- | --- | --- | --- |
| `notice_banner_enabled` | 단일 토글 배너 표시 여부 | boolean | `false` |
| `notice_banner_text` | 단일 토글 배너 텍스트 | string | `""` |

> `announcements` 테이블 기반 공지와 별개로, "한 줄 배너" 를 즉시 켜고 끌 수 있는 토글.

## 카테고리: `report`

| key | 설명 | 타입 | 기본값 | 비고 |
| --- | --- | --- | --- | --- |
| `report_default_sort` | 상품별 문제 정리 기본 정렬 | string | `priority` | `priority`/`negativeRatio`/`issues`/`reviews` |

## 절대 변경 불가 (SECRET_KEY_BLOCKED)

다음 키는 관리자 페이지에서 PATCH 시도하면 `400 SECRET_KEY_BLOCKED` 가 반환됩니다.
환경변수로만 관리해 주세요.

- `AUTH_JWT_SECRET`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `LLM_API_KEY`
- `DB_PATH`
