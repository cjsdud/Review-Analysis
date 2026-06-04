// 기간별 이슈 변화 — 양방향 horizontal bar 차트.
//
// 입력: issueChangeChartData (백엔드 periodComparison.issueChangeChartData)
//   [{ category, categoryLabel, previousCount, currentCount, deltaCount, changeType }]
//
// 시각화 규칙:
//   - 양수 deltaCount (worsened / new)   → 우측, 주의색 (빨강 계열)
//   - 음수 deltaCount (improved / resolved) → 좌측, 호전색 (초록 계열)
//   - 절댓값 큰 순으로 정렬되어 들어옴 (백엔드에서 sort + Top 8)
// 모바일에선 horizontal 이 가독성에 유리해 그대로 사용. ResponsiveContainer 역할은 ECharts 의
// 자체 resize 가 담당 (style width 100%).
//
// 빈 상태:
//   배열이 비어 있거나 모두 0 이면 "비교할 이슈 변화가 아직 충분하지 않습니다." 안내.
import ReactECharts from 'echarts-for-react';

const COLOR_GOOD = '#10b981';   // 줄어든 / 사라진 이슈
const COLOR_WARN = '#dc2626';   // 늘어난 / 새로 나타난 이슈

const CHANGE_TYPE_LABEL = {
  new: '새로 늘어난 이슈',
  resolved: '사라진 이슈',
  worsened: '늘어난 이슈',
  improved: '줄어든 이슈',
  unchanged: '변화 없음',
};

export default function PeriodIssueChangeChart({ data }) {
  const list = Array.isArray(data) ? data : [];
  if (!list.length) {
    return (
      <div className="muted" style={{ padding: 30, textAlign: 'center' }}>
        비교할 이슈 변화가 아직 충분하지 않습니다.
      </div>
    );
  }

  // ECharts 에서 horizontal bar 는 yAxis=category, xAxis=value 로 구성한다.
  // 절댓값 큰 항목을 위에 보여주기 위해 reverse — yAxis 는 아래→위 방향이 기본이라서.
  const items = [...list].reverse();
  const yLabels = items.map((d) => d.categoryLabel || d.category);
  // 막대 값은 deltaCount 그대로 (음/양). 색상은 itemStyle 콜백으로 분기.
  const seriesData = items.map((d) => ({
    value: d.deltaCount,
    itemStyle: { color: d.deltaCount >= 0 ? COLOR_WARN : COLOR_GOOD },
    // raw record — tooltip formatter 에서 사용.
    record: d,
  }));

  // 축 범위 — 양/음 최대값 절댓값으로 좌우 대칭을 만들면 0 기준이 중앙에 와서
  // 시각적 비교가 쉽다. 단 한쪽 값만 있을 때는 0 부터 시작.
  const maxAbs = Math.max(1, ...items.map((d) => Math.abs(d.deltaCount || 0)));

  const option = {
    grid: { left: 110, right: 30, top: 20, bottom: 30 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = params?.[0];
        if (!p) return '';
        const r = p.data?.record;
        if (!r) return p.name;
        const sign = r.deltaCount > 0 ? '+' : '';
        return [
          `<b>${r.categoryLabel || r.category}</b>`,
          `이전 기간: ${r.previousCount}건`,
          `현재 기간: ${r.currentCount}건`,
          `변화: ${sign}${r.deltaCount}건`,
          `상태: ${CHANGE_TYPE_LABEL[r.changeType] || '변화'}`,
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'value',
      min: -maxAbs,
      max: maxAbs,
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { fontSize: 11, color: '#64748b' },
      splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
    },
    yAxis: {
      type: 'category',
      data: yLabels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: 12,
        color: '#1f2937',
        // 라벨 길면 줄임. tooltip 에서 전체.
        formatter: (v) => (v && v.length > 10 ? `${v.slice(0, 10)}…` : v),
      },
    },
    series: [
      {
        type: 'bar',
        data: seriesData,
        barWidth: 16,
        label: {
          show: true,
          // 양수는 막대 오른쪽, 음수는 왼쪽에 노출.
          position: 'right',
          formatter: (p) => {
            const v = p.value;
            return `${v > 0 ? '+' : ''}${v}건`;
          },
          fontSize: 11,
          color: '#374151',
        },
        // 0 축에 가까운 라벨은 위쪽에 깔리면 안 되므로 음수일 때 position 'left'.
        // ECharts label position 은 series 레벨이라 음/양 혼합 시 한쪽으로 강제됨.
        // → 양수는 'right', 음수는 'left' 가 되도록 itemStyle 처럼 label 도 데이터별로 override.
      },
    ],
  };

  // 음수 막대 label 위치는 'left' 가 자연스러움 — data 각각의 label 오버라이드.
  for (let i = 0; i < seriesData.length; i++) {
    if (seriesData[i].value < 0) {
      seriesData[i].label = { position: 'left' };
    }
  }

  return (
    <>
      <ReactECharts
        option={option}
        style={{ height: Math.max(180, items.length * 36 + 60), width: '100%' }}
        notMerge
        lazyUpdate
      />
      <div className="period-issue-chart__hint muted">
        막대가 오른쪽으로 길수록 최근 기간에 늘어난 이슈, 왼쪽으로 길수록 줄어든 이슈입니다.
      </div>
    </>
  );
}
