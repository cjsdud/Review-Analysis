// 베타 샘플 분석 공유 — 외부(셀러) 공개 조회 라우트. 인증 없이 호출 가능하지만
// shareLimiter 로 코드 무차별 대입을 막는다.
//
// 응답 정책:
//   - 만료/회수/미존재는 모두 동일한 generic 404 메시지 — 코드의 존재 여부조차 흘리지 않는다.
//   - product_analyses.data 에 이미 마스킹된 리뷰만 들어 있으므로 추가 마스킹은 불필요.
//     (PII 마스킹은 분석 시점에 일관적으로 적용되며, 공유 조회는 같은 row 를 그대로 노출.)
//   - 관리자 user_id / 업로드 user_id / 결제 / 사용량 / 로그는 절대 응답에 포함하지 않는다.

import { Router } from 'express';
import db from '../db/database.js';
import { shareLimiter } from '../middleware/rateLimit.middleware.js';
import {
  resolveShareByCode,
  recordShareView,
  serializeShareForPublic,
} from '../services/sharedReport.service.js';

const router = Router();

// 공유 결과 미존재/만료/회수 — 단일 코드/메시지로 통일 (정보 누출 차단).
const INVALID_RESPONSE = {
  status: 404,
  body: {
    error: 'SHARE_INVALID',
    code: 'SHARE_INVALID',
    message: '공유 코드를 확인할 수 없습니다.',
  },
};

// POST /api/shared-reports/resolve — 폼에서 코드 입력 후 검증만 (리다이렉트용).
// body: { code }
router.post('/resolve', shareLimiter, (req, res) => {
  const result = resolveShareByCode(req.body?.code);
  if (!result.ok) return res.status(INVALID_RESPONSE.status).json(INVALID_RESPONSE.body);
  // 검증 성공 — 코드만 정규화해 돌려준다 (프론트가 /share/:code 로 push).
  res.json({ ok: true, code: result.share.code });
});

// GET /api/shared-reports/:code — 공유 결과 전체 조회 (요약 + 상품별 분석 결과).
router.get('/:code', shareLimiter, (req, res) => {
  const result = resolveShareByCode(req.params.code);
  if (!result.ok) return res.status(INVALID_RESPONSE.status).json(INVALID_RESPONSE.body);
  const share = result.share;

  const job = db
    .prepare('SELECT id, status, summary, created_at, analysis_mode FROM analysis_jobs WHERE id = ?')
    .get(share.analysis_id);
  if (!job || (job.status !== 'completed' && job.status !== 'done')) {
    // 분석이 진행 중이거나 사라진 케이스 — 외부 셀러에게 디테일 안 흘림.
    return res.status(INVALID_RESPONSE.status).json(INVALID_RESPONSE.body);
  }

  const productRows = db
    .prepare('SELECT data FROM product_analyses WHERE analysis_id = ?')
    .all(share.analysis_id);
  const products = productRows.map((r) => JSON.parse(r.data));

  let summary = {};
  try { summary = JSON.parse(job.summary || '{}'); } catch { summary = {}; }

  // 조회수 카운트는 응답 직전에 — 응답 실패 케이스에서 inflation 을 줄임.
  try { recordShareView(share.id); } catch { /* 카운트 실패는 조회 자체를 막지 않음 */ }

  res.json({
    share: serializeShareForPublic({
      ...share,
      view_count: (share.view_count || 0) + 1, // 방금 카운트 반영해 일관된 값 노출
    }),
    analysis: {
      // 외부에는 분석 id 자체도 굳이 노출할 필요 없지만, 디버깅/링크 안정성 위해
      // 분석 시각만 노출. user_id / upload_id 등은 절대 노출하지 않는다.
      createdAt: job.created_at,
      analysisMode: job.analysis_mode || null,
    },
    summary,
    products,
  });
});

export default router;
