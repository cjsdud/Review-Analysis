// 요금제 정보/사용자 청구 컨텍스트 라우트.
// 실제 결제는 미연동 — 향후 docs/billing-integration-plan.md 참고.
import { Router } from 'express';
import { listPlans, buildMeContext } from '../services/billing.service.js';
import { optionalAuth } from '../middleware/auth.middleware.js';

const router = Router();

// GET /api/billing/plans — 공개 플랜 목록 (가격/제한 표시용)
router.get('/plans', (_req, res) => {
  const plans = listPlans().map((p) => ({
    code: p.code,
    name: p.name,
    priceKrw: p.price_krw,
    monthlyAnalysisLimit: p.monthly_analysis_limit,
    maxReviewsPerAnalysis: p.max_reviews_per_analysis,
    features: p.features,
  }));
  res.json(plans);
});

// GET /api/billing/me — 현재 사용자의 구독/사용량
router.get('/me', optionalAuth, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' });
  }
  res.json(buildMeContext(req.user));
});

export default router;
