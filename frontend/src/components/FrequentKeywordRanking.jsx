// 일반(주제) 키워드 TOP 10 — sentimentHint 배지 포함.
// props:
//   keywords: [{ keyword, count, ratio, sentimentHint?, evidenceReviews? }]
//   title?: string (기본 '많이 언급된 키워드 TOP 10')
//   subtitle?: string
//   limit?: number (기본 10)
function pct(n) { return `${Math.round((n || 0) * 100)}%`; }

const HINT_LABEL = {
  positive: '긍정',
  neutral: '중립',
  negative: '부정',
  mixed: '혼합',
};
const HINT_CLASS = {
  positive: 'is-good',
  neutral: 'is-neutral',
  negative: 'is-danger',
  mixed: 'is-warn',
};

export default function FrequentKeywordRanking({
  keywords = [],
  title = '많이 언급된 키워드 TOP 10',
  subtitle = '고객이 자주 이야기하는 주제로 리뷰 전체 맥락을 빠르게 파악하세요.',
  limit = 10,
}) {
  const items = (keywords || []).slice(0, limit);
  if (items.length === 0) {
    return (
      <div className="keyword-rank keyword-rank--frequent">
        <div className="keyword-rank__head">
          <div className="keyword-rank__title">{title}</div>
          {subtitle && <div className="keyword-rank__sub muted">{subtitle}</div>}
        </div>
        <div className="state-box" style={{ padding: 20 }}>
          <div className="state-box__title">키워드 데이터가 충분하지 않습니다.</div>
        </div>
      </div>
    );
  }
  const max = Math.max(...items.map((k) => k.count));
  return (
    <div className="keyword-rank keyword-rank--frequent">
      <div className="keyword-rank__head">
        <div className="keyword-rank__title">{title}</div>
        {subtitle && <div className="keyword-rank__sub muted">{subtitle}</div>}
      </div>
      <ol className="keyword-rank__list">
        {items.map((k, i) => (
          <li key={k.keyword} className="keyword-rank__item">
            <div className="keyword-rank__row keyword-rank__row--static">
              <span className="keyword-rank__rank">{i + 1}</span>
              <span className="keyword-rank__label">{k.keyword}</span>
              {k.sentimentHint && (
                <span className={`status-badge ${HINT_CLASS[k.sentimentHint] || 'is-neutral'}`} style={{ marginLeft: 6 }}>
                  {HINT_LABEL[k.sentimentHint] || '중립'}
                </span>
              )}
              <span className="keyword-rank__bar-track" aria-hidden="true">
                <span className="keyword-rank__bar keyword-rank__bar--neutral" style={{ width: `${(k.count / max) * 100}%` }} />
              </span>
              <span className="keyword-rank__count">{k.count}건 · {pct(k.ratio)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
