// 점검 모드 미들웨어. app_settings.maintenance_mode 가 true 이면 일반 사용자 API 차단.
// 통과: /api/health, /api/auth/*, /api/me, /api/announcements/active, /api/admin/*, 정적 파일.
import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import { getBooleanSetting } from '../services/settings.service.js';
import { COOKIE_NAME } from './auth.middleware.js';

const JWT_SECRET = process.env.AUTH_JWT_SECRET || 'reviewfit-dev-secret-change-me';

const PASS_THROUGH = [
  /^\/api\/health$/,
  /^\/api\/auth\//,
  /^\/api\/me$/,
  /^\/api\/announcements\/active$/,
  /^\/api\/admin\//,
];

function isAdmin(req) {
  const token = req.cookies?.[COOKIE_NAME] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded?.sub) return false;
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(decoded.sub);
    return row?.role === 'admin';
  } catch {
    return false;
  }
}

export function maintenanceGate(req, res, next) {
  if (!req.path.startsWith('/api')) return next(); // 정적 파일 통과
  if (!getBooleanSetting('maintenance_mode', false)) return next();
  if (PASS_THROUGH.some((re) => re.test(req.path))) return next();
  if (isAdmin(req)) return next();
  return res.status(503).json({
    error: 'MAINTENANCE_MODE',
    message: '현재 서비스 점검 중입니다. 잠시 후 다시 시도해 주세요.',
  });
}
