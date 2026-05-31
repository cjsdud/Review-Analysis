import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal.jsx';
import LoadingState from './LoadingState.jsx';
import { getAnalysisReviews } from '../api/reviewsApi.js';

// 분석 전체 보기용 리뷰 탐색 모달.
// sentiment 별로 필터된 마스킹 리뷰를 페이지네이션해서 보여 준다.
//
// props:
//   open, onClose
//   analysisId
//   initialSentiment: 'positive' | 'neutral' | 'negative' | 'all'
//   initialProductName?: string  (특정 상품 클릭 시 미리 필터)
//
// 페이지당 20건. 페이지 번호(1~n) 클릭으로 해당 페이지만 교체 표시.

const SENTIMENT_LABEL = { positive: '긍정', neutral: '중립', negative: '부정', all: '전체' };
const SENTIMENT_TONE = { positive: 'is-good', neutral: 'is-neutral', negative: 'is-danger' };

function titleFor(sentiment) {
  switch (sentiment) {
    case 'positive': return '긍정 리뷰 전체 보기';
    case 'negative': return '부정 리뷰 전체 보기';
    case 'neutral':  return '중립 리뷰 전체 보기';
    default:         return '리뷰 데이터';
  }
}

function ReviewCard({ r, onSelectProduct }) {
  const [open, setOpen] = useState(false);
  const issues = (r.detectedIssues || []).filter((i) => i.isActionableIssue !== false && i.category !== '기타');
  return (
    <li className={`re-card${open ? ' is-open' : ''}`}>
      <div className="re-card__head">
        <div className="re-card__meta">
          {r.rating != null && <span className="re-card__rating">★ {r.rating}</span>}
          <span className={`status-badge ${SENTIMENT_TONE[r.sentiment] || 'is-neutral'}`}>
            {SENTIMENT_LABEL[r.sentiment] || '중립'}
          </span>
          {r.createdAt && <span className="re-card__date muted">{String(r.createdAt).slice(0, 10)}</span>}
        </div>
        <div className="re-card__product">
          {onSelectProduct ? (
            <button type="button" className="linklike" onClick={() => onSelectProduct(r.productName)} title={`${r.productName} 상세 리포트`}>
              {r.productName}
            </button>
          ) : (
            <span>{r.productName}</span>
          )}
          {r.optionName && <span className="muted re-card__option"> · {r.optionName}</span>}
        </div>
      </div>
      {r.title && <div className="re-card__title">{r.title}</div>}
      <div className={`re-card__content${open ? '' : ' is-clamped'}`}>{r.content}</div>
      {issues.length > 0 && (
        <div className="re-card__chips">
          {issues.slice(0, 4).map((i, idx) => (
            <span key={idx} className="re-card__chip" title={i.issueLabel}>
              <span className="muted" style={{ marginRight: 4 }}>[{i.category}]</span>{i.issue || i.issueLabel || '이슈'}
            </span>
          ))}
        </div>
      )}
      <button type="button" className="btn btn--ghost btn--sm re-card__more" onClick={() => setOpen((o) => !o)}>
        {open ? '상세 닫기' : '상세 보기'}
      </button>
      {open && (
        <dl className="re-card__detail">
          <dt>상품명</dt><dd>{r.productName}</dd>
          {r.optionName && (<><dt>옵션명</dt><dd>{r.optionName}</dd></>)}
          {r.rating != null && (<><dt>별점</dt><dd>★ {r.rating}</dd></>)}
          {r.createdAt && (<><dt>작성일</dt><dd>{r.createdAt}</dd></>)}
          <dt>감성</dt><dd>{SENTIMENT_LABEL[r.sentiment] || '중립'}</dd>
          <dt>리뷰 내용</dt><dd className="re-card__detail-content">{r.content}</dd>
          {r.source && (<><dt>데이터 출처</dt><dd>{r.source}</dd></>)}
        </dl>
      )}
    </li>
  );
}

