// 모바일 한정 — Hero 아래에서 핵심 지표만 보여주는 가로 스크롤 chip 묶음.
// desktop 에서는 _mobile-primitives.scss 의 .stat-strip 이 display:none 이므로 안 보인다.
// 옆에 기존 <SummaryCards /> 를 .desktop-only 와 함께 같이 렌더해두면, JS 분기 없이
// CSS 만으로 desktop/mobile 다른 UI 가 노출된다.
//
// 노출 정책:
//   - 4개 핵심 지표(전체 리뷰 / 부정 / 개선이슈 / 평균★) 만 — 정보 과부하 차단.
//   - desc 는 노출하지 않는다 (모바일 좁은 chip 안에서 가독성 X).

export default function CompactStatStrip({ summary }) {
  if (!summary) return null;
  const counts = summary.sentimentCounts || {
    negative: summary.negativeReviews || 0,
  };
  const ratios = summary.sentimentRatios || {
    negative: summary.negativeRatio || 0,
  };
  const pct = (r) => `${Math.round((r || 0) * 100)}%`;
  const items = [
    {
      key: 'total',
      label: '전체 리뷰',
      value: (summary.totalReviews ?? 0).toLocaleString('ko-KR'),
      sub: `상품 ${summary.productCount ?? 0}개`,
    },
    {
      key: 'negative',
      label: '부정 리뷰',
      value: (counts.negative ?? 0).toLocaleString('ko-KR'),
      sub: `${pct(ratios.negative)}`,
      variant: 'danger',
    },
    {
      key: 'issue',
      label: '개선 이슈',
      value: (summary.issueReviewCount ?? 0).toLocaleString('ko-KR'),
      sub: `${pct(summary.issueRatio)}`,
      variant: 'brand',
    },
    {
      key: 'rating',
      label: '평균 별점',
      value: summary.averageRating != null ? summary.averageRating.toFixed(2) : '–',
      sub: '5점 만점',
      variant: 'muted',
    },
  ];
  return (
    <div className="stat-strip mobile-only" role="group" aria-label="핵심 지표 요약">
      {items.map((it) => (
        <div
          key={it.key}
          className={`stat-strip__item${it.variant ? ` stat-strip__item--${it.variant}` : ''}`}
        >
          <span className="stat-strip__label">{it.label}</span>
          <span className="stat-strip__value">{it.value}</span>
          <span className="stat-strip__sub">{it.sub}</span>
        </div>
      ))}
    </div>
  );
}
