import { useEffect, useMemo, useState } from 'react';
import SentimentBar from './SentimentBar.jsx';
import ProductStatusBadge from './ProductStatusBadge.jsx';
import Pagination from './Pagination.jsx';
import { sortProducts, filterProducts, buildStatusFilters } from '../utils/productSort.js';
import { paginateItems } from '../utils/pagination.js';

// 대시보드 "상품별 문제 정리" — 카드 그리드 레이아웃.
// 데스크톱: 좌측(상품명/상태/주요이슈 chip) + 우측(지표 그리드 + 감성바 + 상세 버튼).
// 모바일: 1열 카드. 상품명은 word-break: keep-all + 2줄 line-clamp 로 세로 쪼개짐 방지.
// page/pageSize/onPageChange 가 제어 prop 으로 들어오면 페이지네이션 활성.
// 필터/정렬은 ProductsTable 내부에서 먼저 적용한 뒤 그 결과를 slice — 다른 페이지
// 의 항목이 현재 페이지 필터 결과에 안 섞이게.
export default function ProductsTable({ products = [], onSelect, page = 1, pageSize, onPageChange }) {
  const [sortBy, setSortBy] = useState('priority');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [query, setQuery] = useState('');

  const statusFilters = useMemo(() => buildStatusFilters(products), [products]);
  const visible = useMemo(() => {
    const filtered = filterProducts(products, { status: statusFilter, query });
    return sortProducts(filtered, sortBy);
  }, [products, statusFilter, query, sortBy]);

  // 필터/정렬/검색이 바뀌면 페이지를 1 로 되돌림 — 다른 페이지를 보던 사용자가
  // 갑자기 빈 결과를 보지 않게.
  useEffect(() => { onPageChange?.(1); }, [statusFilter, query, sortBy]);

  // pageSize 가 주어지면 visible 결과를 slice. 미지정이면 전체 그대로.
  const paged = pageSize ? paginateItems(visible, page, pageSize) : { items: visible, totalItems: visible.length, page: 1 };
  const rendered = paged.items;

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
        <>
          <ul className="product-card-list">
            {rendered.map((p) => (
              <ProductRowCard key={p.productKey} product={p} onSelect={onSelect} />
            ))}
          </ul>
          {pageSize && (
            <Pagination
              page={paged.page}
              pageSize={pageSize}
              totalItems={paged.totalItems}
              onPageChange={onPageChange}
              sectionLabel="상품별 문제 정리"
            />
          )}
        </>
      )}
    </div>
  );
}

function pct(n) {
  return `${Math.round((n || 0) * 100)}%`;
}

// 카드당 표시할 주요 이슈 chip 최대 개수. 나머지는 "+N" 으로 축약해 카드 높이 폭주를 막는다.
const MAX_CHIPS = 2;

function ProductRowCard({ product: p, onSelect }) {
  const negPct = pct(p.negativeRatio);
  const allChips = p.topIssues?.length ? p.topIssues : (p.topIssue ? [p.topIssue] : []);
  const chipsToShow = allChips.slice(0, MAX_CHIPS);
  const extraChipCount = Math.max(0, allChips.length - MAX_CHIPS);

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
          <div className="product-summary-card__title-block">
            <div className="product-summary-card__title-text" title={p.productName}>
              {p.productName}
            </div>
            <div className="product-summary-card__title-meta muted">
              리뷰 {p.totalReviews ?? 0}건
              {p.averageRating != null && (
                <span> · 평균 ★ {p.averageRating.toFixed(2)}</span>
              )}
            </div>
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
            {extraChipCount > 0 && (
              <span
                className="tag tag--neutral product-summary-card__chip-more"
                title={`이외 ${extraChipCount}개 이슈`}
              >
                +{extraChipCount}
              </span>
            )}
          </div>
        ) : (
          <div className="product-summary-card__chips muted" style={{ fontSize: 12 }}>
            감지된 주요 이슈 없음
          </div>
        )}
      </div>

      <div className="product-summary-card__side">
        <div className="product-summary-card__metrics">
          <Metric label="부정 비율" value={negPct} highlight={(p.negativeRatio || 0) >= 0.25} />
          <Metric label="개선 이슈 리뷰" value={`${p.issueReviewCount ?? 0}건`} />
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
