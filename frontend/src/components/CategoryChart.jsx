import ReactECharts from 'echarts-for-react';

// 카테고리별 문제 분포. type: 'bar' | 'pie'
export default function CategoryChart({ distribution = [], type = 'bar' }) {
  if (!distribution.length) {
    return <div className="muted">표시할 카테고리 데이터가 없습니다.</div>;
  }

  const sorted = [...distribution].sort((a, b) => b.count - a.count);

  const option =
    type === 'pie'
      ? {
          tooltip: { trigger: 'item', formatter: '{b}: {c}건 ({d}%)' },
          legend: { bottom: 0, type: 'scroll' },
          series: [
            {
              type: 'pie',
              radius: ['42%', '68%'],
              center: ['50%', '44%'],
              avoidLabelOverlap: true,
              itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
              label: { show: false },
              data: sorted.map((d) => ({ name: d.name, value: d.count })),
            },
          ],
          color: ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#94a3b8'],
        }
      : {
          grid: { left: 80, right: 24, top: 16, bottom: 24 },
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: '{b}: {c}건' },
          xAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f7' } } },
          yAxis: {
            type: 'category',
            data: sorted.map((d) => d.name).reverse(),
            axisLine: { show: false },
            axisTick: { show: false },
          },
          series: [
            {
              type: 'bar',
              data: sorted.map((d) => d.count).reverse(),
              barWidth: 16,
              itemStyle: { color: '#2563eb', borderRadius: [0, 6, 6, 0] },
              label: { show: true, position: 'right', formatter: '{c}', color: '#6b7280' },
            },
          ],
        };

  return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}
