// 업로드 화면의 "분석 방식 선택" — 5 가지 카드 radio.
// 현재 플랜으로 사용 가능한 옵션은 클릭 가능, 그 외는 lock + 필요 플랜 안내.
//
// props:
//   value           : 현재 선택된 mode id
//   onChange(modeId): 선택 변경 콜백 (disabled 카드는 호출되지 않음)
//   userPlan        : 'free' | 'starter' | 'pro' | 'business' (없으면 free 로 간주)
//   totalReviews?   : 리뷰 수 — 많을 때 batch 카드에 "대량 리뷰에 추천" badge
import { ANALYSIS_MODES, canUseAnalysisMode, planLabel } from '../constants/analysisModes.js';

const LARGE_REVIEW_THRESHOLD = 3000;

export default function AnalysisModeSelector({ value, onChange, userPlan = 'free', totalReviews = 0 }) {
  return (
    <fieldset className="analysis-mode" aria-label="분석 방식 선택">
      <legend className="analysis-mode__legend">분석 방식 선택</legend>
      <p className="analysis-mode__hint muted">
        리뷰 수와 필요한 분석 깊이에 맞게 분석 방식을 선택해 주세요.
      </p>
      <div className="analysis-mode__grid" role="radiogroup">
        {ANALYSIS_MODES.map((mode) => {
          const allowed = canUseAnalysisMode(userPlan, mode.id);
          const isActive = value === mode.id;
          const isLargeRec = mode.id === 'batch' && totalReviews >= LARGE_REVIEW_THRESHOLD;
          return (
            <label
              key={mode.id}
              className={`analysis-mode__card${isActive ? ' is-active' : ''}${allowed ? '' : ' is-locked'}`}
              title={allowed ? mode.description : `${planLabel(mode.minPlan)} 이상에서 사용할 수 있습니다.`}
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
                <div className="analysis-mode__card-desc">{mode.description}</div>
                <div className="analysis-mode__card-meta muted">
                  <span>{mode.speedLabel}</span>
                  <span>·</span>
                  <span>{mode.depthLabel}</span>
                </div>
                <div className="analysis-mode__card-best muted">
                  추천: {mode.bestFor}
                </div>
                {!allowed && (
                  <div className="analysis-mode__upgrade muted">
                    {planLabel(mode.minPlan)} 이상에서 사용할 수 있습니다.
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
