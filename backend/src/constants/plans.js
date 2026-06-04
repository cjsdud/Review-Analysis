// 플랜별 기능 플래그 / 제한 — 단일 출처(single source of truth).
// 가격/월 분석 횟수 같은 운영 제어 값은 plans 테이블 + app_settings 에서 override 되지만,
// 기능 가시성(엑셀 export 가능 여부, 정밀 분석 가능 여부 등) 은 코드 레벨에서 관리한다.

export const PLAN_CODES = ['free', 'starter', 'pro', 'business'];

// plan 문자열 정규화 — 'Business' / ' BUSINESS ' / 'business' 같은 변형을 모두 흡수.
// 알 수 없는 값은 'free' 로 fallback (안전한 최소 권한).
export function normalizePlan(value) {
  const raw = String(value || '').trim().toLowerCase();
  return PLAN_CODES.includes(raw) ? raw : 'free';
}

// 기능/한도 매트릭스.
// 한도는 plans 테이블의 monthly_analysis_limit / max_reviews_per_analysis 와 별도로
// "엑셀 전체 다운로드 가능?", "정밀 분석?" 처럼 boolean 기능 가시성을 정의한다.
export const PLAN_FEATURES = {
  free: {
    label: 'Free',
    tagline: '가볍게 체험하기',
    monthlyReviewLimit: 500,
    monthlyFileLimit: 2,
    maxProductsPerFile: 5,
    monthlyCsReplyLimit: 10,
    dataRetentionDays: 7,
    canExportFullExcel: false,
    canPrintFullReport: false,
    printWatermark: true,
    canViewAllRelatedReviews: false,
    canUsePrecisionAnalysis: false,
    // 기간별 리뷰 변화 분석 — Pro 이상 전용.
    periodComparison: false,
    llmMode: 'basic',
  },
  starter: {
    label: 'Starter',
    tagline: '소규모 셀러용',
    monthlyReviewLimit: 3000,
    monthlyFileLimit: 10,
    maxProductsPerFile: 30,
    monthlyCsReplyLimit: 100,
    dataRetentionDays: 30,
    canExportFullExcel: true,
    canPrintFullReport: true,
    printWatermark: false,
    canViewAllRelatedReviews: true,
    canUsePrecisionAnalysis: false,
    periodComparison: false,
    llmMode: 'basic',
  },
  pro: {
    label: 'Pro',
    tagline: '리뷰가 많은 셀러용',
    monthlyReviewLimit: 10000,
    monthlyFileLimit: 30,
    maxProductsPerFile: 100,
    monthlyCsReplyLimit: 500,
    dataRetentionDays: 90,
    canExportFullExcel: true,
    canPrintFullReport: true,
    printWatermark: false,
    canViewAllRelatedReviews: true,
    canUsePrecisionAnalysis: true,
    periodComparison: true,
    llmMode: 'precision',
  },
  business: {
    label: 'Business',
    tagline: '브랜드/팀 운영용',
    monthlyReviewLimit: 50000,
    monthlyFileLimit: 200,
    maxProductsPerFile: 500,
    monthlyCsReplyLimit: 3000,
    dataRetentionDays: 365,
    canExportFullExcel: true,
    canPrintFullReport: true,
    printWatermark: false,
    canViewAllRelatedReviews: true,
    canUsePrecisionAnalysis: true,
    periodComparison: true,
    llmMode: 'advanced',
  },
};

export function getPlanFeatures(code) {
  return PLAN_FEATURES[code] || PLAN_FEATURES.free;
}

