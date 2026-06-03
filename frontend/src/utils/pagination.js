// 클라이언트 페이지네이션 헬퍼.
// 원본 배열을 보존하고 slice 만 한다.
// page 가 totalPages 보다 크면 자동 보정.
export function paginateItems(items, page, pageSize) {
  const safe = Array.isArray(items) ? items : [];
  const total = safe.length;
  const safePageSize = Math.max(1, Number(pageSize) || 10);
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const startIndex = (safePage - 1) * safePageSize;
  const endIndex = startIndex + safePageSize;
  return {
    items: safe.slice(startIndex, endIndex),
    totalItems: total,
    totalPages,
    page: safePage,
    pageSize: safePageSize,
    startIndex,
    endIndex: Math.min(endIndex, total),
  };
}
