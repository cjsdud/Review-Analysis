// 사용자가 업로드 화면에서 고르는 "분석 방식" — 가치 중심 이름.
// 플랜과 직접 매핑하지 않는다 (예: Business 사용자도 quick 을 고를 수 있음).
// 플랜은 "최대 가능 범위", analysisMode 는 "이번 분석에서 실제 사용할 수준".

export const PLAN_ORDER = { free: 0, starter: 1, pro: 2, business: 3 };

export const ANALYSIS_MODES = {
  quick: {
    id: 'quick',
    label: '빠른 분석',
    shortLabel: '빠름',
    minPlan: 'free',
    description: '리뷰 반응을 빠르게 확인해요. 기본 감성 흐름과 주요 개선 이슈만 간단히 보여드립니다.',
    bestFor: '처음 체험하거나 빠르게 결과를 보고 싶을 때',
    expectedSpeedLabel: '빠름',
    depthLabel: '기본 흐름 확인',
    usesMiniReanalysis: false,
    usesProductSummaryLlm: false,
    usesOverallSummaryLlm: false,
    usesCsReplyLlm: false,
    usesAdvancedReport: false,
    usesBatch: false,
  },
  standard: {
    id: 'standard',
    label: '기본 분석',
    shortLabel: '기본',
    minPlan: 'starter',
    description: '상품별 주요 이슈와 전체 리뷰 반응을 정리해 실제 운영에 바로 참고할 수 있는 리포트를 제공합니다.',
    bestFor: '리뷰를 상품 운영에 활용하고 싶을 때',
    expectedSpeedLabel: '보통',
    depthLabel: '운영용 기본 리포트',
    usesMiniReanalysis: false,
    usesProductSummaryLlm: true,
    usesOverallSummaryLlm: true,
    usesCsReplyLlm: true,
    usesAdvancedReport: false,
    usesBatch: false,
  },
  precision: {
    id: 'precision',
    label: '정밀 분석',
    shortLabel: '정밀',
    minPlan: 'pro',
    description: '애매한 리뷰를 한 번 더 확인해 긍정·부정·복합 반응과 개선 이슈를 더 정교하게 분석합니다.',
    bestFor: '리뷰가 많고 분석 정확도를 높이고 싶을 때',
    expectedSpeedLabel: '느릴 수 있음',
    depthLabel: '정밀',
    usesMiniReanalysis: true,
    usesProductSummaryLlm: true,
    usesOverallSummaryLlm: true,
    usesCsReplyLlm: true,
    usesAdvancedReport: false,
    usesBatch: false,
  },
  advanced: {
    id: 'advanced',
    label: '고급 분석',
    shortLabel: '고급',
    minPlan: 'business',
    description: '상품 개선 우선순위와 상세 인사이트를 더 깊게 제공하는 브랜드/팀 운영용 분석입니다.',
    bestFor: '브랜드/팀 단위로 상품 개선 전략까지 보고 싶을 때',
    expectedSpeedLabel: '느릴 수 있음',
    depthLabel: '고급 인사이트',
    usesMiniReanalysis: true,
    usesProductSummaryLlm: true,
    usesOverallSummaryLlm: true,
    usesCsReplyLlm: true,
    usesAdvancedReport: true,
    usesBatch: false,
  },
  batch: {
    id: 'batch',
    label: '대량 배치 분석',
    shortLabel: '대량',
    minPlan: 'starter', // 의도적으로 Starter 부터 — Pro 가 아님
    description: '리뷰가 많을 때 비용 효율적으로 분석합니다. 완료까지 시간이 더 걸릴 수 있으며, 분석 히스토리에서 결과를 확인할 수 있습니다.',
    bestFor: '리뷰 수가 많고 즉시 결과가 필요하지 않을 때',
    expectedSpeedLabel: '느림',
    depthLabel: '대량/비용 효율',
    usesMiniReanalysis: false,
    usesProductSummaryLlm: true,
    usesOverallSummaryLlm: true,
    usesCsReplyLlm: false,
    usesAdvancedReport: false,
    usesBatch: true,
  },
};

export const ANALYSIS_MODE_IDS = Object.keys(ANALYSIS_MODES);

export function getAnalysisMode(id) {
  return ANALYSIS_MODES[id] || null;
}

export function canUseAnalysisMode(userPlan, analysisMode) {
  const mode = ANALYSIS_MODES[analysisMode];
  if (!mode) return false;
  const userRank = PLAN_ORDER[userPlan] ?? 0;
  const minRank = PLAN_ORDER[mode.minPlan] ?? 0;
  return userRank >= minRank;
}

// 플랜별 기본 선택값 — 업로드 화면이 초기 선택을 결정할 때 사용.
export function defaultAnalysisModeFor(plan) {
  switch (plan) {
    case 'business': return 'advanced';
    case 'pro':      return 'precision';
    case 'starter':  return 'standard';
    case 'free':
    default:         return 'quick';
  }
}

// plan policy + mode → 실제 호출 정책. 핵심: plan 은 "최대 범위", mode 는 "이번 사용 수준".
// Business 가 quick 을 골라도 mini 재분석/고급 리포트는 끈다.
export function computeEffectivePolicy(planPolicy, analysisMode) {
  const mode = ANALYSIS_MODES[analysisMode] || ANALYSIS_MODES.quick;
  return {
    analysisMode: mode.id,
    // mini 재분석 — plan 도 허용해야 하고 mode 도 허용해야 한다 (AND).
    allowMiniReanalysis: Boolean(planPolicy?.allowMiniReanalysis && mode.usesMiniReanalysis),
    // 요약/CS/고급 — mode 의 사용 의도가 우선.
    usesProductSummaryLlm: Boolean(mode.usesProductSummaryLlm),
    usesOverallSummaryLlm: Boolean(mode.usesOverallSummaryLlm),
    usesCsReplyLlm: Boolean(mode.usesCsReplyLlm),
    usesAdvancedReport: Boolean(planPolicy?.advancedReportModel && mode.usesAdvancedReport),
    usesBatch: Boolean(mode.usesBatch),
  };
}
