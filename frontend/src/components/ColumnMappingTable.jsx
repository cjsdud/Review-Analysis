const FIELD_LABELS = {
  productName: { label: '상품명', required: true, desc: '상품을 구분하는 기준' },
  optionName: { label: '옵션', required: false, desc: '색상/사이즈 등' },
  rating: { label: '평점', required: false, desc: '1~5 별점' },
  title: { label: '리뷰 제목', required: false, desc: '' },
  content: { label: '리뷰 내용', required: true, desc: '분석의 핵심 (필수)' },
  createdAt: { label: '작성일', required: false, desc: '' },
  replyText: { label: '판매자 답글', required: false, desc: '' },
  reviewId: { label: '리뷰 번호', required: false, desc: '' },
  writer: { label: '작성자', required: false, desc: '마스킹 처리됨' },
};

function scoreColor(score) {
  if (score >= 90) return '#10b981';
  if (score >= 70) return '#2563eb';
  if (score >= 60) return '#f59e0b';
  return '#9ca3af';
}

export default function ColumnMappingTable({ fields, headers, mapping, suggestion, sampleRows, onChange }) {
  function sampleFor(column) {
    if (!column) return '';
    const vals = sampleRows
      .map((r) => r[column])
      .filter((v) => v !== '' && v != null)
      .slice(0, 2);
    return vals.join(' · ');
  }

  return (
    <table className="mapping-table">
      <thead>
        <tr>
          <th style={{ width: '22%' }}>분석 항목</th>
          <th style={{ width: '28%' }}>내 파일의 컬럼</th>
          <th style={{ width: '12%' }}>매칭 신뢰도</th>
          <th>데이터 미리보기</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => {
          const meta = FIELD_LABELS[field] || { label: field };
          const sug = suggestion?.[field];
          const selected = mapping[field] || '';
          return (
            <tr key={field}>
              <td>
                <div className="mapping-table__field">
                  {meta.label}
                  {meta.required && <span className="mapping-table__req">*</span>}
                </div>
                {meta.desc && (
                  <div className="muted" style={{ fontSize: 11 }}>
                    {meta.desc}
                  </div>
                )}
              </td>
              <td>
                <select value={selected} onChange={(e) => onChange(field, e.target.value)}>
                  <option value="">— 사용 안 함 —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {sug && sug.score > 0 ? (
                  <span className="mapping-table__score" style={{ color: scoreColor(sug.score) }}>
                    {sug.score}점
                  </span>
                ) : (
                  <span className="muted" style={{ fontSize: 11 }}>
                    -
                  </span>
                )}
              </td>
              <td className="mapping-table__sample">{sampleFor(selected) || <span className="muted">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
