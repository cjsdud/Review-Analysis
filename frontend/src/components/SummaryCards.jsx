// 전체 요약 지표 카드 (stat-card).
// '부정 리뷰(별점·감성)'와 '개선 이슈'를 분리해 혼동을 줄인다.
export default function SummaryCards({ summary }) {
  const pct = (r) => `${Math.round((r || 0) * 100)}%`;
  const cards = [
    { label: '전체 리뷰 수', icon: '🧾', value: summary.totalReviews, sub: `분석 상품 ${summary.productCount}개` },
    {
      label: '부정 리뷰 (별점·감성)',
      icon: '😟',
      value: summary.negativeReviews,
      sub: `전체의 ${pct(summary.negativeRatio)}`,
      variant: 'danger',
    },
    {
      label: '개선 이슈 발견 리뷰',
      icon: '🔧',
      value: summary.issueReviewCount ?? 0,
      sub: `전체의 ${pct(summary.issueRatio)}`,
      variant: 'brand',
    },
    {
      label: '총 발견 이슈 수',
      icon: '🏷️',
      value: summary.totalIssueCount ?? 0,
      sub: "세부 이슈 합계 ('기타' 제외)",
      variant: 'brand',
    },
    {
      label: '평균 별점',
      icon: '⭐',
      value: summary.averageRating != null ? summary.averageRating.toFixed(2) : '–',
      sub: '5점 만점',
    },
    { label: '분석된 상품 수', icon: '🛍️', value: summary.productCount, sub: '개', variant: 'muted' },
  ];

  return (
    <div className="summary-grid">
      {cards.map((c) => (
        <div className={`stat-card${c.variant ? ` stat-card--${c.variant}` : ''}`} key={c.label}>
          <div className="stat-card__top">
            <span className="stat-card__label">{c.label}</span>
            <span className="stat-card__icon">{c.icon}</span>
          </div>
          <div className="stat-card__value">{c.value}</div>
          <div className="stat-card__sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
