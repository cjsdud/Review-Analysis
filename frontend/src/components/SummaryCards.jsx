// 전체 요약 지표 카드.
// '부정 리뷰(별점·감성)'와 '개선 이슈'를 분리해 혼동을 줄인다.
export default function SummaryCards({ summary }) {
  const pct = (r) => `${Math.round((r || 0) * 100)}%`;
  const cards = [
    { label: '전체 리뷰 수', value: summary.totalReviews, sub: `분석 상품 ${summary.productCount}개` },
    {
      label: '부정 리뷰 (별점·감성)',
      value: summary.negativeReviews,
      sub: `전체의 ${pct(summary.negativeRatio)}`,
      variant: 'danger',
    },
    {
      label: '개선 이슈 발견 리뷰',
      value: summary.issueReviewCount ?? 0,
      sub: `전체의 ${pct(summary.issueRatio)}`,
      variant: 'brand',
    },
    {
      label: '총 발견 이슈 수',
      value: summary.totalIssueCount ?? 0,
      sub: '세부 이슈 합계',
      variant: 'brand',
    },
    {
      label: '평균 별점',
      value: summary.averageRating != null ? summary.averageRating.toFixed(2) : '–',
      sub: '5점 만점',
    },
    { label: '분석된 상품 수', value: summary.productCount, sub: '개' },
  ];

  return (
    <div className="summary-grid">
      {cards.map((c) => (
        <div className="summary-card" key={c.label}>
          <div className="summary-card__label">{c.label}</div>
          <div className={`summary-card__value${c.variant ? ` summary-card__value--${c.variant}` : ''}`}>
            {c.value}
          </div>
          <div className="summary-card__sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
