// 대시보드의 상품별 문제 테이블 (모든 컬럼 표시).
// props:
//   products: GET /products 응답 배열
//   onSelect(productKey)
export default function ProductsTable({ products = [], onSelect }) {
  if (!products.length) return <div className="muted">분석된 상품이 없습니다.</div>;

  return (
    <div className="scroll-x">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>상품명</th>
            <th style={{ width: 80 }}>전체</th>
            <th style={{ width: 90 }}>부정</th>
            <th style={{ width: 120 }}>개선 이슈 리뷰</th>
            <th style={{ width: 90 }}>총 이슈</th>
            <th style={{ width: 90 }}>평균 별점</th>
            <th>주요 이슈</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => (
            <tr key={p.productKey} onClick={() => onSelect?.(p.productKey)}>
              <td>
                <span className="rank">{i + 1}</span>
              </td>
              <td style={{ fontWeight: 600 }}>{p.productName}</td>
              <td>{p.totalReviews}</td>
              <td>{p.negativeReviews}</td>
              <td>{p.issueReviewCount ?? '-'}</td>
              <td>{p.totalIssueCount ?? '-'}</td>
              <td>{p.averageRating != null ? `★ ${p.averageRating.toFixed(2)}` : '-'}</td>
              <td>
                <span className="data-table__top-issue" title={p.topIssue?.issueLabel || ''}>
                  {p.topIssue ? `[${p.topIssue.category}] ${p.topIssue.issueLabel}` : <span className="muted">—</span>}
                </span>
              </td>
              <td>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect?.(p.productKey);
                  }}
                >
                  상세 →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
