export default function SummaryCards({ summary }) {
  const cards = [
    { label: '전체 리뷰 수', value: summary.totalReviews, sub: `분석 상품 ${summary.productCount}개` },
    {
      label: '부정 리뷰 수',
      value: summary.negativeReviews,
      sub: `전체의 ${Math.round((summary.negativeRatio || 0) * 100)}%`,
      variant: 'danger',
    },
    {
      label: '부정 리뷰 비율',
      value: `${Math.round((summary.negativeRatio || 0) * 100)}%`,
      sub: '낮을수록 좋아요',
      variant: 'danger',
    },
    {
      label: '평균 별점',
      value: summary.averageRating != null ? summary.averageRating.toFixed(2) : '–',
      sub: '5점 만점',
      variant: 'brand',
    },
    { label: '분석된 상품 수', value: summary.productCount, sub: '개', variant: 'brand' },
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
