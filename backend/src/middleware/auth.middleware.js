// 인증 미들웨어.
// httpOnly cookie 또는 Authorization: Bearer 헤더에서 JWT 를 읽어 req.user 에 세팅한다.
// requireAuth: 토큰이 없거나 invalid 면 401.
// optionalAuth: 토큰이 있으면 사용, 없으면 통과.
//
// DEMO_ALLOW_ANONYMOUS=true 이면 기존 익명 데모 플로우(샘플 데이터 체험 등)를 유지하기 위해
// 보호 라우트에서도 requireAuth 가 optionalAuth 처럼 동작한다. 운영 모드에서는 false 로 둘 것.
import jwt from 'jsonwebtoken';
import db from '../db/database.js';

const JWT_SECRET = process.env.AUTH_JWT_SECRET || 'reviewfit-dev-secret-change-me';
export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'reviewfit_token';
export const TOKEN_EXPIRES_IN = process.env.AUTH_TOKEN_EXPIRES_IN || '7d';
const DEMO_ALLOW_ANONYMOUS = String(process.env.DEMO_ALLOW_ANONYMOUS || 'true').toLowerCase() === 'true';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7d
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function readToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function loadUser(userId) {
  const row = db
    .prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?')
    .get(userId);
  return row || null;
}

function attachUser(req) {
  const token = readToken(req);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded?.sub) return null;
    return loadUser(decoded.sub);
  } catch {
    return null;
  }
}

export function optionalAuth(req, _res, next) {
  req.user = attachUser(req);
  next();
}

export function requireAuth(req, res, next) {
  const user = attachUser(req);
  if (user) {
    req.user = user;
    return next();
  }
  if (DEMO_ALLOW_ANONYMOUS) {
    // 데모 모드 — 익명 접근을 허용하되 req.user 는 null
    req.user = null;
    return next();
  }
  return res.status(401).json({ error: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' });
}

export const isDemoAllowed = DEMO_ALLOW_ANONYMOUS;

// 관리자 인증 — requireAuth 통과 + role === 'admin'.
// DEMO_ALLOW_ANONYMOUS 와 무관하게 항상 엄격 검사.
export function requireAdmin(req, res, next) {
  const user = attachUser(req);
  if (!user) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: '로그인이 필요합니다.' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' });
  }
  req.user = user;
  next();
}
