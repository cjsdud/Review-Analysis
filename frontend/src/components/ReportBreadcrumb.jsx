import { Link } from 'react-router-dom';

// 리포트 페이지용 breadcrumb. 'ReviewFit / 분석대시보드 / ...' 형태.
// items 의 각 원소: { label, to? } — to 가 있으면 링크, 없으면 현재 페이지 (aria-current).
// 마지막 항목은 to 가 있어도 링크가 아닌 현재 페이지로 처리.
export default function ReportBreadcrumb({ items = [] }) {
  return (
    <nav className="report-breadcrumb" aria-label="페이지 경로">
      <ol className="report-breadcrumb__list">
        <li className="report-breadcrumb__item">
          <Link to="/history" className="report-breadcrumb__brand">ReviewFit</Link>
        </li>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="report-breadcrumb__item">
              <span className="report-breadcrumb__separator" aria-hidden="true">/</span>
              {item.to && !isLast ? (
                <Link className="report-breadcrumb__link" to={item.to}>
                  {item.label}
                </Link>
              ) : (
                <span className="report-breadcrumb__current" aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
