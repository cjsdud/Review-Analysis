// 상품별 문제 정리 표용 정렬/필터 유틸 (순수 로직 → node 테스트 가능).

const STATUS_PRIORITY = {
  '주의 필요': 5,
  '개선 우선': 4,
  '좋은데 고칠 점 있음': 3,
  '보통': 2,
  '리뷰 부족': 1,
  '만족도 높음': 0,
};

// 기본 정렬 (셀러가 먼저 봐야 할 상품을 위로):
// 1) productStatus 우선순위 (주의 필요 > 개선 우선 > ...)
// 2) 부정 비율 내림차순
// 3) 개선 이슈 리뷰 수 내림차순
// 4) 총 이슈 수 내림차순
// 5) 전체 리뷰 수 내림차순
export function sortProducts(products = [], sortBy = 'priority') {
  const arr = [...products];
  if (sortBy === 'priority') {
    arr.sort(
      (a, b) =>
        (STATUS_PRIORITY[b.productStatus] ?? 2) - (STATUS_PRIORITY[a.productStatus] ?? 2) ||
        (b.negativeRatio || 0) - (a.negativeRatio || 0) ||
        (b.issueReviewCount || 0) - (a.issueReviewCount || 0) ||
        (b.totalIssueCount || 0) - (a.totalIssueCount || 0) ||
        (b.totalReviews || 0) - (a.totalReviews || 0),
    );
  } else if (sortBy === 'negativeRatio') {
    arr.sort((a, b) => (b.negativeRatio || 0) - (a.negativeRatio || 0) || (b.totalReviews || 0) - (a.totalReviews || 0));
  } else if (sortBy === 'issues') {
    arr.sort((a, b) => (b.issueReviewCount || 0) - (a.issueReviewCount || 0) || (b.totalIssueCount || 0) - (a.totalIssueCount || 0));
  } else if (sortBy === 'reviews') {
    arr.sort((a, b) => (b.totalReviews || 0) - (a.totalReviews || 0));
  } else if (sortBy === 'ratingAsc') {
    // null/undefined 별점은 맨 뒤
    arr.sort((a, b) => (a.averageRating ?? 999) - (b.averageRating ?? 999));
  } else if (sortBy === 'ratingDesc') {
    arr.sort((a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1));
  }
  return arr;
}

// 상태 필터 + 상품명 검색.
export function filterProducts(products = [], { status = '전체', query = '' } = {}) {
  const q = (query || '').trim().toLowerCase();
  return products.filter((p) => {
    if (status !== '전체' && p.productStatus !== status) return false;
    if (q && !(p.productName || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

// '전체' 고정 + 각 상태별 개수.
export function buildStatusFilters(products = []) {
  const counts = products.reduce((acc, p) => {
    const s = p.productStatus || '보통';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const total = products.length;
  const order = ['주의 필요', '개선 우선', '좋은데 고칠 점 있음', '만족도 높음', '리뷰 부족', '보통'];
  const entries = order
    .filter((s) => counts[s] > 0)
    .map((s) => ({ label: s, value: s, count: counts[s] }));
  return [{ label: '전체', value: '전체', count: total }, ...entries];
}
