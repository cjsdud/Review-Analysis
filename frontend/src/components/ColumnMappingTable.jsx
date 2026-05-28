const FIELD_INFO = {
  productName: { label: '상품명', req: true, desc: '어떤 상품의 리뷰인지 구분합니다.' },
  optionName: { label: '옵션', req: false, desc: '사이즈·색상 옵션별 이슈 분석에 사용합니다.' },
  rating: { label: '별점', req: false, desc: '부정/긍정 리뷰를 구분하는 데 사용합니다.' },
  title: { label: '리뷰 제목', req: false, desc: '제목이 있는 경우 분석 정확도가 약간 올라갑니다.' },
  content: { label: '리뷰 내용', req: true, desc: '고객이 작성한 실제 리뷰 본문입니다. (필수)' },
  createdAt: { label: '작성일', req: false, desc: '월간 트렌드/리포트 기간 분석에 사용합니다.' },
  replyText: { label: '판매자 답글', req: false, desc: '기존 답글이 있으면 함께 보관합니다.' },
  reviewId: { label: '리뷰 번호', req: false, desc: '플랫폼별 원본 식별자(있으면 추적용).' },
  writer: { label: '작성자', req: false, desc: '분석에는 사용하지 않으며 자동 마스킹됩니다.' },
};

function scoreClass(score) {
  if (score >= 90) return 'is-good';
  if (score >= 60) return '';
  return 'is-warn';
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
    <div className="scroll-x">
      <table className="mapping-table">
        <thead>
          <tr>
            <th style={{ width: '28%' }}>분석 항목</th>
            <th style={{ width: '24%' }}>내 파일의 컬럼</th>
            <th style={{ width: '14%' }}>자동 인식</th>
            <th>데이터 미리보기</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => {
            const info = FIELD_INFO[field] || { label: field };
            const sug = suggestion?.[field];
            const selected = mapping[field] || '';
            const warn = info.req && !selected;
            return (
              <tr key={field}>
                <td>
                  <div className="mapping-table__field">
                    {info.label}
                    {info.req ? (
                      <span className="mapping-table__req-badge">필수</span>
                    ) : (
                      <span className="mapping-table__opt-badge">선택</span>
                    )}
                  </div>
                  <div className="mapping-table__desc">{info.desc}</div>
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
                  {warn && (
                    <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4, fontWeight: 600 }}>
                      ⚠ 필수 항목입니다. 직접 선택해 주세요.
                    </div>
                  )}
                </td>
                <td>
                  {sug && sug.score > 0 ? (
                    <span className={`mapping-table__score ${scoreClass(sug.score)}`}>
                      {sug.score >= 90 ? '정확' : sug.score >= 60 ? '확인 필요' : '낮음'}
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>—</span>
                  )}
                </td>
                <td className="mapping-table__sample">{sampleFor(selected) || <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
