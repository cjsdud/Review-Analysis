import { Router } from 'express';
import { listAnalyses } from '../db/database.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

// GET /api/analyses — 최근 분석 히스토리 목록 (최신순).
// 로그인 사용자는 본인 분석만, 익명 데모 모드는 user_id=null 인 분석만 본다.
router.get('/', requireAuth, (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  try {
    const items = listAnalyses({ limit, userId: req.user?.id || null, includeAnonymous: !req.user });
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: `분석 목록 조회 실패: ${e.message}` });
  }
});

export default router;
