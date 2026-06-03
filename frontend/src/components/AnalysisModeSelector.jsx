// 업로드 화면의 "분석 방식 선택" — 5 가지 카드 radio.
// 카드 구조:
//   1. 제목 + (잠금시) 필요 플랜 chip
//   2. 한 줄 요약
//   3. 핵심 bullet 3 개
//   4. 작은 "사용 한도" 라인 3 줄
import {
  ANALYSIS_MODES,
  canUseAnalysisMode,
  getLimitsForCard,
  formatPlanLimitLines,
  planLabel,
} from '../constants/analysisModes.js';

const LARGE_REVIEW_THRESHOLD = 3000;

export default function AnalysisModeSelector({
  value,
  onChange,
  userPlan = 'free',
  currentFeatures = null, // /api/me 의 usage 객체 (현재 plan 한도)
  totalReviews = 0,
}) {
  return (
    <fieldset className="analysis-mode" aria-label="분석 방식 선택">
      <legend className="analysis-mode__legend">분석 방식 선택</legend>
      <p className="analysis-mode__hint muted">
        리뷰 수와 필요한 분석 깊이에 맞게 분석 방식을 선택해 주세요.
        {' '}
        <span title={`현재 플랜: ${planLabel(userPlan)}`} style={{ fontWeight: 600 }}>
          현재 플랜: {planLabel(userPlan)}
        </span>
      </p>
      <div className="analysis-mode__grid" role="radiogroup">
        {ANALYSIS_MODES.map((mode) => {
          const allowed = canUseAnalysisMode(userPlan, mode.id);
          const isActive = value === mode.id;
          const isLargeRec = mode.id === 'batch' && totalReviews >= LARGE_REVIEW_THRESHOLD;
          const limits = getLimitsForCard({ mode, userPlan, currentFeatures });
          const limitLines = formatPlanLimitLines(limits);
          return (
            <label
              key={mode.id}
              className={`analysis-mode__card${isActive ? ' is-active' : ''}${allowed ? '' : ' is-locked'}`}
              title={allowed ? mode.summary : `${planLabel(mode.minPlan)} 이상에서 사용할 수 있습니다.`}
            >
              <input
                type="radio"
                name="analysis-mode"
                value={mode.id}
                checked={isActive}
                disabled={!allowed}
                onChange={() => { if (allowed) onChange?.(mode.id); }}
                aria-disabled={!allowed}
              />
              <div className="analysis-mode__card-body">
                <div className="analysis-mode__card-head">
                  <strong className="analysis-mode__card-title">{mode.label}</strong>
                  {!allowed && (
                    <span className="tag tag--neutral analysis-mode__lock">
                      🔒 {planLabel(mode.minPlan)} 이상
                    </span>
                  )}
                  {isLargeRec && allowed && (
                    <span className="tag tag--success">대량 리뷰에 추천</span>
                  )}
                </div>
                <div className="analysis-mode__card-summary">{mode.summary}</div>
                <ul className="analysis-mode__bullets">
                  {mode.bullets.map((b) => <li key={b}>{b}</li>)}
                </ul>
                <div className="analysis-mode__limits">
                  <div className="analysis-mode__limits-title muted">
                    사용 한도{!allowed ? ` (${planLabel(mode.minPlan)} 기준)` : ''}
                  </div>
                  <ul className="analysis-mode__limits-list muted">
                    {limitLines.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
