// 인증 미들웨어.
// httpOnly cookie 또는 Authorization: Bearer 헤더에서 JWT 를 읽어 req.user 에 세팅한다.
// requireAuth: 토큰이 없거나 invalid 면 401.
// optionalAuth: 토큰이 있으면 사용, 없으면 통과.
//
// DEMO_ALLOW_ANONYMOUS=true 이면 기존 익명 데모 플로우(샘플 데이터 체험 등)를 유지하기 위해
// 보호 라우트에서도 requireAuth 가 optionalAuth 처럼 동작한다.
// 운영 기본은 false — 환경변수를 깜빡 잊었을 때 익명 접근이 열리지 않도록 안전한 기본값.
// 데모/체험 환경에서만 명시적으로 DEMO_ALLOW_ANONYMOUS=true 로 켤 것.
import jwt from 'jsonwebtoken';
import db from '../db/database.js';

// JWT 서명용 시크릿 — production 에서는 반드시 환경 변수로 강한 값을 지정해야 한다.
// production + 미설정 또는 dev fallback 그대로면 부팅 시 fail-fast 한다.
// (개발 환경은 편의 위해 기본값 허용 — 콘솔에 경고만 남긴다.)
const DEV_FALLBACK_SECRET = 'reviewfit-dev-secret-change-me';
function resolveJwtSecret() {
  const envSecret = process.env.AUTH_JWT_SECRET && String(process.env.AUTH_JWT_SECRET).trim();
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProd) {
    if (!envSecret) {
      throw new Error('AUTH_JWT_SECRET is required in production. Set a strong secret in environment variables.');
    }
    if (envSecret === DEV_FALLBACK_SECRET) {
      throw new Error('AUTH_JWT_SECRET must not be the development fallback value in production. Set a strong, unique secret.');
    }
    if (envSecret.length < 32) {
      throw new Error('AUTH_JWT_SECRET is too short for production (minimum 32 characters recommended). Set a strong, unique secret.');
    }
    return envSecret;
  }
  if (!envSecret) {
    console.warn('[auth] AUTH_JWT_SECRET 미설정 — 개발용 fallback 시크릿 사용. production 배포 전 반드시 강한 값으로 설정하세요.');
    return DEV_FALLBACK_SECRET;
  }
  return envSecret;
}
const JWT_SECRET = resolveJwtSecret();
export { resolveJwtSecret }; // 테스트/관리자 진단용 export

export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'reviewfit_token';
export const TOKEN_EXPIRES_IN = process.env.AUTH_TOKEN_EXPIRES_IN || '7d';

// DEMO_ALLOW_ANONYMOUS — 데모/체험용 익명 허용 토글.
// production 에서는 익명 분석 데이터가 모든 익명 사용자 사이에서 user_id=null 로
// 공유되어 교차 접근(다른 익명 사용자가 analysisId 만 알면 조회) 위험이 있으므로
// 부팅 시 강제 차단한다. 데모는 /demo/sample-report 같이 read-only 정적 페이지로 운영.
function resolveDemoAllowAnonymous() {
  const raw = String(process.env.DEMO_ALLOW_ANONYMOUS || 'false').toLowerCase() === 'true';
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (raw && isProd) {
    throw new Error('DEMO_ALLOW_ANONYMOUS=true is not allowed in production. Anonymous sessions share user_id=null and can cross-access each other\'s analyses. Set DEMO_ALLOW_ANONYMOUS=false in production.');
  }
  return raw;
}
const DEMO_ALLOW_ANONYMOUS = resolveDemoAllowAnonymous();
export { resolveDemoAllowAnonymous };

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
