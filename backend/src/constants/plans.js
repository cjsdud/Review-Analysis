// 플랜별 기능 플래그 / 제한 — 단일 출처(single source of truth).
// 가격/월 분석 횟수 같은 운영 제어 값은 plans 테이블 + app_settings 에서 override 되지만,
// 기능 가시성(엑셀 export 가능 여부, 정밀 분석 가능 여부 등) 은 코드 레벨에서 관리한다.

export const PLAN_CODES = ['free', 'starter', 'pro', 'business'];

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
    llmMode: 'advanced',
  },
};

export function getPlanFeatures(code) {
  return PLAN_FEATURES[code] || PLAN_FEATURES.free;
}

// usage_events.event_type 의 표준 이름. CS 답글 사용량까지 통일된 이름으로 추적.
export const USAGE_EVENT_TYPES = {
  ANALYSIS_CREATED: 'analysis_created',
  FILE_UPLOADED: 'file_uploaded',
  CS_REPLY_GENERATED: 'cs_reply_generated',
  PRECISION_ANALYSIS: 'precision_analysis',
};
