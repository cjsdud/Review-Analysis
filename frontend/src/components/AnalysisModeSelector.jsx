// 업로드 화면의 "분석 방식 선택" — 5 가지 카드 radio.
//
// 두 영역으로 분리해 사용자가 헷갈리지 않게 한다:
//   1) 상단 "현재 플랜 한도 요약" — 사용자 본인 plan 의 실제 한도 (월 리뷰/상품/CS/보관).
//   2) 각 mode 카드의 "사용 한도" — 그 mode 의 minPlan 기준 한도. 항상 다른 숫자.
//      (Free / Starter / Pro / Business 기준 한도가 카드별로 다르게 노출됨)
//
// 잠긴 카드도 보이고 lock 표시 + 필요 플랜 chip 으로 안내.
import {
  ANALYSIS_MODES,
  canUseAnalysisMode,
  getLimitsForCard,
  formatPlanLimitLines,
  formatCurrentPlanSummary,
  planLabel,
  normalizePlan,
} from '../constants/analysisModes.js';

const LARGE_REVIEW_THRESHOLD = 3000;

export default function AnalysisModeSelector({
  value,
  onChange,
  userPlan = 'free',
  currentFeatures = null, // /api/me 의 usage 객체 (현재 plan 한도)
  totalReviews = 0,
}) {
  const plan = normalizePlan(userPlan);
  const summaryLines = formatCurrentPlanSummary(plan, currentFeatures);
  return (
    <fieldset className="analysis-mode" aria-label="분석 방식 선택">
      <legend className="analysis-mode__legend">분석 방식 선택</legend>
      <p className="analysis-mode__hint muted">
        리뷰 수와 필요한 분석 깊이에 맞게 분석 방식을 선택해 주세요.
      </p>

      {/* 1) 현재 플랜 한도 요약 — 사용자 본인 plan 기준 */}
      <div className="analysis-mode__current">
        <div className="analysis-mode__current-head">
          <strong>현재 {planLabel(plan)} 플랜</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            아래 카드의 "사용 한도" 는 각 분석 방식의 기준 플랜 한도예요.
          </span>
        </div>
        <ul className="analysis-mode__current-list">
          {summaryLines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>

      {/* 2) 모드별 카드 — 항상 mode.minPlan 기준 한도 */}
      <div className="analysis-mode__grid" role="radiogroup">
        {ANALYSIS_MODES.map((mode) => {
          const allowed = canUseAnalysisMode(plan, mode.id);
          const isActive = value === mode.id;
          const isLargeRec = mode.id === 'batch' && totalReviews >= LARGE_REVIEW_THRESHOLD;
          const limits = getLimitsForCard(mode);
          const limitLines = formatPlanLimitLines(limits, mode);
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
                  <span className={`tag ${allowed ? 'tag--success' : 'tag--neutral'} analysis-mode__lock`}>
                    {allowed ? `${planLabel(mode.minPlan)} 이상` : `🔒 ${planLabel(mode.minPlan)} 이상`}
                  </span>
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
                    사용 한도 ({planLabel(mode.minPlan)} 기준)
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