export default function ReviewExplorerModal({
  open,
  onClose,
  analysisId,
  initialSentiment = 'all',
  initialProductName = '',
  initialCategory = '',
  title: titleOverride,
  description: descriptionOverride,
}) {
  const navigate = useNavigate();
  const [sentiment, setSentiment] = useState(initialSentiment);
  const [productName, setProductName] = useState(initialProductName);
  const [category, setCategory] = useState(initialCategory);
  const [keyword, setKeyword] = useState('');
  const [rating, setRating] = useState('');
  const [hasIssue, setHasIssue] = useState(''); // '' | 'true' | 'false'
  const [sort, setSort] = useState('latest');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); // 1-indexed
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 페이지 단위 로드 — 항상 교체(append 아님)
  const loadPage = useCallback(async (targetPage) => {
    if (!open || !analysisId) return;
    setLoading(true); setErr('');
    try {
      const params = {
        sentiment,
        limit: PAGE_SIZE,
        offset: (targetPage - 1) * PAGE_SIZE,
        sort,
      };
      if (productName.trim()) params.productName = productName.trim();
      if (keyword.trim())     params.keyword = keyword.trim();
      if (rating)             params.rating = rating;
      if (hasIssue !== '')    params.hasIssue = hasIssue;
      if (category)           params.category = category;
      const data = await getAnalysisReviews(analysisId, params);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(targetPage);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [open, analysisId, sentiment, sort, productName, keyword, rating, hasIssue, category]);

  useEffect(() => { setSentiment(initialSentiment); }, [initialSentiment, open]);
  useEffect(() => { setProductName(initialProductName); }, [initialProductName, open]);
  useEffect(() => { setCategory(initialCategory); }, [initialCategory, open]);
  // 필터/정렬 변경 시 1페이지로 리셋해서 로드
  useEffect(() => { loadPage(1); }, [loadPage]);

  function goToPage(n) {
    const clamped = Math.min(Math.max(1, n), pageCount);
    if (clamped === page || loading) return;
    loadPage(clamped);
  }

  function goProduct(productKey) {
    onClose?.();
    navigate(`/products/${analysisId}/${encodeURIComponent(productKey)}`);
  }

  const summaryLine = useMemo(() => {
    if (loading && items.length === 0) return '불러오는 중…';
    if (total === 0) return '조건에 맞는 리뷰가 없습니다.';
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, total);
    return `총 ${total}건 중 ${start}–${end}건 (${page}/${pageCount} 페이지)`;
  }, [loading, items.length, total, page, pageCount]);

  // 페이지 번호 목록 — 많아지면 ... 으로 축약 (1, ..., page-1, page, page+1, ..., n)
  const pageNumbers = useMemo(() => buildPageNumbers(page, pageCount), [page, pageCount]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titleOverride || (category ? `${category} 관련 리뷰` : titleFor(sentiment))}
      description={descriptionOverride || (category ? '해당 이슈가 감지된 리뷰를 모아 보여드립니다.' : '이 분석에 사용된 마스킹된 리뷰 데이터입니다.')}
      size="lg"
    >
      {category && (
        <div className="re-active-filter">
          <span className="muted" style={{ fontSize: 12 }}>적용된 필터</span>
          <span className="tag tag--neutral">카테고리: {category}</span>
          <button type="button" className="linklike" onClick={() => setCategory('')}>해제</button>
        </div>
      )}
      <div className="re-toolbar">
        <div className="re-toolbar__chips" role="group" aria-label="감성 필터">
          {['all', 'positive', 'neutral', 'negative'].map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${sentiment === s ? ' is-active' : ''}`}
              onClick={() => setSentiment(s)}
            >
              {SENTIMENT_LABEL[s]}
            </button>
          ))}
          <button
            type="button"
            className={`chip${hasIssue === 'true' ? ' is-active' : ''}`}
            onClick={() => setHasIssue(hasIssue === 'true' ? '' : 'true')}
          >
            개선 이슈 있음
          </button>
          <button
            type="button"
            className={`chip${hasIssue === 'false' ? ' is-active' : ''}`}
            onClick={() => setHasIssue(hasIssue === 'false' ? '' : 'false')}
          >
            개선 이슈 없음
          </button>
        </div>
        <div className="re-toolbar__controls">
          <input
            type="search"
            className="re-toolbar__input"
            placeholder="리뷰 내용 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <input
            type="search"
            className="re-toolbar__input"
            placeholder="상품명"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
          <select className="re-toolbar__input" value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">별점 전체</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}점</option>)}
          </select>
          <select className="re-toolbar__input" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="latest">최신순</option>
            <option value="oldest">오래된순</option>
            <option value="ratingDesc">별점 높은순</option>
            <option value="ratingAsc">별점 낮은순</option>
            <option value="issuesDesc">이슈 많은순</option>
          </select>
        </div>
      </div>

      <div className="re-summary muted">{summaryLine}</div>
      {err && <div className="error-banner">{err}</div>}

      {loading && items.length === 0 ? (
        <LoadingState title="리뷰를 불러오는 중..." />
      ) : items.length === 0 ? (
        <div className="state-box">
          <div className="state-box__title">조건에 맞는 리뷰가 없습니다.</div>
          <div className="state-box__desc muted">감성/검색/별점 필터를 조정해 보세요.</div>
        </div>
      ) : (
        <ul className="re-list">
          {items.map((r) => (
            <ReviewCard key={r.id} r={r} onSelectProduct={goProduct} />
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="re-pagination" aria-label="리뷰 페이지">
          <button
            type="button"
            className="re-pagination__nav"
            onClick={() => goToPage(page - 1)}
            disabled={loading || page <= 1}
            aria-label="이전 페이지"
          >
            ‹
          </button>
          {pageNumbers.map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="re-pagination__gap" aria-hidden="true">…</span>
            ) : (
              <button
                key={p}
                type="button"
                className={`re-pagination__page${p === page ? ' is-active' : ''}`}
                onClick={() => goToPage(p)}
                disabled={loading || p === page}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`${p} 페이지`}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            className="re-pagination__nav"
            onClick={() => goToPage(page + 1)}
            disabled={loading || page >= pageCount}
            aria-label="다음 페이지"
          >
            ›
          </button>
        </nav>
      )}
    </Modal>
  );
}

// 페이지 번호 목록을 만든다. 페이지가 많으면 1, …, p-1, p, p+1, …, n 형태로 축약.
function buildPageNumbers(page, pageCount) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const out = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < pageCount - 1) out.push('…');
  out.push(pageCount);
  return out;
}
