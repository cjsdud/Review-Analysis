import { Router } from 'express';
import { z } from 'zod';
import aiClient from '../services/aiClient.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { aiReplyLimiter } from '../middleware/rateLimit.middleware.js';
import { checkCanGenerateCsReply, recordUsage, getUserSubscription } from '../services/billing.service.js';
import { USAGE_EVENT_TYPES, normalizePlan } from '../constants/plans.js';
import { REPLY_TONES, DEFAULT_PRECOMPUTED_TONE, isReplyToneAllowedForPlan } from '../constants/replyTones.js';
import {
  buildReplyCacheKey,
  getCachedReplyTemplate,
  setCachedReplyTemplate,
  isCacheableReplyRequest,
} from '../services/csReplyCache.service.js';

const router = Router();

// POST /api/ai/reply-templates — 특정 이슈에 대한 CS 답글 초안 생성 (요청한 tone 1개).
// 플랜의 월 CS 답글 한도 검사 후 생성. 익명 데모 모드는 카운트 X.
// 미들웨어 순서: requireAuth → aiReplyLimiter (req.user 기반 키).
// rate limit 은 LLM 비용 폭주 방지용 abuse 가드 — checkCanGenerateCsReply(플랜 정책) 와 별개.
const replyTemplateSchema = z.object({
  category: z.string().optional(),
  issueLabel: z.string().min(1, 'issueLabel은 필수입니다.'),
  // 선택된 1 tone — 미설정 시 polite. 잘못된 값은 별도 400 코드(INVALID_REPLY_TONE).
  tone: z.enum(REPLY_TONES).optional(),
  // 선택 컨텍스트 — 사과 여부 / 강도 결정에 사용. 모두 optional.
  recommendedAction: z.string().optional(),
  polarity: z.string().optional(),
  isActionableIssue: z.boolean().optional(),
  severity: z.string().optional(),
  sentiment: z.string().optional(),
});

router.post('/reply-templates', requireAuth, aiReplyLimiter, async (req, res) => {
  // 잘못된 tone 은 다른 입력 오류와 다른 코드(INVALID_REPLY_TONE) 로 응답해 프론트가 분기 가능.
  if (req.body && req.body.tone != null && !REPLY_TONES.includes(req.body.tone)) {
    return res.status(400).json({
      error: 'INVALID_REPLY_TONE',
      code: 'INVALID_REPLY_TONE',
      message: '지원하지 않는 답글 말투입니다. 정중/친근/간결/공감/전문 중에서 선택해 주세요.',
    });
  }
  const parsed = replyTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'INVALID_INPUT',
      message: parsed.error.issues?.[0]?.message || 'issueLabel이 필요합니다.',
    });
  }
  const input = parsed.data;
  const tone = input.tone || DEFAULT_PRECOMPUTED_TONE;
  const userId = req.user?.id || null;

  // 플랜별 톤 게이팅 — Free 는 정중(polite) 만, Starter 이상은 5개 전부.
  // DB 의 subscriptions 를 매번 다시 조회 (관리자 plan 변경 즉시 반영, JWT stale 무시).
  const sub = userId ? getUserSubscription(userId) : null;
  const planCode = normalizePlan(sub?.plan_code || 'free');
  if (!isReplyToneAllowedForPlan(planCode, tone)) {
    return res.status(403).json({
      error: 'TONE_PLAN_LOCKED',
      code: 'TONE_PLAN_LOCKED',
      requiredPlan: 'starter',
      upgradeRequired: true,
      message: '정중한 말투 외 다른 말투는 Starter 이상에서 사용할 수 있어요.',
    });
  }

  // 플랜 한도 — tone 1개 호출당 1 차감. 캐시 히트라도 플랜 사용량은 동일하게 차감 (정책).
  const guard = checkCanGenerateCsReply(userId, 1);
  if (!guard.ok) {
    return res.status(guard.status).json({
      ...guard.body,
      upgradeRequired: true,
      message: guard.body?.message
        || '현재 플랜의 월 CS 답글 초안 한도를 초과했습니다. 상위 플랜에서 더 많은 답글을 받을 수 있어요.',
    });
  }

  // 서버 캐시 조회 — 비식별 입력만 캐시 대상. PII 가 포함된 요청은 우회.
  const cacheable = isCacheableReplyRequest({ ...input, tone });
  const cacheKey = cacheable ? buildReplyCacheKey({ ...input, tone }) : null;
  let templates = null;
  let cacheHit = false;
  if (cacheKey) {
    const cached = getCachedReplyTemplate(cacheKey);
    if (cached) {
      templates = cached;
      cacheHit = true;
    }
  }

  if (!templates) {
    // generateReplyTemplates 는 tone 인자를 받아 1개만 반환 (배열 길이 1).
    templates = await aiClient.generateReplyTemplates({ ...input, tone });
    // 정상 응답만 캐시 — fallback/[]/정책 차단은 캐시하지 않음.
    if (cacheKey && Array.isArray(templates) && templates.length > 0) {
      setCachedReplyTemplate(cacheKey, templates);
    }
  }

  if (userId && Array.isArray(templates) && templates.length > 0) {
    recordUsage(userId, USAGE_EVENT_TYPES.CS_REPLY_GENERATED, {
      amount: templates.length,
      metadata: { tone, category: input.category || null, issueLabel: input.issueLabel, cacheHit },
    });
  }
  // 응답 — 기존 프론트는 templates 만 읽으므로 meta 는 보조 정보.
  res.json({ templates, meta: { cacheHit, tone } });
});

export default router;
