// 사용자에게 노출하는 "분석 방식" 5 종 — 가치 중심 이름 + 짧은 bullet.
// 내부 model/token/policy 같은 표현은 절대 노출하지 않는다.

export const PLAN_ORDER = { free: 0, starter: 1, pro: 2, business: 3 };
const PLAN_LABEL = { free: 'Free', starter: 'Starter', pro: 'Pro', business: 'Business' };

// PLAN_FEATURES 미러 — backend/src/constants/plans.js 의 숫자 값과 1:1 동기화.
// 사용자에게 보여줄 제한 라벨만 추출 (canExportFullExcel 같은 내부 boolean 제외).
export const PLAN_LIMITS = {
  free: {
    label: 'Free',
    monthlyReviewLimit: 500,
    monthlyFileLimit: 2,
    maxProductsPerFile: 5,
    monthlyCsReplyLimit: 10,
    dataRetentionDays: 7,
  },
  starter: {
    label: 'Starter',
    monthlyReviewLimit: 3000,
    monthlyFileLimit: 10,
    maxProductsPerFile: 30,
    monthlyCsReplyLimit: 100,
    dataRetentionDays: 30,
  },
  pro: {
    label: 'Pro',
    monthlyReviewLimit: 10000,
    monthlyFileLimit: 30,
    maxProductsPerFile: 100,
    monthlyCsReplyLimit: 500,
    dataRetentionDays: 90,
  },
  business: {
    label: 'Business',
    monthlyReviewLimit: 50000,
    monthlyFileLimit: 200,
    maxProductsPerFile: 500,
    monthlyCsReplyLimit: 3000,
    dataRetentionDays: 365,
  },
};

export const ANALYSIS_MODES = [
  {
    id: 'quick',
    label: '빠른 분석',
    minPlan: 'free',
    summary: '리뷰 흐름을 빠르게 확인해요.',
    bullets: ['기본 감성 분류', '주요 개선 이슈 확인', '빠른 결과 확인'],
    bestFor: '처음 체험하거나 빠르게 결과를 보고 싶을 때',
    speedLabel: '속도 빠름',
    depthLabel: '기본 흐름 확인',
  },
  {
    id: 'standard',
    label: '기본 분석',
    minPlan: 'starter',
    summary: '운영에 필요한 기본 리포트를 만들어요.',
    bullets: ['상품별 주요 이슈', '전체 리뷰 요약', 'CS 답글 초안 일부'],
    bestFor: '리뷰를 상품 운영에 활용하고 싶을 때',
    speedLabel: '속도 보통',
    depthLabel: '운영용 기본 리포트',
  },
  {
    id: 'precision',
    label: '정밀 분석',
    minPlan: 'pro',
    summary: '애매한 리뷰까지 더 꼼꼼히 확인해요.',
    bullets: ['복합 반응 재검토', '개선 이슈 정밀 분류', '더 정확한 요약'],
    bestFor: '리뷰가 많고 분석 정확도를 높이고 싶을 때',
    speedLabel: '속도 보통~느림',
    depthLabel: '정밀',
  },
  {
    id: 'advanced',
    label: '고급 분석',
    minPlan: 'business',
    summary: '브랜드 운영용 깊은 분석을 제공해요.',
    bullets: ['상품 개선 우선순위', '고급 인사이트', '브랜드 톤 답글'],
    bestFor: '브랜드/팀 단위로 상품 개선 전략까지 보고 싶을 때',
    speedLabel: '속도 보통~느림',
    depthLabel: '고급 인사이트',
  },
  {
    id: 'batch',
    label: '대량 배치 분석',
    minPlan: 'starter', // 의도적으로 Starter 부터
    summary: '많은 리뷰를 효율적으로 분석해요.',
    bullets: ['대량 리뷰 처리', '비용 효율 중심', '완료 후 히스토리 확인'],
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
  switch (normalizePlan(plan)) {
    case 'business': return 'advanced';
    case 'pro':      return 'precision';
    case 'starter':  return 'standard';
    case 'free':
    default:         return 'quick';
  }
}

export function planLabel(planCode) {
  return PLAN_LABEL[normalizePlan(planCode)] || planCode;
}

const krw = (n) => n == null ? '—' : Number(n).toLocaleString('ko-KR');

// 카드에 표시할 한도 라인 (3 줄). batch 처럼 "minPlan 부터 시작" 의미가 강한 모드는
// 마지막 줄을 "완료 후 히스토리 확인" 으로 대체하고 숫자 뒤에 "부터" 를 붙인다.
export function formatPlanLimitLines(features, mode = null) {
  if (!features) return [];
  if (mode && mode.id === 'batch') {
    return [
      `월 리뷰 ${krw(features.monthlyReviewLimit)}건부터`,
      `파일당 상품 ${krw(features.maxProductsPerFile)}개부터`,
      `완료 후 히스토리 확인`,
    ];
  }
  return [
    `월 리뷰 ${krw(features.monthlyReviewLimit)}건`,
    `파일당 상품 ${krw(features.maxProductsPerFile)}개`,
    `CS 답글 ${krw(features.monthlyCsReplyLimit)}건`,
  ];
}

// 상단 "현재 플랜 한도 요약" 한 줄 — 사용자의 실제 plan 기준.
export function formatCurrentPlanSummary(planCode, currentFeatures) {
  const code = normalizePlan(planCode);
  const f = currentFeatures || PLAN_LIMITS[code] || PLAN_LIMITS.free;
  return [
    `월 리뷰 ${krw(f.monthlyReviewLimit)}건`,
    `파일당 상품 ${krw(f.maxProductsPerFile)}개`,
    `CS 답글 ${krw(f.monthlyCsReplyLimit)}건`,
    `보관 ${krw(f.dataRetentionDays)}일`,
  ];
}

// 모드별 카드는 항상 "그 모드를 쓰려면 최소 어느 플랜이 필요한지" = minPlan 기준 한도만 표시.
// 사용 가능 카드도 currentFeatures 로 덮어쓰지 않는다 — 그러면 Business 사용자가
// 5 개 카드 모두 Business 한도(같은 숫자) 만 보게 됨.
// 사용자 본인의 현재 한도는 selector 상단의 "현재 플랜 한도 요약" 영역이 따로 보여준다.
export function getLimitsForCard(mode) {
  return PLAN_LIMITS[normalizePlan(mode.minPlan)] || PLAN_LIMITS.free;
}
