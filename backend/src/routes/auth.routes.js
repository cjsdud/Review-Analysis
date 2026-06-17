// 인증 라우트. Google 로그인 only.
//
// 엔드포인트:
//   POST /api/auth/google         — Google ID Token 검증 + 사용자 생성/로그인 + ReviewFit JWT 발급
//   GET  /api/auth/google/config  — 프론트가 Google 버튼 노출 여부 결정
//   POST /api/auth/logout         — auth cookie 제거
//   GET  /api/auth/me  (alias /api/me) — 현재 사용자 + 구독 + 사용량 컨텍스트
//   DELETE /api/me/account        — 본인 계정/데이터 cascade 삭제
//
// 이메일/비밀번호 가입·로그인은 더 이상 제공하지 않는다. 모든 인증은 Google 로만 진행한다.
// 과거 /register, /login 엔드포인트는 제거되었으며, 호출 시 404 가 반환된다.

import { Router } from 'express';
import db from '../db/database.js';
import {
  COOKIE_NAME,
  clearAuthCookie,
  optionalAuth,
  requireAuth,
  setAuthCookie,
  signToken,
} from '../middleware/auth.middleware.js';
import { deleteUserAccountCascade } from '../services/dataLifecycle.service.js';
import { buildMeContext } from '../services/billing.service.js';
import { getBooleanSetting } from '../services/settings.service.js';
import { maybePromoteOnLogin } from '../services/adminEmails.service.js';
import { authLimiter } from '../middleware/rateLimit.middleware.js';
import {
  isGoogleLoginConfigured,
  verifyGoogleIdToken,
  findOrCreateUserFromGooglePayload,
  tokenPayloadFromUser,
} from '../services/googleAuth.service.js';

const router = Router();

// GET /api/auth/google/config — 프론트가 Google 로그인 노출 여부 판단용.
// VITE_GOOGLE_CLIENT_ID 미설정 / 백엔드 미설정 환경에서 버튼을 숨길지 결정.
router.get('/google/config', (_req, res) => {
  res.json({ enabled: isGoogleLoginConfigured() });
});

// POST /api/auth/google — Google ID Token 검증 + 계정 연결/생성 + ReviewFit JWT 발급.
// 미들웨어: authLimiter (Google 로그인 brute force / 검증 spam 차단). credential 원문은 절대 로그 X.
router.post('/google', authLimiter, async (req, res) => {
  if (!isGoogleLoginConfigured()) {
    return res.status(503).json({
      error: 'GOOGLE_NOT_CONFIGURED',
      code: 'GOOGLE_NOT_CONFIGURED',
      message: 'Google 로그인 설정이 완료되지 않았어요. 잠시 후 다시 시도해 주세요.',
    });
  }
  const credential = String(req.body?.credential || '').trim();
  if (!credential) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'INVALID_INPUT',
      message: 'Google 로그인 인증 정보를 받지 못했어요.',
    });
  }
  let payload;
  try {
    payload = await verifyGoogleIdToken(credential);
  } catch (e) {
    if (e.code === 'GOOGLE_NOT_CONFIGURED') {
      return res.status(503).json({ error: e.code, code: e.code, message: 'Google 로그인 설정이 완료되지 않았어요.' });
    }
    // 검증 실패는 401. credential / e.reason 은 응답에 노출하지 않는다.
    console.warn(`[auth/google] verify failed code=${e.code || 'unknown'}`);
    return res.status(401).json({
      error: 'GOOGLE_LOGIN_FAILED',
      code: 'GOOGLE_LOGIN_FAILED',
      message: 'Google 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.',
    });
  }

  let result;
  try {
    result = findOrCreateUserFromGooglePayload(payload);
  } catch (e) {
    if (e.code === 'GOOGLE_EMAIL_UNVERIFIED') {
      return res.status(403).json({
        error: 'GOOGLE_EMAIL_UNVERIFIED',
        code: 'GOOGLE_EMAIL_UNVERIFIED',
        message: '확인되지 않은 Google 계정이에요. 다른 Google 계정으로 시도해 주세요.',
      });
    }
    console.error('[auth/google] find/create failed', e);
    return res.status(500).json({
      error: 'GOOGLE_LOGIN_FAILED',
      code: 'GOOGLE_LOGIN_FAILED',
      message: 'Google 로그인 중 일시적인 문제가 있었어요.',
    });
  }

  // 신규 가입 차단 토글 — kind=created 만 차단해서 returning/linked 는 영향 없음.
  if (result.kind === 'created' && !getBooleanSetting('signup_enabled', true)) {
    return res.status(403).json({
      error: 'SIGNUP_DISABLED',
      code: 'SIGNUP_DISABLED',
      message: '현재 신규 가입이 제한되어 있어요.',
    });
  }

  // 로그인 시 ADMIN_EMAILS 보정 — 새 user / returning / linked 모두 보정.
  // user row 를 DB 에서 다시 읽어 maybePromoteOnLogin 입력.
  const row = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(result.user.id);
  const finalRole = row ? maybePromoteOnLogin(row) : result.user.role;
  if (row && finalRole !== row.role) {
    result.user.role = finalRole;
  }

  const token = signToken(tokenPayloadFromUser(result.user));
  setAuthCookie(res, token);
  return res.json({
    user: result.user,
    kind: result.kind, // 운영 진단용 — 'returning' / 'linked' / 'created'
  });
});

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

// GET /api/me — 현재 로그인 사용자 + 구독/사용량 컨텍스트
router.get('/me', optionalAuth, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' });
  }
  return res.json(buildMeContext(req.user));
});

// DELETE /api/me/account — 계정 탈퇴 (cascade 데이터 삭제 + 쿠키 제거).
// 권한:
//   - requireAuth (로그인 필수)
//   - 본인 user_id 기준만 삭제 (다른 user 삭제 불가)
//   - 마지막 admin 은 차단(LAST_ADMIN_PROTECTED).
router.delete('/me/account', requireAuth, (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' });
  const result = deleteUserAccountCascade(userId);
  if (!result.ok) {
    if (result.error === 'LAST_ADMIN_PROTECTED') {
      return res.status(409).json({
        error: 'LAST_ADMIN_PROTECTED',
        message: '마지막 관리자 계정은 탈퇴할 수 없습니다. 다른 관리자에게 권한을 위임한 후 다시 시도해 주세요.',
      });
    }
    if (result.error === 'NOT_FOUND') {
      // 이미 삭제된 사용자 — 쿠키만 정리해 클라이언트 로그아웃.
      clearAuthCookie(res);
      return res.status(404).json({ error: 'NOT_FOUND', message: '계정을 찾을 수 없습니다.' });
    }
    return res.status(500).json({ error: 'DELETE_FAILED', message: '계정 삭제 중 일시적인 문제가 있었어요.' });
  }
  // 삭제 성공 — 쿠키 즉시 만료시켜 다음 요청부터 익명 처리.
  clearAuthCookie(res);
  return res.json({ ok: true, message: '계정이 삭제되었습니다.', counts: result.counts });
});

export { COOKIE_NAME };
export default router;
