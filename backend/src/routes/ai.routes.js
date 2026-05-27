import { Router } from 'express';
import { z } from 'zod';
import aiClient from '../services/aiClient.service.js';

const router = Router();

// POST /api/ai/reply-templates — 특정 이슈에 대한 답글 템플릿 생성
router.post('/reply-templates', async (req, res) => {
  const schema = z.object({ category: z.string().optional(), issueLabel: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'issueLabel이 필요합니다.' });
  const templates = await aiClient.generateReplyTemplates(parsed.data);
  res.json({ templates });
});

export default router;
