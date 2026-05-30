// 관리자 변경 작업을 admin_action_logs 에 기록하는 헬퍼.
import { nanoid } from 'nanoid';
import db from '../db/database.js';

// 변경 로그 1건 저장.
// action_type 예: USER_ROLE_UPDATED / USER_PLAN_UPDATED / USER_DISCOUNT_CREATED / ...
export function logAdminAction({
  adminUserId,
  actionType,
  targetType = null,
  targetId = null,
  before = undefined,
  after = undefined,
  reason = null,
}) {
  const beforeStr = before === undefined ? null : typeof before === 'string' ? before : JSON.stringify(before);
  const afterStr = after === undefined ? null : typeof after === 'string' ? after : JSON.stringify(after);
  db.prepare(
    `INSERT INTO admin_action_logs (id, admin_user_id, action_type, target_type, target_id, before_value, after_value, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(nanoid(), adminUserId, actionType, targetType, targetId, beforeStr, afterStr, reason);
}

// 마지막 admin 인지 확인. true 면 강등 금지.
export function isLastAdmin(userId) {
  const target = db.prepare(`SELECT role FROM users WHERE id = ?`).get(userId);
  if (!target || target.role !== 'admin') return false;
  const count = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get();
  return Number(count?.c || 0) <= 1;
}

// 관리자 액션 로그 조회 (필터).
export function listAdminLogs({ adminUserId, actionType, targetType, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (adminUserId) { where.push('admin_user_id = ?'); params.push(adminUserId); }
  if (actionType)  { where.push('action_type = ?');  params.push(actionType); }
  if (targetType)  { where.push('target_type = ?');  params.push(targetType); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return db
    .prepare(
      `SELECT l.*, u.email AS admin_email
         FROM admin_action_logs l
         LEFT JOIN users u ON u.id = l.admin_user_id
         ${whereSql}
         ORDER BY l.created_at DESC
         LIMIT ? OFFSET ?`,
    )
    .all(...params, safeLimit, safeOffset);
}
