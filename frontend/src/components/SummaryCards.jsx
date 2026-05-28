// 전체 요약 지표 카드 (stat-card).
// '부정 리뷰(별점·감성)'와 '개선 이슈'를 분리해 혼동을 줄이고,
// 각 카드 하단에 셀러가 이해하기 쉬운 한 줄 설명을 함께 노출한다.
export default function SummaryCards({ summary }) {
  const pct = (r) => `${Math.round((r || 0) * 100)}%`;
  const cards = [
    {
      label: '전체 리뷰 수',
      icon: '🧾',
      value: summary.totalReviews,
      sub: `분석 상품 ${summary.productCount}개`,
      desc: '업로드한 파일에서 분석에 사용된 리뷰 건수입니다.',
    },
    {
      label: '부정 리뷰 수',
      icon: '😟',
      value: summary.negativeReviews,
      sub: `전체의 ${pct(summary.negativeRatio)}`,
      variant: 'danger',
      desc: '별점 또는 감성 기준으로 부정으로 판정된 리뷰입니다.',
    },
    {
      label: '개선 이슈 발견 리뷰',
      icon: '🔧',
      value: summary.issueReviewCount ?? 0,
      sub: `전체의 ${pct(summary.issueRatio)}`,
      variant: 'brand',
      desc: '부정/긍정과 관계없이 개선 포인트가 포함된 리뷰입니다.',
    },
    {
      label: '총 발견 이슈',
      icon: '🏷️',
      value: summary.totalIssueCount ?? 0,
      sub: '세부 이슈 합계',
      variant: 'brand',
      desc: '한 리뷰에 여러 이슈가 있으면 각각 계산합니다.',
    },
    {
      label: '평균 별점',
      icon: '⭐',
      value: summary.averageRating != null ? summary.averageRating.toFixed(2) : '–',
      sub: '5점 만점',
      desc: '리뷰 별점 평균입니다.',
    },
    {
      label: '분석 상품 수',
      icon: '🛍️',
      value: summary.productCount,
      sub: '개',
      variant: 'muted',
      desc: '리포트가 생성된 고유 상품 수입니다.',
    },
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
          {c.desc && <div className="stat-card__desc">{c.desc}</div>}
        </div>
      ))}
    </div>
  );
}
