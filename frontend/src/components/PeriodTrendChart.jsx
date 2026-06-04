// 기간별 추이 — 월별/주별. line chart (감성 비율) + bar chart (리뷰 수).
// ECharts 를 lazy 로 호출. 데이터가 비어 있으면 빈 상태 안내.
import ReactECharts from 'echarts-for-react';

export default function PeriodTrendChart({ trend }) {
  const list = Array.isArray(trend) ? trend : [];
  if (!list.length) {
    return (
      <div className="muted" style={{ padding: 30, textAlign: 'center' }}>
        추이를 표시할 만큼 작성일 데이터가 충분하지 않아요.
      </div>
    );
  }
  const periods = list.map((t) => t.period);
  const posRatio = list.map((t) => Math.round((t.positiveRatio || 0) * 100));
  const negRatio = list.map((t) => Math.round((t.negativeRatio || 0) * 100));
  const counts = list.map((t) => t.totalReviews || 0);

  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['긍정 비율(%)', '부정 비율(%)', '리뷰 수'], top: 0 },
    grid: { left: 40, right: 50, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: periods,
      axisLabel: { fontSize: 11 },
    },
    yAxis: [
      { type: 'value', name: '%', max: 100, axisLabel: { formatter: '{value}%' } },
      { type: 'value', name: '건', position: 'right' },
    ],
    series: [
      {
        name: '긍정 비율(%)',
        type: 'line',
        smooth: true,
        data: posRatio,
        itemStyle: { color: '#2563eb' },
        lineStyle: { width: 2 },
      },
      {
        name: '부정 비율(%)',
        type: 'line',
        smooth: true,
        data: negRatio,
        itemStyle: { color: '#dc2626' },
        lineStyle: { width: 2 },
      },
      {
        name: '리뷰 수',
        type: 'bar',
        yAxisIndex: 1,
        data: counts,
        itemStyle: { color: 'rgba(99, 102, 241, 0.45)' },
        barWidth: 18,
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 320, width: '100%' }} notMerge lazyUpdate />;
}
