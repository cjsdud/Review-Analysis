// 분석 리포트 라우팅 헬퍼.
// - 모든 상품 상세 진입 지점이 같은 URL 규칙을 쓰도록 한 곳에 모음.
// - 리뷰 모달처럼 review 객체만 들고 있는 곳에서도 review.productKey 우선,
//   없으면 review.productName 으로 fallback 하도록 통일.
// - 라우터 충돌(샘플 페이지에서 실제 analysis API 로 빠지는 것)을 막기 위해
//   analysisId 가 없으면 null 반환 — 호출부는 null 일 때 링크를 비활성화한다.

const PRODUCT_DETAIL_ROUTE = '/products';

// 상품 상세 리포트 URL.
// analysisId 와 productKey 가 둘 다 있어야 정상 URL 을 만든다.
// 둘 중 하나라도 없으면 null — 호출부에서 링크/버튼을 비활성화하라.
export function buildProductDetailPath({ analysisId, productKey } = {}) {
  if (!analysisId || !productKey) return null;
  return `${PRODUCT_DETAIL_ROUTE}/${encodeURIComponent(analysisId)}/${encodeURIComponent(productKey)}`;
}

// 리뷰 객체 → productKey.
// 우선순위:
//   1) review.productKey (백엔드가 명시적으로 내려준 값)
//   2) review.productId (외부 통합 대비 — 현재 코드에서는 보통 사용되지 않음)
//   3) review.productName (백엔드 productKey 가 productName 과 동일한 현재 스킴)
//   4) 같은 analysis 의 products 배열에서 productName 으로 1건만 매칭되면 그 productKey
// 매칭이 모호하거나(중복) 식별값이 전혀 없으면 null.
export function resolveReviewProductKey(review, products = []) {
  if (!review) return null;
  if (review.productKey) return review.productKey;
  if (review.productId) return review.productId;
  if (review.productName) {
    if (Array.isArray(products) && products.length) {
      const matches = products.filter(
        (p) => p && (p.productKey === review.productName || p.productName === review.productName),
      );
      if (matches.length === 1) return matches[0].productKey ?? matches[0].productName;
      if (matches.length > 1) return null;
    }
    // products 정보를 못 받았으면 productName 자체를 키로 — 현재 백엔드 스킴 (productKey === productName) 에서 안전.
    return review.productName;
  }
  return null;
}

// 리뷰 객체 + 컨텍스트 → 상품 상세 URL (null 이면 링크 비활성화 신호).
// analysisId 는 review.analysisId 가 있으면 우선 사용, 없으면 fallback 으로 전달한 값.
export function buildReviewProductPath(review, { analysisId, products } = {}) {
  const aid = review?.analysisId || analysisId;
  const key = resolveReviewProductKey(review, products);
  return buildProductDetailPath({ analysisId: aid, productKey: key });
}
