// 공통 페이지네이션 — 카드 리스트/테이블 하단에 둔다.
// totalItems <= pageSize 면 null 반환 (UI 노출 X).
//
// props:
//   page         : 현재 페이지 (1-based)
//   pageSize     : 페이지 크기
//   totalItems   : 전체 아이템 수
//   onPageChange : (nextPage) => void
//   sectionLabel?: aria 안내용 (예: '부정 리뷰가 많은 상품')

export default function Pagination({ page, pageSize, totalItems, onPageChange, sectionLabel }) {
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  if (!totalItems || totalItems <= pageSize) return null;
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalItems);
  const aria = sectionLabel ? `${sectionLabel} 페이지 이동` : '페이지 이동';
  return (
    <div className="pagination" aria-label={aria}>
      <span className="pagination__summary muted">
        {start}-{end} / 총 {totalItems}개
      </span>
      <div className="pagination__controls">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          aria-label="이전 페이지"
        >
          ‹ 이전
        </button>
        <span className="pagination__page muted">{safePage} / {totalPages}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          aria-label="다음 페이지"
        >
          다음 ›
        </button>
      </div>
    </div>
  );
}
