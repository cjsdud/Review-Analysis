// XLSX 멀티 시트 / 헤더 행 선택 UI.
// 점수가 가장 높은 시트 옆에 '추천' 배지, 각 시트의 행/컬럼 수와 감지된 헤더 행 표시.
export default function SheetSelector({
  sheets,
  selectedSheetName,
  selectedHeaderRowIndex,
  disabled,
  onSheetChange,
  onHeaderRowChange,
}) {
  if (!sheets || !sheets.length) return null;

  const sorted = [...sheets].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score;

  return (
    <div className="sheet-selector">
      <div className="sheet-selector__list">
        {sheets.map((s) => {
          const isSelected = s.sheetName === selectedSheetName;
          const isRecommended = s.score === topScore && topScore > 0;
          return (
            <button
              key={s.sheetName}
              type="button"
              className={`sheet-selector__item${isSelected ? ' is-selected' : ''}`}
              disabled={disabled}
              onClick={() => onSheetChange(s.sheetName)}
            >
              <div className="sheet-selector__name">
                {s.sheetName}
                {isRecommended && <span className="tag tag--success" style={{ marginLeft: 6 }}>추천</span>}
              </div>
              <div className="sheet-selector__meta muted">
                {s.rowCount}행 · {s.columnCount}컬럼
                {Number.isFinite(s.detectedHeaderRowIndex) && (
                  <> · 헤더 추정: {s.detectedHeaderRowIndex + 1}행</>
                )}
              </div>
              {s.reason && <div className="sheet-selector__reason muted">{s.reason}</div>}
            </button>
          );
        })}
      </div>

      <div className="sheet-selector__header-row">
        <label htmlFor="header-row-select" style={{ fontWeight: 600, fontSize: 13 }}>
          컬럼명으로 사용할 행
        </label>
        <select
          id="header-row-select"
          value={selectedHeaderRowIndex ?? 0}
          disabled={disabled}
          onChange={(e) => onHeaderRowChange(Number(e.target.value))}
        >
          {Array.from({ length: 20 }, (_, i) => (
            <option key={i} value={i}>
              {i + 1}행
            </option>
          ))}
        </select>
        <span className="muted" style={{ fontSize: 12 }}>
          첫 행에 안내문이 있다면 다른 행을 선택하세요.
        </span>
      </div>
    </div>
  );
}
