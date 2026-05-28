// 대시보드의 '이번에 먼저 고칠 상품' 강조 카드 영역.
// productRankingByIssues 상위 3개를 상품 + 주요 이슈 1~2개 + CTA 형태로 보여준다.
// 주요 이슈 텍스트는 일단 ranking 항목에서 충분치 않을 수 있으므로 products 배열에서 보강한다.
//
// props:
//   ranking: summary.productRankingByIssues
//   products: GET /products 응답 (topIssue 한 개 포함) — 옵션, 있으면 더 풍부
//   onSelect(productKey)
export default function TopFixTargets({ ranking = [], products = [], onSelect }) {
  if (!ranking.length) return null;
  const top = ranking.slice(0, 3);
  const productByKey = new Map(products.map((p) => [p.productKey, p]));

  return (
    <div className="fix-targets">
      {top.map((r, i) => {
        const p = productByKey.get(r.productKey);
        const issueLine = p?.topIssue?.issueLabel;
        return (
          <div className="fix-card" key={r.productKey} onClick={() => onSelect?.(r.productKey)} role="button" tabIndex={0}>
            <span className="fix-card__rank">{i + 1}</span>
            <div className="fix-card__name">{r.productName}</div>
            <div className="fix-card__metrics">
              <span>
                개선 이슈 리뷰 <b>{r.issueReviewCount}건</b>
              </span>
              <span>·</span>
              <span>
                총 이슈 <b>{r.totalIssueCount}개</b>
              </span>
            </div>
            {issueLine && (
              <ul className="fix-card__issues">
                <li>{issueLine}</li>
              </ul>
            )}
            <button
              className="btn btn--subtle btn--sm fix-card__cta"
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(r.productKey);
              }}
            >
              상세 리포트 보기 →
            </button>
          </div>
        );
      })}
    </div>
  );
}
