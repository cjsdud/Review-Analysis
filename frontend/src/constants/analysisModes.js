// 사용자에게 노출하는 "분석 방식" 5 종 — backend constants/analysisModes.js 와 1:1 미러.
// 내부 model/token/policy 같은 표현은 절대 노출하지 않는다.

export const PLAN_ORDER = { free: 0, starter: 1, pro: 2, business: 3 };
const PLAN_LABEL = { free: 'Free', starter: 'Starter', pro: 'Pro', business: 'Business' };

export const ANALYSIS_MODES = [
  {
    id: 'quick',
    label: '빠른 분석',
    minPlan: 'free',
    description: '리뷰 반응을 빠르게 확인해요. 기본 감성 흐름과 주요 개선 이슈만 간단히 보여드립니다.',
    bestFor: '처음 체험하거나 빠르게 결과를 보고 싶을 때',
    speedLabel: '속도 빠름',
    depthLabel: '기본 흐름 확인',
  },
  {
    id: 'standard',
    label: '기본 분석',
    minPlan: 'starter',
    description: '상품별 주요 이슈와 전체 리뷰 반응을 정리해 실제 운영에 바로 참고할 수 있는 리포트를 제공합니다.',
    bestFor: '리뷰를 상품 운영에 활용하고 싶을 때',
    speedLabel: '속도 보통',
    depthLabel: '운영용 기본 리포트',
  },
  {
    id: 'precision',
    label: '정밀 분석',
    minPlan: 'pro',
    description: '애매한 리뷰를 한 번 더 확인해 긍정·부정·복합 반응과 개선 이슈를 더 정교하게 분석합니다.',
    bestFor: '리뷰가 많고 분석 정확도를 높이고 싶을 때',
    speedLabel: '속도 보통~느림',
    depthLabel: '정밀',
  },
  {
    id: 'advanced',
    label: '고급 분석',
    minPlan: 'business',
    description: '상품 개선 우선순위와 상세 인사이트를 더 깊게 제공하는 브랜드/팀 운영용 분석입니다.',
    bestFor: '브랜드/팀 단위로 상품 개선 전략까지 보고 싶을 때',
    speedLabel: '속도 보통~느림',
    depthLabel: '고급 인사이트',
  },
  {
    id: 'batch',
    label: '대량 배치 분석',
    minPlan: 'starter', // 의도적으로 Starter 부터
    description: '리뷰가 많을 때 비용 효율적으로 분석합니다. 완료까지 시간이 더 걸릴 수 있어요. 결과는 분석 히스토리에서 확인합니다.',
    bestFor: '리뷰 수가 많고 즉시 결과가 필요하지 않을 때',
    speedLabel: '속도 느림',
    depthLabel: '대량/비용 효율',
  },
];

export function normalizePlan(value) {
  const raw = String(value || '').trim().toLowerCase();
  return PLAN_ORDER[raw] !== undefined ? raw : 'free';
}

export function canUseAnalysisMode(userPlan, modeId) {
  const mode = ANALYSIS_MODES.find((m) => m.id === modeId);
  if (!mode) return false;
  const plan = normalizePlan(userPlan);
  const minPlan = normalizePlan(mode.minPlan);
  return (PLAN_ORDER[plan] ?? 0) >= (PLAN_ORDER[minPlan] ?? 0);
}

export function defaultAnalysisModeFor(plan) {
  switch (plan) {
    case 'business': return 'advanced';
    case 'pro':      return 'precision';
    case 'starter':  return 'standard';
    case 'free':
    default:         return 'quick';
  }
}

export function planLabel(planCode) {
  return PLAN_LABEL[planCode] || planCode;
}
