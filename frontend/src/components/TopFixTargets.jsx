import ProductStatusBadge from './ProductStatusBadge.jsx';

// 대시보드의 '이번에 먼저 고칠 상품 TOP 3' 카드 영역 (재설계).
// 셀러가 어떤 상품을 왜 먼저 봐야 하는지 즉시 파악할 수 있게 정보 구조를 정리한다.
//
// 정렬 기준 (sortByPriority):
//   1) productStatus = '주의 필요'
//   2) productStatus = '개선 우선'
//   3) negativeRatio 높은 순
//   4) issueReviewCount 많은 순
//   5) totalIssueCount 많은 순
//   6) totalReviews 많은 순
//
// props:
//   ranking: summary.productRankingByIssues
//   products: GET /products 응답 (productStatus, sentiment, topIssue 포함)
//   onSelect(productKey)

// 외부에서도 사용할 수 있도록 정렬 헬퍼를 export — DashboardPage 가 products 로 top3 를 미리 계산해 넘긴다.
export const STATUS_PRIORITY = {
  '주의 필요': 5,
  '개선 우선': 4,
  '좋은데 고칠 점 있음': 3,
  '보통': 2,
  '리뷰 부족': 1,
  '만족도 높음': 0,
};

// 우선 점검 정렬 — 1) status 우선순위 2) 부정 비율 3) 개선 이슈 리뷰 수 4) 총 이슈 수 5) 전체 리뷰 수
export function sortFixTargets(items = []) {
  return [...items].sort((a, b) =>
    (STATUS_PRIORITY[b.productStatus] ?? 2) - (STATUS_PRIORITY[a.productStatus] ?? 2) ||
    (b.negativeRatio || 0) - (a.negativeRatio || 0) ||
    (b.issueReviewCount || 0) - (a.issueReviewCount || 0) ||
    (b.totalIssueCount || 0) - (a.totalIssueCount || 0) ||
    (b.totalReviews || 0) - (a.totalReviews || 0),
  );
}

// 하위 호환을 위한 내부 alias
const sortByPriority = sortFixTargets;

// 카드 하단에 한 줄로 보여주는 "왜 먼저 봐야 하는지" 설명 — 규칙 기반.
function deriveWhyFirst(p) {
  const negPct = Math.round((p.negativeRatio || 0) * 100);
  const issPct = Math.round((p.issueRatio || 0) * 100);
  if (p.productStatus === '주의 필요') {
    return `부정 비율 ${negPct}%로 높아 가장 먼저 점검이 필요합니다.`;
  }
  if (p.productStatus === '개선 우선') {
    return `반복되는 개선 이슈가 ${issPct}%에 달해 우선 정리하면 효과가 큽니다.`;
  }
  if (p.productStatus === '좋은데 고칠 점 있음') {
    return '전체 만족도는 높지만 특정 이슈가 반복되어 상세페이지 보완이 좋습니다.';
  }
  if ((p.negativeRatio || 0) >= 0.2) {
    return `부정 비율 ${negPct}%로 우선 확인이 필요한 상품입니다.`;
  }
  return '개선 이슈가 반복되는 상품입니다. 상세 리포트에서 원인을 확인하세요.';
}

function pct(n) { return `${Math.round((n || 0) * 100)}%`; }

export default function TopFixTargets({ items, ranking = [], products = [], onSelect }) {
  // 우선순위:
  //  1) items 가 명시적으로 넘어왔으면 그대로 사용 (DashboardPage 가 products 로 미리 계산)
  //  2) 없으면 ranking+products join 으로 후보 구성 → sortFixTargets → top 3 (하위 호환)
  let top;
  if (Array.isArray(items)) {
    top = items.slice(0, 3);
  } else {
    const productByKey = new Map(products.map((p) => [p.productKey, p]));
    const enriched = ranking.map((r) => productByKey.get(r.productKey)).filter(Boolean);
    for (const p of products) {
      if (!enriched.some((x) => x.productKey === p.productKey)) enriched.push(p);
    }
    top = sortByPriority(enriched).slice(0, 3);
  }

  if (top.length === 0) {
    return (
      <div className="fix-targets__empty state-box">
        <div className="state-box__title">아직 우선 점검할 상품이 없습니다.</div>
        <div className="state-box__desc muted">리뷰 파일을 업로드하면 먼저 확인할 상품을 추천해드립니다.</div>
      </div>
    );
  }

  return (
    <div className="fix-targets fix-targets--grid">
      {top.map((p, i) => {
        const rank = i + 1;
        const issues = (p.topIssues && p.topIssues.length
          ? p.topIssues
          : p.topIssue ? [p.topIssue] : []
        ).slice(0, 3);
        return (
          <article
            key={p.productKey}
            className={`fix-card fix-card--rank-${rank}`}
            onClick={() => onSelect?.(p.productKey)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(p.productKey); }}
            role="button"
            tabIndex={0}
            aria-label={`${p.productName} 상세 리포트 보기`}
          >
            <header className="fix-card__head">
              <span className={`fix-card__rank-badge fix-card__rank-badge--${rank}`}>TOP {rank}</span>
              <ProductStatusBadge status={p.productStatus} />
            </header>

            <h3 className="fix-card__name" title={p.productName}>{p.productName}</h3>

            <div className="fix-card__metrics fix-card__metrics--4">
              <div className="fix-card__metric">
                <div className="fix-card__metric-label">전체 리뷰</div>
                <div className="fix-card__metric-value">{p.totalReviews}</div>
              </div>
              <div className="fix-card__metric">
                <div className="fix-card__metric-label">부정 비율</div>
                <div className={`fix-card__metric-value${(p.negativeRatio || 0) >= 0.25 ? ' is-warning' : ''}`}>
                  {pct(p.negativeRatio)}
                </div>
              </div>
              <div className="fix-card__metric">
                <div className="fix-card__metric-label">개선 이슈</div>
                <div className="fix-card__metric-value">{p.issueReviewCount ?? 0}건</div>
              </div>
              <div className="fix-card__metric">
                <div className="fix-card__metric-label">총 이슈 수</div>
                <div className="fix-card__metric-value">{p.totalIssueCount ?? 0}</div>
              </div>
            </div>

            {issues.length > 0 && (
              <div className="fix-card__issues">
                <div className="fix-card__issues-label">주요 이슈</div>
                <div className="fix-card__chips">
                  {issues.map((iss, idx) => (
                    <span key={idx} className="fix-card__chip" title={iss.issueLabel}>
                      {iss.issueLabel}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="fix-card__why">{deriveWhyFirst(p)}</p>

            <button
              type="button"
              className="btn btn--primary btn--sm fix-card__cta"
              onClick={(e) => { e.stopPropagation(); onSelect?.(p.productKey); }}
            >
              상세 리포트 보기 →
            </button>
          </article>
        );
      })}
    </div>
  );
}
