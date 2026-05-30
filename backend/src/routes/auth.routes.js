// 인증 라우트 (register / login / logout / me).
// 비밀번호는 bcryptjs 로 해시 저장. JWT 는 httpOnly cookie 로 전달.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import db from '../db/database.js';
import {
  COOKIE_NAME,
  clearAuthCookie,
  optionalAuth,
  setAuthCookie,
  signToken,
} from '../middleware/auth.middleware.js';
import { buildMeContext, getUserSubscription } from '../services/billing.service.js';
import { getBooleanSetting } from '../services/settings.service.js';
import { isAdminEmail, maybePromoteOnLogin } from '../services/adminEmails.service.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('이메일 형식이 올바르지 않습니다.').max(200),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.').max(200),
  name: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

// 안전한 user 직렬화 (password_hash 노출 금지)
function publicUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  // 운영 설정으로 신규 가입 차단 가능
  if (!getBooleanSetting('signup_enabled', true)) {
    return res.status(403).json({ error: 'SIGNUP_DISABLED', message: '현재 신규 가입이 제한되어 있습니다.' });
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '잘못된 입력' });
  }
  const { email, password, name } = parsed.data;
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) {
    return res.status(409).json({ error: 'EMAIL_TAKEN', message: '이미 가입된 이메일입니다.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const id = nanoid();
  // ADMIN_EMAILS 에 포함된 이메일이면 가입과 동시에 admin role 부여.
  // 대소문자/공백 무시는 isAdminEmail 내부에서 처리.
  const role = isAdminEmail(email) ? 'admin' : 'user';
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, passwordHash, name || null, role);
  if (role === 'admin') {
    console.info(`[admin] New user registered as admin (matches ADMIN_EMAILS): ${email}`);
  }

  // 기본 free 구독 자동 생성
  getUserSubscription(id);

  const token = signToken({ sub: id, email });
  setAuthCookie(res, token);
  const user = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(id);
  return res.status(201).json({ user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '이메일/비밀번호를 입력하세요.' });
  }
  const { email, password } = parsed.data;
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }
  // 비밀번호 검증 성공 후에만 ADMIN_EMAILS 기준 보정.
  // 서버 재시작 없이 ADMIN_EMAILS 가 추가된 경우에도 다음 로그인부터 admin 으로 보정됨.
  const finalRole = maybePromoteOnLogin(row);
  if (finalRole !== row.role) row.role = finalRole;
  const token = signToken({ sub: row.id, email: row.email });
  setAuthCookie(res, token);
  return res.json({ user: publicUser(row) });
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

export { COOKIE_NAME };
export default router;
