import { useState } from 'react';

// 긍정 키워드 TOP 10 리스트. evidenceReviews 가 있으면 펼침 가능.
// props:
//   keywords: [{ keyword, count, ratio, evidenceReviews? }]
//   title?: string (기본 '긍정 키워드 TOP 10')
//   subtitle?: string
//   limit?: number (기본 10)
function pct(n) { return `${Math.round((n || 0) * 100)}%`; }

function ReviewSnippet({ r }) {
  return (
    <li className="keyword-rank__evi">
      <span className="keyword-rank__evi-meta">
        {r.rating != null && <span className="keyword-rank__evi-rating">★ {r.rating}</span>}
        {r.date && <span className="keyword-rank__evi-date">{String(r.date).slice(0, 10)}</span>}
      </span>
      <span className="keyword-rank__evi-content">{r.content}</span>
    </li>
  );
}

export default function PositiveKeywordRanking({
  keywords = [],
  title = '긍정 키워드 TOP 10',
  subtitle = '셀러가 마케팅·상세페이지 문구에 그대로 활용할 수 있는 표현입니다.',
  limit = 10,
}) {
  const [openIdx, setOpenIdx] = useState(null);
  const items = (keywords || []).slice(0, limit);
  if (items.length === 0) {
    return (
      <div className="keyword-rank keyword-rank--positive">
        <div className="keyword-rank__head">
          <div className="keyword-rank__title">{title}</div>
          {subtitle && <div className="keyword-rank__sub muted">{subtitle}</div>}
        </div>
        <div className="state-box" style={{ padding: 20 }}>
          <div className="state-box__title">긍정 키워드가 충분하지 않습니다.</div>
          <div className="state-box__desc muted">긍정 리뷰가 더 쌓이면 자동으로 표시됩니다.</div>
        </div>
      </div>
    );
  }

  const max = Math.max(...items.map((k) => k.count));
  return (
    <div className="keyword-rank keyword-rank--positive">
      <div className="keyword-rank__head">
        <div className="keyword-rank__title">{title}</div>
        {subtitle && <div className="keyword-rank__sub muted">{subtitle}</div>}
      </div>
      <ol className="keyword-rank__list">
        {items.map((k, i) => {
          const opened = openIdx === i;
          const hasEvi = k.evidenceReviews && k.evidenceReviews.length > 0;
          return (
            <li
              key={k.keyword}
              className={`keyword-rank__item${opened ? ' is-open' : ''}`}
            >
              <button
                type="button"
                className="keyword-rank__row"
                onClick={() => hasEvi && setOpenIdx(opened ? null : i)}
                aria-expanded={hasEvi ? opened : undefined}
                disabled={!hasEvi}
              >
                <span className="keyword-rank__rank">{i + 1}</span>
                <span className="keyword-rank__label">{k.keyword}</span>
                <span className="keyword-rank__bar-track" aria-hidden="true">
                  <span className="keyword-rank__bar keyword-rank__bar--positive" style={{ width: `${(k.count / max) * 100}%` }} />
                </span>
                <span className="keyword-rank__count">{k.count}건 · {pct(k.ratio)}</span>
                {hasEvi && <span className="keyword-rank__chevron" aria-hidden="true">{opened ? '▴' : '▾'}</span>}
              </button>
              {opened && hasEvi && (
                <ul className="keyword-rank__evi-list">
                  {k.evidenceReviews.map((r, idx) => <ReviewSnippet key={idx} r={r} />)}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
