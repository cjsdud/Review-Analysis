// 상품 순위 표 (부정 리뷰 / 반복 이슈 랭킹)
export default function ProductIssueTable({ rows = [], valueLabel = '값', onSelect }) {
  if (!rows.length) return <div className="muted">데이터가 없습니다.</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th style={{ width: 36 }}>#</th>
          <th>상품명</th>
          <th style={{ width: 160 }}>{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.productKey} onClick={() => onSelect?.(r.productKey)}>
            <td>
              <span className="rank">{i + 1}</span>
            </td>
            <td style={{ fontWeight: 600 }}>
              {r.productName}
              {r.sub && (
                <span className="muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                  {r.sub}
                </span>
              )}
            </td>
            <td>
              <span className="data-table__bar-track">
                <span className="data-table__bar" style={{ width: `${(r.value / max) * 90}px` }} />
              </span>
              <strong>{r.value}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
