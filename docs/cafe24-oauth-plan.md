# 카페24 OAuth 연동 계획 (설계만, 구현 보류)

> **이번 MVP에서는 구현하지 않습니다.** 셀러가 본인 쇼핑몰 리뷰를 자동 수집할 수 있게 되는 핵심 확장 지점이므로 설계만 명문화해 둡니다.

---

## 0. 전제 / 원칙

- **공식 OAuth 만 채택**합니다. 크롤링/RPA 방식은 정책 리스크(약관 위반, 차단, 일관성 없는 마크업)와 유지보수 비용이 커서 비추천입니다.
- 현재 분석 파이프라인(분류 → 클러스터 → 리포트)은 **데이터 출처와 무관**하므로 `ReviewNormalized` 단계까지만 새 어댑터로 채워주면 그대로 재사용합니다.
- 셀러는 “리뷰핏 앱에 내 쇼핑몰 연결 → 후기 게시판 선택 → 분석 실행” 3단계 흐름만 보면 충분해야 합니다.

---

## 1. 카페24 앱 등록

- 카페24 개발자 센터에서 앱 생성.
- 발급: `client_id`, `client_secret`, redirect URI(예: `https://app.reviewfit.kr/oauth/cafe24/callback`).
- 권한 스코프: `mall.read_application`, `mall.read_community`, `mall.read_product` 등 (게시판 + 상품 조회용).

## 2. OAuth 인증

- 인증 시작 URL 예:
  ```
  GET https://{mall_id}.cafe24api.com/api/v2/oauth/authorize
      ?response_type=code
      &client_id=...
      &redirect_uri=...
      &scope=...
      &state=...
  ```
- 셀러 동의 후 redirect 로 받은 `code` 로 토큰 교환:
- `POST /api/v2/oauth/token` (grant_type=authorization_code).
- 응답: `access_token`, `refresh_token`, `expires_in`.

## 3. access_token / refresh_token 저장

- 새 테이블 제안:
  ```sql
  CREATE TABLE IF NOT EXISTS source_credentials (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,            -- 'cafe24'
    store_id TEXT NOT NULL,          -- mall_id
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```
- 토큰은 만료 전 자동 갱신(`grant_type=refresh_token`).
- 저장 시 암호화(KMS 또는 dotenv master key)를 적용해야 함.

## 4. 게시판 목록 조회

- `GET /api/v2/admin/boards` — 쇼핑몰에서 사용 중인 게시판 목록.
- 응답 필드: `board_no`, `board_name`, `board_category`, …
- UI: 셀러가 “어떤 게시판이 상품후기인가요?” 라디오에서 직접 선택.
  - 쇼핑몰마다 `board_no` 가 다름(보통 4번이 후기이나, 확정 불가).

## 5. 상품후기 게시판 선택

- 선택한 `board_no` 를 셀러 워크스페이스에 저장.
- 다음부터는 별도 선택 없이 해당 게시판에서 가져옴.

## 6. 게시글 조회 (`boards/articles`)

- `GET /api/v2/admin/boards/{board_no}/articles?limit=100&offset=...`
- 페이지네이션으로 N건씩 수집. 페이지 사이 sleep 으로 rate-limit 회피.
- 사용 필드: `article_no`, `product_no`, `member_id`, `writer`, `subject`, `content`, `rating`, `created_date`.

## 7. 댓글 조회 (`comments`)

- `GET /api/v2/admin/boards/{board_no}/articles/{article_no}/comments`
- 판매자 답글이 있으면 `ReviewNormalized.replyText` 로 매핑.

## 8. 공통 스키마(`ReviewNormalized`)로 정규화

```ts
{
  id: nanoid(),
  source: 'cafe24',
  storeId: mall_id,
  productName: lookupProductName(product_no),  // 별도 상품 조회 캐시
  optionName: optional,
  rating,
  title: subject,
  content,
  writer,
  createdAt: created_date,
  replyText: firstSellerComment,
  reviewId: String(article_no),
}
```

- 상품명 조회는 `GET /api/v2/admin/products/{product_no}` (캐싱 필수).
- 개인정보 마스킹은 기존 `privacyMasking` 그대로 적용.

## 9. 분석 파이프라인 재사용

- 정규화된 ReviewNormalized 배열만 `runAnalysis(reviews, corrections)` 에 넘기면 끝.
- 이후 흐름(분류 → 클러스터 → 상품 리포트 → 답글 초안)은 **현재 코드 그대로**.

## 10. 크롤링/RPA 는 비추천

- 사유:
  - 카페24 약관·정책 리스크(차단·계정 정지 가능).
  - 마크업/URL 자주 변경 → 유지보수 비용 큼.
  - 인증세션 만료, 캡차 등 자동화 적대 요소.
- 따라서 본 프로젝트는 **공식 OAuth 만** 사용합니다.

---

## 코드 측 확장 지점

- 신규 라우트: `POST /api/sources/cafe24/sync` (전체 / 기간별 / 게시판별 동기화).
- 신규 모듈: `backend/src/services/sources/cafe24.adapter.js` — OAuth/페이지네이션/스키마 정규화 담당.
- 기존 `normalizeReview.service.js` 는 그대로 두고, cafe24 어댑터에서 직접 `ReviewNormalized` 형태로 push.
- 이후 `runAnalysis` 호출 흐름은 현재 업로드 라우트와 동일.
