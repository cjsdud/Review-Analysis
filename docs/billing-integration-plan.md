# ReviewFit 결제 연동 계획

> 이번 단계에서는 실제 PG 결제 API 를 연동하지 않습니다. DB 구조와 사용량 제한만 준비된 상태이며,
> 본 문서는 추후 결제 도입 시 따라가는 로드맵입니다.

## 결제 후보

| 후보 | 장점 | 단점 |
| --- | --- | --- |
| **포트원** (구 아임포트) | 다중 PG 라우팅, 정기결제 SDK, 한국 시장 점유율 높음 | 부가 수수료 별도 |
| **토스페이먼츠** | 자체 PG, 자체 정기결제 API, UI 안정성, 개발 문서 풍부 | 단일 PG |

**초기 추천:** 토스페이먼츠 또는 포트원 중 한 곳에서 시작.
운영 중 PG 추가가 필요하면 포트원 라우팅을 고려.

## 구독 결제 구조

리뷰핏은 월 정기결제 모델을 기본으로 한다. 정기결제에는 **billing key**(빌링키)가 필요하다.

- billing key 의 **원문은 서비스 DB 에 저장하지 않는다.**
- DB 에는 `subscriptions.provider`, `provider_customer_id`, `provider_subscription_id`,
  `billing_key_ref`(PG 가 발급한 참조키만) 만 저장한다.
- 결제 시도/성공/실패 응답은 `payments.raw_response` 에 그대로 저장(JSON 문자열).
  단, 카드 PAN 등 민감정보가 응답에 포함되어 있으면 마스킹하거나 저장 제외.

## 추후 API 계획

| 메서드 | 경로 | 역할 |
| --- | --- | --- |
| POST | `/api/billing/checkout` | 결제 시작 — billing key 발급 요청 또는 1회 결제 |
| POST | `/api/billing/webhook` | PG 웹훅 수신 — 결제 성공/실패/환불/구독 취소 처리 |
| POST | `/api/billing/cancel` | 구독 취소 (다음 결제일까지 active 유지) |
| GET  | `/api/billing/me` | 현재 사용자의 구독/사용량 (이미 구현됨) |

## 처리해야 할 이벤트

- 결제 성공 → `payments(status=paid)` + `subscriptions(status=active, current_period_end=다음 결제일)`
- 결제 실패 → `payments(status=failed)` + `subscriptions(status=past_due)`
- 환불 → `payments(status=refunded)` + 필요 시 `subscriptions(status=canceled)`
- 구독 취소 → `subscriptions(status=canceled, current_period_end=만료일)`

## 운영 전 필요한 것

- [ ] 사업자 등록 (사업자등록증)
- [ ] PG 심사 통과 (토스/포트원)
- [ ] 이용약관 / 환불 정책 / 정기결제 고지 (구매 직전 노출)
- [ ] 개인정보처리방침
- [ ] 세금계산서 / 현금영수증 정책
- [ ] PG 어드민 계정 분리 + 운영 핸드오버
- [ ] 결제 실패 시 사용자 안내 메일/알림 채널

## 코드 측 준비 상태 (현재)

- `subscriptions` / `payments` / `usage_events` / `plans` 테이블 정의 (SQLite)
- `users.id`, nullable `user_id` 컬럼 (모든 분석 테이블)
- `billing.service.js`: `getPlanByCode` / `getUserSubscription` / `getMonthlyUsage` /
  `checkCanCreateAnalysis` / `recordUsage` / `buildMeContext`
- `BILLING_ENFORCE_LIMITS` 환경변수 — true 면 free/starter/pro 월 횟수/리뷰 수 제한 실제 차단
- 회원가입 시 기본 free 구독 자동 생성 (`getUserSubscription` 안전망)

## 남은 TODO

- 카드 결제 UI (체크아웃 페이지)
- billing key 발급 플로우
- 웹훅 서명 검증
- 결제 성공 후 플랜 업그레이드 → `subscriptions.plan_code` 갱신
- 환불 처리 / 부분 환불
- 영수증 다운로드 / 세금계산서 발행
