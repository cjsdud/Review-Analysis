// 필수: 분석이 의미를 가지려면 반드시 있어야 하는 컬럼.
// 권장: 있으면 좋고 없어도 분석은 진행되는 컬럼.
const FIELD_INFO = {
  content: { label: '리뷰 내용', req: true, desc: '고객이 작성한 실제 리뷰 본문입니다.' },
  rating: { label: '별점', req: true, desc: '긍정/부정 리뷰 구분에 사용합니다. 보통 1~5점.' },
  productName: { label: '상품명', req: false, desc: '어떤 상품의 리뷰인지 구분합니다.' },
  optionName: { label: '옵션', req: false, desc: '사이즈·색상 옵션별 이슈 분석에 사용합니다.' },
  createdAt: { label: '작성일', req: false, desc: '월간 트렌드/리포트 기간 분석에 사용합니다.' },
  title: { label: '리뷰 제목', req: false, desc: '제목이 있는 경우 분석 정확도가 약간 올라갑니다.' },
  replyText: { label: '판매자 답글', req: false, desc: '기존 답글이 있으면 함께 보관합니다.' },
  reviewId: { label: '리뷰 번호', req: false, desc: '플랫폼에서 부여한 리뷰 ID (있으면 추적용으로 사용).' },
  writer: { label: '작성자', req: false, desc: '분석에는 사용하지 않으며 자동 마스킹됩니다.' },
};

function scoreClass(score) {
  if (score >= 90) return 'is-good';
  if (score >= 60) return '';
  return 'is-warn';
}

function scoreLabel(score) {
  if (!score) return '—';
  if (score >= 90) return '정확';
  if (score >= 60) return '확인 필요';
  return '낮음';
}

// 필수 → 권장 → 그 외 순으로 정렬해 렌더 (셀러가 가장 먼저 확인해야 할 줄을 위에 둠).
const DISPLAY_ORDER = ['content', 'rating', 'productName', 'optionName', 'createdAt', 'title', 'replyText', 'reviewId', 'writer'];
function sortFields(fields) {
  const known = DISPLAY_ORDER.filter((f) => fields.includes(f));
  const extra = fields.filter((f) => !DISPLAY_ORDER.includes(f));
  return [...known, ...extra];
}

// 모바일에서는 동일한 DOM 이 CSS 로 카드로 전환된다.
// 각 <td> 의 data-label 이 모바일 카드의 작은 라벨로 표시된다.
export default function ColumnMappingTable({ fields, headers, mapping, suggestion, sampleRows, onChange }) {
  const orderedFields = sortFields(fields || []);
  function sampleFor(column) {
    if (!column) return '';
    const vals = sampleRows
      .map((r) => r[column])
      .filter((v) => v !== '' && v != null)
      .slice(0, 2);
    return vals.join(' · ');
  }

  return (
    <div className="mapping-table-wrap">
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
          {orderedFields.map((field) => {
            const info = FIELD_INFO[field] || { label: field };
            const sug = suggestion?.[field];
            const selected = mapping[field] || '';
            const warn = info.req && !selected;
            const selectId = `mapping-${field}`;
            return (
              <tr key={field} className="mapping-row">
                <td data-label="분석 항목">
                  <div className="mapping-table__field">
                    <span className="mapping-table__field-name">{info.label}</span>
                    {info.req ? (
                      <span className="mapping-table__req-badge">필수</span>
                    ) : (
                      <span className="mapping-table__opt-badge">선택</span>
                    )}
                  </div>
                  <div className="mapping-table__desc">{info.desc}</div>
                </td>
                <td data-label="내 파일의 컬럼">
                  <select
                    id={selectId}
                    aria-label={`${info.label} 매핑할 컬럼 선택`}
                    value={selected}
                    onChange={(e) => onChange(field, e.target.value)}
                  >
                    <option value="">— 사용 안 함 —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  {warn && (
                    <div className="mapping-table__warn">⚠ 필수 항목입니다. 직접 선택해 주세요.</div>
                  )}
                </td>
                <td data-label="자동 인식">
                  {sug && sug.score > 0 ? (
                    <span className={`mapping-table__score ${scoreClass(sug.score)}`}>
                      {scoreLabel(sug.score)}
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>—</span>
                  )}
                </td>
                <td data-label="데이터 미리보기" className="mapping-table__sample">
                  {sampleFor(selected) || <span className="muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
