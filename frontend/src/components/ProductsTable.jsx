import SentimentBar from './SentimentBar.jsx';
import ProductStatusBadge from './ProductStatusBadge.jsx';

// 대시보드의 상품별 문제 테이블.
// 데스크톱은 표, 모바일(≤bp-tablet)은 _dashboard.scss 에서 카드형으로 전환.
export default function ProductsTable({ products = [], onSelect }) {
  if (!products.length) return <div className="muted">분석된 상품이 없습니다.</div>;

  return (
    <div className="scroll-x">
      <table className="data-table products-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>상품명</th>
            <th style={{ width: 70 }}>전체</th>
            <th style={{ width: 70 }}>부정</th>
            <th style={{ width: 100 }}>부정 비율</th>
            <th style={{ width: 200 }}>긍정/중립/부정</th>
            <th style={{ width: 110 }}>개선 이슈 리뷰</th>
            <th style={{ width: 80 }}>총 이슈</th>
            <th style={{ width: 80 }}>평균 ★</th>
            <th style={{ width: 130 }}>상태</th>
            <th>주요 이슈</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const pct = Math.round((p.negativeRatio || 0) * 100);
            return (
              <tr key={p.productKey} onClick={() => onSelect?.(p.productKey)}>
                <td data-label="#"><span className="rank">{i + 1}</span></td>
                <td data-label="상품명" style={{ fontWeight: 600 }}>{p.productName}</td>
                <td data-label="전체">{p.totalReviews}</td>
                <td data-label="부정">{p.negativeReviews}</td>
                <td data-label="부정 비율">{pct}%</td>
                <td data-label="감성 분포">
                  <SentimentBar
                    counts={p.sentimentCounts}
                    ratios={p.sentimentRatios}
                    compact
                    showLegend={false}
                  />
                </td>
                <td data-label="개선 이슈 리뷰">{p.issueReviewCount ?? '-'}</td>
                <td data-label="총 이슈">{p.totalIssueCount ?? '-'}</td>
                <td data-label="평균 별점">
                  {p.averageRating != null ? `★ ${p.averageRating.toFixed(2)}` : '-'}
                </td>
                <td data-label="상태"><ProductStatusBadge status={p.productStatus} /></td>
                <td data-label="주요 이슈">
                  <span className="data-table__top-issue" title={p.topIssue?.issueLabel || ''}>
                    {p.topIssue
                      ? `[${p.topIssue.category}] ${p.topIssue.issueLabel}`
                      : <span className="muted">—</span>}
                  </span>
                </td>
                <td data-label="이동">
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
