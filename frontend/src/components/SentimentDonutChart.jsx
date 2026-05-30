import ReactECharts from 'echarts-for-react';

// 긍정/중립/부정 도넛 차트. 중앙에 총 리뷰 수.
// props:
//   sentimentCounts: { positive, neutral, negative }
//   sentimentRatios?: { positive, neutral, negative }  (없으면 counts 로 계산)
//   title?: string (기본 '감성 분포')
//   height?: number (기본 240)
const COLORS = {
  positive: '#10b981', // emerald
  neutral: '#94a3b8',  // slate
  negative: '#ef4444', // red
};

function pct(n) { return `${Math.round((n || 0) * 100)}%`; }

export default function SentimentDonutChart({
  sentimentCounts,
  sentimentRatios,
  title = '감성 분포',
  height = 240,
}) {
  const c = sentimentCounts || { positive: 0, neutral: 0, negative: 0 };
  const total = (c.positive || 0) + (c.neutral || 0) + (c.negative || 0);

  if (total === 0) {
    return (
      <div className="sentiment-donut">
        <div className="sentiment-donut__header">{title}</div>
        <div className="state-box" style={{ padding: 24 }}>
          <div className="state-box__title">감성 데이터가 없습니다.</div>
        </div>
      </div>
    );
  }

  const r = sentimentRatios || {
    positive: c.positive / total,
    neutral: c.neutral / total,
    negative: c.negative / total,
  };

  const data = [
    { name: '긍정', value: c.positive, itemStyle: { color: COLORS.positive } },
    { name: '중립', value: c.neutral, itemStyle: { color: COLORS.neutral } },
    { name: '부정', value: c.negative, itemStyle: { color: COLORS.negative } },
  ].filter((d) => d.value > 0);

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}건 ({d}%)',
    },
    legend: { show: false },
    series: [
      {
        type: 'pie',
        radius: ['58%', '82%'],
        avoidLabelOverlap: true,
        padAngle: 2,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        data,
      },
    ],
  };

  return (
    <div className="sentiment-donut">
      <div className="sentiment-donut__header">{title}</div>
      <div className="sentiment-donut__body">
        <div className="sentiment-donut__chart-wrap" style={{ height }}>
          <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />
          <div className="sentiment-donut__center" aria-hidden="true">
            <div className="sentiment-donut__center-val">{total.toLocaleString('ko-KR')}</div>
            <div className="sentiment-donut__center-label">총 리뷰</div>
          </div>
        </div>
        <ul className="sentiment-donut__legend">
          <li>
            <span className="sentiment-donut__dot" style={{ background: COLORS.positive }} />
            <span className="sentiment-donut__legend-label">긍정</span>
            <span className="sentiment-donut__legend-val">{c.positive}건 · {pct(r.positive)}</span>
          </li>
          <li>
            <span className="sentiment-donut__dot" style={{ background: COLORS.neutral }} />
            <span className="sentiment-donut__legend-label">중립</span>
            <span className="sentiment-donut__legend-val">{c.neutral}건 · {pct(r.neutral)}</span>
          </li>
          <li>
            <span className="sentiment-donut__dot" style={{ background: COLORS.negative }} />
            <span className="sentiment-donut__legend-label">부정</span>
            <span className="sentiment-donut__legend-val">{c.negative}건 · {pct(r.negative)}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
