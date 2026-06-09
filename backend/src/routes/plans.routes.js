// Public plan features endpoint — Pricing 페이지와 frontend feature gate 가
// PLAN_FEATURES single source of truth 와 어긋나지 않게 노출.
//
// 결제/구독과 별개의 read-only 정보라 인증 불필요.
import { Router } from 'express';
import { PLAN_CODES, PLAN_FEATURES, getPlanFeatures } from '../constants/plans.js';
import { ANALYSIS_MODES } from '../constants/analysisModes.js';
import { listPlans, getPlanByCode } from '../services/billing.service.js';

const router = Router();

// GET /api/plans/features — Free/Starter/Pro/Business 의 한도 + 기능 플래그 + 분석 모드 minPlan.
//
// 응답 예:
// {
//   plans: [
//     {
//       code: 'free',
//       name: 'Free',
//       label: 'Free',
//       tagline: '가볍게 체험하기',
//       priceKrw: 0,
//       limits: {
//         monthlyAnalysisLimit: 1,
//         maxReviewsPerAnalysis: 100,
//         monthlyReviewLimit: 500,
//         monthlyFileLimit: 2,
//         maxProductsPerFile: 5,
//         monthlyCsReplyLimit: 10,
//         dataRetentionDays: 7,
//       },
//       features: {
//         canExportFullExcel: false,
//         canPrintFullReport: false,
//         printWatermark: true,
//         canViewAllRelatedReviews: false,
//         canUsePrecisionAnalysis: false,
//         periodComparison: false,
//         llmMode: 'basic',
//       },
//     }, ...
//   ],
//   analysisModes: [
//     { id: 'quick', label: '빠른 분석', minPlan: 'free' }, ...
//   ],
// }
router.get('/features', (_req, res) => {
  const dbPlans = new Map(listPlans().map((p) => [p.code, p]));
  const plans = PLAN_CODES.map((code) => {
    const feats = getPlanFeatures(code);
    const dbRow = dbPlans.get(code) || getPlanByCode(code);
    return {
      code,
      name: dbRow?.name || feats.label,
      label: feats.label,
      tagline: feats.tagline,
      priceKrw: dbRow?.price_krw ?? 0,
      limits: {
        monthlyAnalysisLimit: dbRow?.monthly_analysis_limit ?? null,
        maxReviewsPerAnalysis: dbRow?.max_reviews_per_analysis ?? null,
        monthlyReviewLimit: feats.monthlyReviewLimit,
        monthlyFileLimit: feats.monthlyFileLimit,
        maxProductsPerFile: feats.maxProductsPerFile,
        monthlyCsReplyLimit: feats.monthlyCsReplyLimit,
        dataRetentionDays: feats.dataRetentionDays,
      },
      features: {
        canExportFullExcel: feats.canExportFullExcel === true,
        canPrintFullReport: feats.canPrintFullReport === true,
        printWatermark: feats.printWatermark === true,
        canViewAllRelatedReviews: feats.canViewAllRelatedReviews === true,
        canUsePrecisionAnalysis: feats.canUsePrecisionAnalysis === true,
        periodComparison: feats.periodComparison === true,
        llmMode: feats.llmMode || 'basic',
      },
    };
  });

  const analysisModes = Object.values(ANALYSIS_MODES).map((m) => ({
    id: m.id,
    label: m.label,
    minPlan: m.minPlan,
    description: m.description || null,
  }));

  res.json({ plans, analysisModes });
});

export default router;
