// 상품 순위 표 (부정 리뷰 / 반복 이슈 랭킹)
// 모바일에서 표가 가로로 넘치지 않도록 px 고정폭 대신 % 와 wrap 을 사용.
export default function ProductIssueTable({ rows = [], valueLabel = '값', onSelect }) {
  if (!rows.length) return <div className="muted">데이터가 없습니다.</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <table className="data-table data-table--ranking">
      <thead>
        <tr>
          <th className="data-table__rank-col">#</th>
          <th>상품명</th>
          <th className="data-table__value-col">{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.productKey} onClick={() => onSelect?.(r.productKey)}>
            <td>
              <span className="rank">{i + 1}</span>
            </td>
            <td className="data-table__name">
              {r.productName}
              {r.sub && (
                <span className="muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                  {r.sub}
                </span>
              )}
            </td>
            <td>
              <span className="data-table__bar-track">
                <span
                  className="data-table__bar"
                  style={{ width: `${Math.round((r.value / max) * 100)}%` }}
                />
              </span>
              <strong>{r.value}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
