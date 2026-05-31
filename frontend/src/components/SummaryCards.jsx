import SentimentBar from './SentimentBar.jsx';

// 전체 요약 지표 카드 (수치 6장).
// 감성 분포 막대는 아래 "전체 리뷰 반응 요약" 섹션에서 별도로 보여주므로
// 여기서는 중복으로 표시하지 않는다 (이전엔 '전체 리뷰 감성 분포' 라는 같은
// 제목의 SentimentBar 가 두 곳에서 노출되어 사용자에게 중복 정보처럼 보였다).
// SentimentBar import 는 다른 페이지(상품 상세)에서도 동일 컴포넌트를 쓰므로 유지.
export default function SummaryCards({ summary }) {
  const pct = (r) => `${Math.round((r || 0) * 100)}%`;
  const counts = summary.sentimentCounts || {
    positive: summary.positiveReviews || 0,
    neutral: summary.neutralReviews || 0,
    negative: summary.negativeReviews || 0,
  };
  const ratios = summary.sentimentRatios || {
    positive: 0,
    neutral: 0,
    negative: summary.negativeRatio || 0,
  };
  const cards = [
    {
      label: '전체 리뷰 수',
      icon: '🧾',
      value: summary.totalReviews,
      sub: `분석 상품 ${summary.productCount}개`,
      desc: '업로드한 파일에서 분석에 사용된 리뷰 건수입니다.',
    },
    {
      label: '긍정 리뷰 수',
      icon: '😊',
      value: counts.positive,
      sub: `전체의 ${pct(ratios.positive)}`,
      variant: 'success',
      desc: '별점 4~5점 또는 긍정 문장이 우세한 리뷰입니다.',
    },
    {
      label: '부정 리뷰 수',
      icon: '😟',
      value: counts.negative,
      sub: `전체의 ${pct(ratios.negative)}`,
      variant: 'danger',
      desc: '별점 1~2점 또는 부정 문장이 우세한 리뷰입니다.',
    },
    {
      label: '개선 이슈 발견 리뷰',
      icon: '🔧',
      value: summary.issueReviewCount ?? 0,
      sub: `전체의 ${pct(summary.issueRatio)}`,
      variant: 'brand',
      desc: '긍정 리뷰 안에서도 사이즈·색상·소재 같은 개선 포인트가 있으면 포함됩니다.',
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
    <div>
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
    </div>
  );
}
