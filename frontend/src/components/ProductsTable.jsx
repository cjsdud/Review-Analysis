import { useMemo, useState } from 'react';
import SentimentBar from './SentimentBar.jsx';
import ProductStatusBadge from './ProductStatusBadge.jsx';
import { sortProducts, filterProducts, buildStatusFilters } from '../utils/productSort.js';

// 대시보드 "상품별 문제 정리" — 카드 그리드 레이아웃.
// 데스크톱: 좌측(상품명/상태/주요이슈 chip) + 우측(지표 그리드 + 감성바 + 상세 버튼).
// 모바일: 1열 카드. 상품명은 word-break: keep-all + 2줄 line-clamp 로 세로 쪼개짐 방지.
export default function ProductsTable({ products = [], onSelect }) {
  const [sortBy, setSortBy] = useState('priority');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [query, setQuery] = useState('');

  const statusFilters = useMemo(() => buildStatusFilters(products), [products]);
  const visible = useMemo(() => {
    const filtered = filterProducts(products, { status: statusFilter, query });
    return sortProducts(filtered, sortBy);
  }, [products, statusFilter, query, sortBy]);

  if (!products.length) {
    return <div className="muted" style={{ padding: 16 }}>아직 분석된 상품이 없습니다.</div>;
  }

  return (
    <div className="products-board">
      <div className="products-board__toolbar">
        <div className="products-board__chips" role="group" aria-label="상품 상태 필터">
          {statusFilters.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`chip${statusFilter === f.value ? ' is-active' : ''}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
              <span className="issue-filter-chip__count">{f.count}</span>
            </button>
          ))}
        </div>
        <div className="products-board__controls">
          <input
            type="search"
            className="products-board__search"
            placeholder="상품명 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="상품명 검색"
          />
          <label className="products-board__sort">
            정렬
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="priority">개선 우선순</option>
              <option value="negativeRatio">부정 비율 높은 순</option>
              <option value="issues">이슈 많은 순</option>
              <option value="reviews">리뷰 많은 순</option>
              <option value="ratingAsc">평균 별점 낮은 순</option>
              <option value="ratingDesc">평균 별점 높은 순</option>
            </select>
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>조건에 맞는 상품이 없습니다.</div>
      ) : (
        <ul className="product-card-list">
          {visible.map((p) => (
            <ProductRowCard key={p.productKey} product={p} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </div>
  );
}

function pct(n) {
  return `${Math.round((n || 0) * 100)}%`;
}

function ProductRowCard({ product: p, onSelect }) {
  const negPct = pct(p.negativeRatio);
  // 목록 응답은 topIssue 1개만 내려옴 — 그대로 chip 으로 표시.
  const chips = (p.topIssues || []).slice(0, 3);
  const chipsToShow = chips.length ? chips : (p.topIssue ? [p.topIssue] : []);

  function go(e) {
    e?.stopPropagation();
    onSelect?.(p.productKey);
  }

  return (
    <li
      className="product-summary-card"
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') go(e); }}
    >
      <div className="product-summary-card__main">
        <div className="product-summary-card__title-row">
          <div className="product-summary-card__title-text" title={p.productName}>
            {p.productName}
          </div>
          <ProductStatusBadge status={p.productStatus} />
        </div>
        {chipsToShow.length > 0 ? (
          <div className="product-summary-card__chips">
            {chipsToShow.map((iss, i) => (
              <span key={i} className="tag tag--neutral" title={iss.issueLabel}>
                <span className="muted" style={{ marginRight: 4 }}>[{iss.category}]</span>
                {iss.issueLabel}
              </span>
            ))}
          </div>
        ) : (
          <div className="product-summary-card__chips muted" style={{ fontSize: 12 }}>
            감지된 주요 이슈 없음
          </div>
        )}
      </div>

      <div className="product-summary-card__side">
        <div className="product-summary-card__metrics">
          <Metric label="리뷰" value={p.totalReviews ?? 0} />
          <Metric label="평균 별점" value={p.averageRating != null ? `★ ${p.averageRating.toFixed(2)}` : '—'} />
          <Metric label="부정 비율" value={negPct} highlight={(p.negativeRatio || 0) >= 0.25} />
          <Metric label="개선 이슈" value={`${p.issueReviewCount ?? 0}건`} />
        </div>
        <SentimentBar
          counts={p.sentimentCounts}
          ratios={p.sentimentRatios}
          compact
          showLegend
        />
        <button className="btn btn--ghost btn--sm product-summary-card__action" onClick={go}>
          상세 보기 →
        </button>
      </div>
    </li>
  );
}

function Metric({ label, value, highlight }) {
  return (
    <div className={`product-metric${highlight ? ' is-highlight' : ''}`}>
      <div className="product-metric__label">{label}</div>
      <div className="product-metric__value">{value}</div>
    </div>
  );
}
