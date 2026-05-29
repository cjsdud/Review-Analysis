// 긍정/중립/부정 stacked bar + 텍스트 표기.
// 입력: counts={positive, neutral, negative}, ratios={positive, neutral, negative}
// 옵션: compact (텍스트만 표시), showLegend
export default function SentimentBar({ counts, ratios, compact = false, showLegend = true }) {
  const c = counts || { positive: 0, neutral: 0, negative: 0 };
  const r = ratios || { positive: 0, neutral: 0, negative: 0 };
  const total = (c.positive || 0) + (c.neutral || 0) + (c.negative || 0);
  if (!total) return <span className="muted" style={{ fontSize: 12 }}>리뷰 없음</span>;
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;

  if (compact) {
    return (
      <span className="sentiment-line">
        <span className="sentiment-line__pos">긍정 {pct(r.positive)}</span>
        <span aria-hidden="true"> · </span>
        <span className="sentiment-line__neu">중립 {pct(r.neutral)}</span>
        <span aria-hidden="true"> · </span>
        <span className="sentiment-line__neg">부정 {pct(r.negative)}</span>
      </span>
    );
  }

  return (
    <div className="sentiment-bar">
      <div
        className="sentiment-bar__track"
        role="img"
        aria-label={`긍정 ${pct(r.positive)}, 중립 ${pct(r.neutral)}, 부정 ${pct(r.negative)}`}
      >
        <span
          className="sentiment-bar__seg sentiment-bar__seg--pos"
          style={{ width: pct(r.positive) }}
          title={`긍정 ${c.positive}건`}
        />
        <span
          className="sentiment-bar__seg sentiment-bar__seg--neu"
          style={{ width: pct(r.neutral) }}
          title={`중립 ${c.neutral}건`}
        />
        <span
          className="sentiment-bar__seg sentiment-bar__seg--neg"
          style={{ width: pct(r.negative) }}
          title={`부정 ${c.negative}건`}
        />
      </div>
      {showLegend && (
        <div className="sentiment-bar__legend">
          <span className="sentiment-bar__legend-item">
            <span className="sentiment-bar__dot sentiment-bar__dot--pos" />
            긍정 {c.positive}건 · {pct(r.positive)}
          </span>
          <span className="sentiment-bar__legend-item">
            <span className="sentiment-bar__dot sentiment-bar__dot--neu" />
            중립 {c.neutral}건 · {pct(r.neutral)}
          </span>
          <span className="sentiment-bar__legend-item">
            <span className="sentiment-bar__dot sentiment-bar__dot--neg" />
            부정 {c.negative}건 · {pct(r.negative)}
          </span>
        </div>
      )}
    </div>
  );
}
