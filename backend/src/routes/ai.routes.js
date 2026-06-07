import { Router } from 'express';
import { z } from 'zod';
import aiClient from '../services/aiClient.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { aiReplyLimiter } from '../middleware/rateLimit.middleware.js';
import { checkCanGenerateCsReply, recordUsage } from '../services/billing.service.js';
import { USAGE_EVENT_TYPES } from '../constants/plans.js';

const router = Router();

// POST /api/ai/reply-templates — 특정 이슈에 대한 CS 답글 초안 생성.
// 플랜의 월 CS 답글 한도 검사 후 생성. 익명 데모 모드는 카운트 X.
// 미들웨어 순서: requireAuth → aiReplyLimiter (req.user 기반 키).
// rate limit 은 LLM 비용 폭주 방지용 abuse 가드 — checkCanGenerateCsReply(플랜 정책) 와 별개.
router.post('/reply-templates', requireAuth, aiReplyLimiter, async (req, res) => {
  const schema = z.object({ category: z.string().optional(), issueLabel: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'issueLabel이 필요합니다.' });

  // 답글은 한 번 호출 시 보통 3 variant 가 만들어진다. 한도 검사 시점에는 1 으로 계산하고
  // (variant 가 0 인 응답도 가능), 실제 응답 길이만큼 사용량을 증가시킨다.
  const userId = req.user?.id || null;
  const guard = checkCanGenerateCsReply(userId, 1);
  if (!guard.ok) {
    return res.status(guard.status).json({
      ...guard.body,
      upgradeRequired: true,
      message: guard.body?.message
        || '현재 플랜의 월 CS 답글 초안 한도를 초과했습니다. 상위 플랜에서 더 많은 답글을 받을 수 있어요.',
    });
  }
  const templates = await aiClient.generateReplyTemplates(parsed.data);
  if (userId && Array.isArray(templates) && templates.length > 0) {
    recordUsage(userId, USAGE_EVENT_TYPES.CS_REPLY_GENERATED, { amount: templates.length });
  }
  res.json({ templates });
});

export default router;
