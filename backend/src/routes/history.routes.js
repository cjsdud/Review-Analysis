import { Router } from 'express';
import { listAnalyses } from '../db/database.js';

const router = Router();

// GET /api/analyses — 최근 분석 히스토리 목록 (최신순).
// query: limit (기본 20, 최대 200)
// 현재 로그인 기능이 없으므로 서버에 저장된 전체 분석을 반환한다.
// TODO(로그인): 인증 도입 시 req.user.id 를 listAnalyses({ userId }) 로 넘겨 사용자별 필터링.
router.get('/', (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  try {
    const items = listAnalyses({ limit });
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: `분석 목록 조회 실패: ${e.message}` });
  }
});

export default router;