// 플랜별 LLM 사용 정책 — 모델 / mini 재분석 허용 / CS 답글 한도 / 모드.
// 비용 통제 + 기능 가시성을 한곳에 모음. 실제 모델명은 env 가 있으면 env 우선.
//
// 기본 모델은 OpenAI 의 폭넓게 출시된 저비용 모델로 둔다 (gpt-4o-mini = nano/mini 둘 다
// 커버, gpt-4o = advanced). 운영에서 신모델(gpt-4.1-mini / gpt-5-nano 등) 로 갈아끼우려면
// OPENAI_REVIEW_MODEL / OPENAI_PRECISION_MODEL / OPENAI_ADVANCED_MODEL env 로 override.
//
//   reviewModel        : 리뷰 1건 분류용 (가장 호출 빈도 높음 → 가장 싼 모델)
//   summaryModel       : 전체/상품별 요약
//   csReplyModel       : CS 답글 초안
//   precisionModel     : 애매한 리뷰 mini 재분석 (null 이면 재분석 자체 OFF)
//   advancedReportModel: 고급 리포트 (Business 전용)
//   allowMiniReanalysis: spec PART 6 의 9 조건이 맞아도 false 면 호출 자체를 막음
//   maxMiniReanalysisRatio: 한 번의 분석에서 mini 재분석을 허용하는 리뷰 비율 상한
//   maxCsRepliesPerMonth: 월 CS 답글 한도 (PLAN_FEATURES.monthlyCsReplyLimit 와 동일 값)
//   llmMode            : 'basic' | 'standard' | 'precision' | 'advanced'
export const PLAN_LLM_POLICY = {
  free: {
    reviewModel: 'gpt-4o-mini',
    summaryModel: 'gpt-4o-mini',
    csReplyModel: 'gpt-4o-mini',
    precisionModel: null,
    advancedReportModel: null,
    allowMiniReanalysis: false,
    maxMiniReanalysisRatio: 0,
    maxCsRepliesPerMonth: 10,
    llmMode: 'basic',
  },
  starter: {
    reviewModel: 'gpt-4o-mini',
    summaryModel: 'gpt-4o-mini',
    csReplyModel: 'gpt-4o-mini',
    precisionModel: null,
    advancedReportModel: null,
    allowMiniReanalysis: false,
    maxMiniReanalysisRatio: 0,
    maxCsRepliesPerMonth: 100,
    llmMode: 'standard',
  },
  pro: {
    reviewModel: 'gpt-4o-mini',
    summaryModel: 'gpt-4o-mini',
    csReplyModel: 'gpt-4o-mini',
    precisionModel: 'gpt-4o-mini',
    advancedReportModel: null,
    allowMiniReanalysis: true,
    maxMiniReanalysisRatio: 0.2,
    maxCsRepliesPerMonth: 500,
    llmMode: 'precision',
  },
  business: {
    reviewModel: 'gpt-4o-mini',
    summaryModel: 'gpt-4o-mini',
    csReplyModel: 'gpt-4o-mini',
    precisionModel: 'gpt-4o-mini',
    advancedReportModel: 'gpt-4o',
    allowMiniReanalysis: true,
    maxMiniReanalysisRatio: 0.3,
    maxCsRepliesPerMonth: 3000,
    llmMode: 'advanced',
  },
};

// 운영 환경변수로 모델명 override — env 가 있으면 우선, 없으면 정책 기본값.
// 키 이름은 OpenAI 표기와 1:1.
function envModel(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : null;
}

// planCode → 최종 LLM 정책. env override + advancedReportModel 가드 적용.
// advancedReportModel 은 Business 가 아니면 항상 null (env 가 있어도 차단).
export function resolveLlmPolicy(code) {
  const base = PLAN_LLM_POLICY[code] || PLAN_LLM_POLICY.free;
  const advanced = code === 'business'
    ? (envModel('OPENAI_ADVANCED_MODEL') || base.advancedReportModel)
    : null;
  const precision = base.precisionModel
    ? (envModel('OPENAI_PRECISION_MODEL') || base.precisionModel)
    : null;
  return {
    ...base,
    reviewModel: envModel('OPENAI_REVIEW_MODEL') || base.reviewModel,
    summaryModel: envModel('OPENAI_SUMMARY_MODEL') || base.summaryModel,
    csReplyModel: envModel('OPENAI_CS_REPLY_MODEL') || base.csReplyModel,
    precisionModel: precision,
    advancedReportModel: advanced,
  };
}

// usage_events.event_type 의 표준 이름. CS 답글 사용량까지 통일된 이름으로 추적.
export const USAGE_EVENT_TYPES = {
  ANALYSIS_CREATED: 'analysis_created',
  FILE_UPLOADED: 'file_uploaded',
  CS_REPLY_GENERATED: 'cs_reply_generated',
  PRECISION_ANALYSIS: 'precision_analysis',
};
