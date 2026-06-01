// 공개 analytics 라우트 — 비로그인도 호출 가능 (예: /demo/sample-report 페이지뷰).
// 개인정보는 받지 않으며 event 이름/path 는 서버 allowlist 로 고정한다.
import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.middleware.js';
import { recordEvent, DEMO_VIEW } from '../services/analytics.service.js';

const router = Router();

// POST /api/analytics/demo-view
// body: { path?, referrer?, metadata? } — event_name 은 서버가 'demo-view' 로 고정.
// 로그인 중이면 user_id 를 함께 저장(선택). 비로그인도 허용.
router.post('/demo-view', optionalAuth, (req, res) => {
  try {
    recordEvent({
      eventName: DEMO_VIEW,
      path: typeof req.body?.path === 'string' ? req.body.path : '/demo/sample-report',
      referrer: typeof req.body?.referrer === 'string' ? req.body.referrer : null,
      userId: req.user?.id || null,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : null,
    });
  } catch {
    /* 추적 실패는 사용자 경험에 영향 주지 않음 — 조용히 무시 */
  }
  // 항상 204 (성공/무시 구분 없이) — 클라이언트가 재시도하지 않도록.
  res.status(204).end();
});

export default router;
