// 관리자 콘솔 API. 모든 라우트에 requireAdmin 적용.
// 변경 작업은 admin_action_logs 에 기록한다.
import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import db from '../db/database.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { listSettings, setSetting } from '../services/settings.service.js';
import { logAdminAction, isLastAdmin, listAdminLogs } from '../services/adminAudit.service.js';
import { getDemoViewStats } from '../services/analytics.service.js';
import { resetMonthlyUsage } from '../services/billing.service.js';
import { listLlmLogs, getLlmLog, getLlmUsageSummary } from '../services/ai/usage.service.js';
import {
  getAnalysisStatusSummary,
  retryAnalysisJob,
  createPendingJob,
  runAnalysisJob,
} from '../services/analysisJob.service.js';
import {
  createShareForAnalysis,
  listSharesForAnalysis,
  listAllShares,
  revokeShare,
  updateShareExpiry,
  getShareById,
  isAnalysisShareable,
  serializeShareForAdmin,
  DEFAULT_SHARE_EXPIRES_DAYS,
} from '../services/sharedReport.service.js';
// admin retry 라우트가 사용 — loadReviews / loadAllCorrections 는 analysis.routes.js 에
// export 되어 있다. 누락하면 POST /admin/analyses/:id/retry 호출 시
// ReferenceError: loadReviews is not defined 로 즉시 500 응답이 나간다.
// 순환 참조 없음 (analysis.routes.js 는 admin.routes.js 를 import 하지 않음).
import { loadReviews, loadAllCorrections } from './analysis.routes.js';

const router = Router();

router.use(requireAdmin);

// ===== 1) /summary — 전체 운영 요약 =====
router.get('/summary', (_req, res) => {
  const users = db.prepare(`SELECT
      (SELECT COUNT(*) FROM users) AS total,
      (SELECT COUNT(*) FROM users WHERE date(created_at) = date('now')) AS new_today,
      (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now','start of month')) AS new_this_month,
      (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admin_count`).get();

  const analyses = db.prepare(`SELECT
      (SELECT COUNT(*) FROM analysis_jobs) AS total,
      (SELECT COUNT(*) FROM analysis_jobs WHERE date(created_at) = date('now')) AS today,
      (SELECT COUNT(*) FROM analysis_jobs WHERE created_at >= datetime('now','-7 days')) AS this_week,
      (SELECT COUNT(*) FROM analysis_jobs WHERE created_at >= datetime('now','start of month')) AS this_month,
      (SELECT COUNT(*) FROM analysis_jobs WHERE status = 'error') AS failed`).get();

  const usage = db.prepare(`SELECT
      (SELECT COUNT(*) FROM reviews) AS total_reviews,
      (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE event_type = 'analysis_created' AND created_at >= datetime('now','start of month')) AS active_users_this_month`).get();
  const analysisCountForAvg = analyses.total || 0;
  const avgReviews = analysisCountForAvg ? Math.round((usage.total_reviews || 0) / analysisCountForAvg) : 0;

  const plansRows = db.prepare(
    `SELECT plan_code, COUNT(*) AS c FROM subscriptions WHERE status IN ('active','trialing') GROUP BY plan_code`,
  ).all();
  const plans = { free: 0, starter: 0, pro: 0 };
  for (const r of plansRows) plans[r.plan_code] = Number(r.c);

  res.json({
    users: {
      total: users.total,
      newToday: users.new_today,
      newThisMonth: users.new_this_month,
      adminCount: users.admin_count,
    },
    analyses: {
      total: analyses.total,
      today: analyses.today,
      thisWeek: analyses.this_week,
      thisMonth: analyses.this_month,
      failedCount: analyses.failed,
    },
    usage: {
      totalReviewsAnalyzed: usage.total_reviews,
      averageReviewsPerAnalysis: avgReviews,
      activeUsersThisMonth: usage.active_users_this_month,
    },
    plans,
  });
});

// ===== 2) /users — 사용자 목록 / 상세 / 수정 =====
router.get('/users', (req, res) => {
  const { search = '', role, plan } = req.query;
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const where = [];
  const params = [];
  if (search) { where.push('(LOWER(u.email) LIKE ? OR LOWER(COALESCE(u.name,\'\')) LIKE ?)'); params.push(`%${String(search).toLowerCase()}%`, `%${String(search).toLowerCase()}%`); }
  if (role)   { where.push('u.role = ?'); params.push(role); }
  if (plan)   { where.push("(SELECT plan_code FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active','trialing') ORDER BY s.created_at DESC LIMIT 1) = ?"); params.push(plan); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.created_at,
        (SELECT plan_code FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active','trialing') ORDER BY s.created_at DESC LIMIT 1) AS plan_code,
        (SELECT status FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active','trialing') ORDER BY s.created_at DESC LIMIT 1) AS sub_status,
        (SELECT COALESCE(SUM(amount),0) FROM usage_events e WHERE e.user_id = u.id AND e.event_type='analysis_created' AND e.created_at >= datetime('now','start of month')) AS month_used,
        (SELECT MAX(created_at) FROM analysis_jobs a WHERE a.user_id = u.id) AS last_analysis_at
       FROM users u
       ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  res.json(rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    planCode: r.plan_code || 'free',
    subscriptionStatus: r.sub_status || null,
    monthlyAnalysisUsed: r.month_used || 0,
    createdAt: r.created_at,
    lastAnalysisAt: r.last_analysis_at,
  })));
});

router.get('/users/:id', (req, res) => {
  const u = db.prepare('SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
  const sub = db.prepare(`SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing') ORDER BY created_at DESC LIMIT 1`).get(req.params.id);
  const monthUsed = db.prepare(`SELECT COALESCE(SUM(amount),0) AS c FROM usage_events WHERE user_id = ? AND event_type='analysis_created' AND created_at >= datetime('now','start of month')`).get(req.params.id);
  const analyses = db.prepare(`SELECT id, status, created_at FROM analysis_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`).all(req.params.id);
  const discounts = db.prepare(`SELECT * FROM user_discounts WHERE user_id = ? ORDER BY created_at DESC`).all(req.params.id);
  const logs = listAdminLogs({ targetType: 'user', limit: 20 }).filter((l) => l.target_id === req.params.id);
  res.json({
    user: u,
    subscription: sub || null,
    usage: { monthlyAnalysisUsed: monthUsed.c },
    recentAnalyses: analyses,
    discounts,
    recentAdminLogs: logs,
  });
});

const userPatchSchema = z.object({
  name: z.string().max(100).optional(),
  role: z.enum(['user', 'admin']).optional(),
  planCode: z.enum(['free', 'starter', 'pro', 'business']).optional(),
  subscriptionStatus: z.enum(['active', 'trialing', 'past_due', 'canceled', 'expired']).optional(),
  reason: z.string().max(500).optional(),
});

router.patch('/users/:id', (req, res) => {
  const parsed = userPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });

  const { name, role, planCode, subscriptionStatus, reason } = parsed.data;
  const adminId = req.user.id;

  // 마지막 admin 보호 — admin → user 강등 금지
  if (role && role !== target.role && target.role === 'admin' && role === 'user' && isLastAdmin(target.id)) {
    return res.status(400).json({ error: 'LAST_ADMIN_PROTECTED', message: '마지막 관리자 계정은 일반 사용자로 변경할 수 없습니다.' });
  }
  // 자기 자신의 role 변경 금지(실수 방지)
  if (role && role !== target.role && target.id === adminId) {
    return res.status(400).json({ error: 'SELF_ROLE_CHANGE_BLOCKED', message: '본인 role 은 직접 변경할 수 없습니다. 다른 관리자에게 요청하세요.' });
  }

  const updates = [];
  const params = [];
  if (name !== undefined && name !== target.name) { updates.push('name = ?'); params.push(name); }
  if (role && role !== target.role) { updates.push('role = ?'); params.push(role); }
  if (updates.length) {
    updates.push("updated_at = CURRENT_TIMESTAMP");
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params, target.id);
  }

  if (role && role !== target.role) {
    logAdminAction({ adminUserId: adminId, actionType: 'USER_ROLE_UPDATED', targetType: 'user', targetId: target.id, before: target.role, after: role, reason });
  }
  if (planCode || subscriptionStatus) {
    const currentSub = db.prepare(`SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing') ORDER BY created_at DESC LIMIT 1`).get(target.id);
    const nextPlan = planCode || currentSub?.plan_code || 'free';
    const nextStatus = subscriptionStatus || currentSub?.status || 'active';
    if (currentSub) {
      db.prepare(`UPDATE subscriptions SET plan_code = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(nextPlan, nextStatus, currentSub.id);
    } else {
      db.prepare(`INSERT INTO subscriptions (id, user_id, plan_code, status) VALUES (?, ?, ?, ?)`)
        .run(nanoid(), target.id, nextPlan, nextStatus);
    }
    logAdminAction({
      adminUserId: adminId,
      actionType: 'USER_PLAN_UPDATED',
      targetType: 'user',
      targetId: target.id,
      before: { planCode: currentSub?.plan_code, status: currentSub?.status },
      after: { planCode: nextPlan, status: nextStatus },
      reason,
    });
  }

  const fresh = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(target.id);
  res.json({ user: fresh });
});

// ===== 2-1) /users/:id/usage/reset — 이번 달 사용량 초기화 (테스트용) =====
router.post('/users/:id/usage/reset', (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
  const deleted = resetMonthlyUsage(target.id);
  logAdminAction({
    adminUserId: req.user.id,
    actionType: 'USER_USAGE_RESET',
    targetType: 'user',
    targetId: target.id,
    after: { deleted },
    reason: (req.body?.reason || '').slice(0, 500),
  });
  res.json({ ok: true, deleted });
});

// ===== 3) /users/:id/discounts — 할인 관리 =====
const discountSchema = z.object({
  discountType: z.enum(['percent', 'fixed_krw', 'free_months', 'custom']),
  discountValue: z.number().int(),
  reason: z.string().max(500).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

router.get('/users/:id/discounts', (req, res) => {
  const rows = db.prepare('SELECT * FROM user_discounts WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows);
});

router.post('/users/:id/discounts', (req, res) => {
  const parsed = discountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' });
  const id = nanoid();
  db.prepare(
    `INSERT INTO user_discounts (id, user_id, discount_type, discount_value, reason, starts_at, ends_at, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(id, user.id, parsed.data.discountType, parsed.data.discountValue, parsed.data.reason || null, parsed.data.startsAt || null, parsed.data.endsAt || null, req.user.id);
  logAdminAction({ adminUserId: req.user.id, actionType: 'USER_DISCOUNT_CREATED', targetType: 'user', targetId: user.id, after: parsed.data, reason: parsed.data.reason });
  res.status(201).json({ id });
});

router.patch('/discounts/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM user_discounts WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'NOT_FOUND', message: '할인을 찾을 수 없습니다.' });
  const body = req.body || {};
  const updates = [];
  const params = [];
  const allowed = ['discount_type', 'discount_value', 'reason', 'starts_at', 'ends_at', 'is_active'];
  const mapped = {
    discountType: 'discount_type',
    discountValue: 'discount_value',
    startsAt: 'starts_at',
    endsAt: 'ends_at',
    isActive: 'is_active',
  };
  for (const [k, v] of Object.entries(body)) {
    const col = mapped[k] || k;
    if (!allowed.includes(col)) continue;
    updates.push(`${col} = ?`);
    params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (!updates.length) return res.status(400).json({ error: 'INVALID_INPUT', message: '변경할 항목이 없습니다.' });
  db.prepare(`UPDATE user_discounts SET ${updates.join(', ')} WHERE id = ?`).run(...params, target.id);
  logAdminAction({ adminUserId: req.user.id, actionType: 'USER_DISCOUNT_UPDATED', targetType: 'user_discount', targetId: target.id, before: target, after: body, reason: body.reason });
  res.json({ ok: true });
});

// ===== /analytics/demo — 공개 샘플 리포트 조회 수 =====
router.get('/analytics/demo', (_req, res) => {
  res.json(getDemoViewStats());
});

// ===== 4) /analytics/reports — 리포트 실행 추이 =====
router.get('/analytics/reports', (req, res) => {
  const range = req.query.range || '30d';
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const groupBy = req.query.groupBy === 'week' ? 'week' : req.query.groupBy === 'month' ? 'month' : 'day';
  const groupFmt = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-%W' : '%Y-%m-%d';

  const series = db.prepare(
    `SELECT strftime(?, a.created_at) AS date,
            COUNT(*) AS analysis_count,
            COUNT(DISTINCT a.user_id) AS active_user_count,
            SUM(CASE WHEN a.status='error' THEN 1 ELSE 0 END) AS failed_count
       FROM analysis_jobs a
       WHERE a.created_at >= datetime('now', ?)
       GROUP BY date
       ORDER BY date ASC`,
  ).all(groupFmt, `-${days} days`);

  // 리뷰 수 / 상품 수는 join 비용을 줄여 별도 집계 후 합치기
  const reviewSeries = db.prepare(
    `SELECT strftime(?, a.created_at) AS date,
            (SELECT COUNT(*) FROM reviews r WHERE r.upload_id = a.upload_id) AS rcount,
            (SELECT COUNT(*) FROM product_analyses p WHERE p.analysis_id = a.id) AS pcount
       FROM analysis_jobs a
       WHERE a.created_at >= datetime('now', ?)`,
  ).all(groupFmt, `-${days} days`);
  const reviewByDate = new Map();
  const productByDate = new Map();
  for (const r of reviewSeries) {
    reviewByDate.set(r.date, (reviewByDate.get(r.date) || 0) + (r.rcount || 0));
    productByDate.set(r.date, (productByDate.get(r.date) || 0) + (r.pcount || 0));
  }
  const seriesOut = series.map((s) => ({
    date: s.date,
    analysisCount: s.analysis_count,
    reviewCount: reviewByDate.get(s.date) || 0,
    productCount: productByDate.get(s.date) || 0,
    activeUserCount: s.active_user_count,
    failedCount: s.failed_count,
  }));

  const topUsers = db.prepare(
    `SELECT u.id AS user_id, u.email,
            COUNT(a.id) AS analysis_count,
            (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS review_count
       FROM analysis_jobs a
       JOIN users u ON u.id = a.user_id
       WHERE a.created_at >= datetime('now', ?)
       GROUP BY u.id
       ORDER BY analysis_count DESC
       LIMIT 10`,
  ).all(`-${days} days`);

  const topSources = db.prepare(
    `SELECT COALESCE(uf.source, 'custom') AS source, COUNT(*) AS analysis_count
       FROM analysis_jobs a
       LEFT JOIN upload_files uf ON uf.id = a.upload_id
       WHERE a.created_at >= datetime('now', ?)
       GROUP BY source
       ORDER BY analysis_count DESC`,
  ).all(`-${days} days`);

  res.json({
    range,
    groupBy,
    series: seriesOut,
    topUsers: topUsers.map((r) => ({ userId: r.user_id, email: r.email, analysisCount: r.analysis_count, reviewCount: r.review_count })),
    topSources: topSources.map((r) => ({ source: r.source, analysisCount: r.analysis_count })),
  });
});

// ===== 5) /settings — 운영 설정 =====
router.get('/settings', (req, res) => {
  const rows = listSettings(req.query.category || null);
  res.json(rows.map((r) => ({
    key: r.key,
    value: r.value,
    valueType: r.value_type,
    label: r.label,
    description: r.description,
    category: r.category,
    isPublic: !!r.is_public,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  })));
});

router.patch('/settings/:key', (req, res) => {
  const body = z.object({ value: z.any(), reason: z.string().max(500).optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  try {
    const out = setSetting(req.params.key, body.data.value, req.user.id, body.data.reason);
    return res.json(out);
  } catch (e) {
    if (e.code === 'SECRET_KEY_BLOCKED') return res.status(400).json({ error: 'SECRET_KEY_BLOCKED', message: '이 키는 환경변수에서만 관리됩니다.' });
    if (e.code === 'SETTING_NOT_FOUND')  return res.status(404).json({ error: 'SETTING_NOT_FOUND', message: '설정 키를 찾을 수 없습니다.' });
    return res.status(400).json({ error: 'INVALID_VALUE', message: e.message });
  }
});

// ===== 6) /announcements — 공지/배너 =====
const annSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  type: z.enum(['info', 'warning', 'maintenance', 'promotion']).default('info'),
  isActive: z.boolean().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

router.get('/announcements', (_req, res) => {
  const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  res.json(rows);
});

router.post('/announcements', (req, res) => {
  const parsed = annSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message });
  const id = nanoid();
  db.prepare(
    `INSERT INTO announcements (id, title, content, type, is_active, starts_at, ends_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, parsed.data.title, parsed.data.content, parsed.data.type, parsed.data.isActive === false ? 0 : 1, parsed.data.startsAt || null, parsed.data.endsAt || null, req.user.id);
  logAdminAction({ adminUserId: req.user.id, actionType: 'ANNOUNCEMENT_CREATED', targetType: 'announcement', targetId: id, after: parsed.data });
  res.status(201).json({ id });
});

router.patch('/announcements/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
  const body = req.body || {};
  const map = { isActive: 'is_active', startsAt: 'starts_at', endsAt: 'ends_at' };
  const allowed = new Set(['title', 'content', 'type', 'is_active', 'starts_at', 'ends_at']);
  const updates = [];
  const params = [];
  for (const [k, v] of Object.entries(body)) {
    const col = map[k] || k;
    if (!allowed.has(col)) continue;
    updates.push(`${col} = ?`);
    params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  if (!updates.length) return res.status(400).json({ error: 'INVALID_INPUT' });
  updates.push('updated_by = ?'); params.push(req.user.id);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  db.prepare(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`).run(...params, target.id);
  logAdminAction({ adminUserId: req.user.id, actionType: 'ANNOUNCEMENT_UPDATED', targetType: 'announcement', targetId: target.id, before: target, after: body });
  res.json({ ok: true });
});

router.delete('/announcements/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
  // 실제 삭제 대신 비활성화 (감사 추적용)
  db.prepare(`UPDATE announcements SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(req.user.id, target.id);
  logAdminAction({ adminUserId: req.user.id, actionType: 'ANNOUNCEMENT_DELETED', targetType: 'announcement', targetId: target.id, before: target });
  res.json({ ok: true });
});

// ===== 7) /action-logs — 관리자 변경 이력 =====
router.get('/action-logs', (req, res) => {
  const rows = listAdminLogs({
    adminUserId: req.query.adminUserId,
    actionType: req.query.actionType,
    targetType: req.query.targetType,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json(rows.map((r) => ({
    id: r.id,
    adminUserId: r.admin_user_id,
    adminEmail: r.admin_email,
    actionType: r.action_type,
    targetType: r.target_type,
    targetId: r.target_id,
    before: r.before_value,
    after: r.after_value,
    reason: r.reason,
    createdAt: r.created_at,
  })));
});

// ===== AI 분석 로그 (LLM 사용량) =====
// admin only — provider / model / token / cost / cache / fallback 정보를 한 줄씩 노출.
// 일반 사용자 API 에서는 절대 노출하지 않는다.
function rowToLlmLog(r) {
  if (!r) return null;
  return {
    id: r.id,
    createdAt: r.created_at,
    userId: r.user_id,
    userEmail: r.user_email || null,
    analysisId: r.analysis_id,
    provider: r.provider,
    model: r.model,
    requestType: r.request_type,
    promptVersion: r.prompt_version,
    analysisVersion: r.analysis_version,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    totalTokens: r.total_tokens,
    estimatedCostUsd: r.estimated_cost_usd,
    reviewCount: r.review_count,
    cacheHitCount: r.cache_hit_count,
    cacheMissCount: r.cache_miss_count,
    miniReanalysisCount: r.mini_reanalysis_count,
    openaiCalled: r.openai_called === 1,
    fallbackUsed: r.fallback_used === 1,
    fallbackProvider: r.fallback_provider,
    status: r.status,
    errorMessage: r.error_message,
  };
}

router.get('/llm-logs', (req, res) => {
  const { page, limit, provider, model, requestType, userId, analysisId, dateFrom, dateTo } = req.query;
  const { rows, total, page: p, limit: l } = listLlmLogs({
    page: Number(page) || 1,
    limit: Number(limit) || 20,
    filters: { provider, model, requestType, userId, analysisId, dateFrom, dateTo },
  });
  res.json({
    success: true,
    logs: rows.map(rowToLlmLog),
    pagination: { page: p, limit: l, total },
  });
});

router.get('/llm-logs/summary', (_req, res) => {
  res.json({ success: true, summary: getLlmUsageSummary() });
});

router.get('/llm-logs/:id', (req, res) => {
  const row = getLlmLog(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND', message: '로그를 찾을 수 없습니다.' });
  res.json({ success: true, log: rowToLlmLog(row) });
});

// ===== 분석 진행 상태 (Admin only) =====
// 관리자가 pending/processing/completed/failed 카운트 + 최근 실패/진행 목록을 본다.
router.get('/analysis-status-summary', (_req, res) => {
  res.json({ success: true, summary: getAnalysisStatusSummary({ recentLimit: 5 }) });
});

// 실패 분석 재실행 — admin 만. completed/processing/pending 은 차단.
// 사용자 plan 사용량은 다시 차감하지 않음 (테스트/복구 목적).
router.post('/analyses/:analysisId/retry', async (req, res) => {
  const { analysisId } = req.params;
  const guard = await retryAnalysisJob(analysisId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
  const job = guard.job;

  // upload_files.rows 는 완료 시 NULL 처리되지만 failed 분석은 그대로 살아 있다.
  const reviews = loadReviews(job.upload_id);
  if (!reviews.length) {
    return res.status(409).json({
      error: '원본 리뷰 데이터가 남아 있지 않아 재실행할 수 없습니다. 사용자가 다시 업로드해야 합니다.',
    });
  }

  // 기존 row 를 pending 으로 리셋하고 (createPendingJob 이 INSERT 라 여기선 직접 UPDATE)
  // background 로 실행. retry 자체 로그는 admin_action_logs 에 남긴다.
  const dbMod = (await import('../db/database.js')).default;
  dbMod.prepare(
    `UPDATE analysis_jobs
     SET status = 'pending', progress = 0, error_message = NULL, failed_at = NULL,
         started_at = NULL, completed_at = NULL
     WHERE id = ?`,
  ).run(analysisId);

  const sub = job.user_id
    ? dbMod.prepare(`SELECT plan_code FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing') ORDER BY created_at DESC LIMIT 1`).get(job.user_id)
    : null;
  const planCode = sub?.plan_code || 'free';
  const corrections = loadAllCorrections();

  setImmediate(() => {
    runAnalysisJob({
      analysisId,
      uploadId: job.upload_id,
      userId: job.user_id,
      reviews,
      corrections,
      planCode,
      isSample: job.is_sample === 1,
    }).catch((e) => console.error('[admin retry] background error', e));
  });

  logAdminAction({
    adminUserId: req.user.id,
    actionType: 'ANALYSIS_RETRIED',
    targetType: 'analysis',
    targetId: analysisId,
    reason: (req.body?.reason || '').slice(0, 500),
  });

  res.json({
    success: true,
    analysisId,
    status: 'processing',
    message: '분석을 다시 시작했습니다.',
  });
});

// ===== 베타 샘플 공유 코드 관리 =====
// 외부 셀러에게 분석 결과를 보여주기 위한 읽기 전용 공유 코드.
// 모든 변경 작업은 admin_action_logs 에 기록.

// 전체 공유 코드 목록 — admin 콘솔 "공유 코드" 탭 메인 뷰.
router.get('/shared-reports', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = listAllShares({ limit, offset });
  res.json({ shares: rows.map(serializeShareForAdmin) });
});

// 특정 analysis 의 공유 코드 목록.
router.get('/analyses/:analysisId/share', (req, res) => {
  const rows = listSharesForAnalysis(req.params.analysisId);
  res.json({ shares: rows.map(serializeShareForAdmin) });
});

// 공유 코드 생성. body: { expiresInDays?: number | null, reason?: string }
router.post('/analyses/:analysisId/share', (req, res) => {
  const analysisId = req.params.analysisId;
  const guard = isAnalysisShareable(analysisId);
  if (!guard.ok) {
    if (guard.reason === 'not_found') {
      return res.status(404).json({ error: 'ANALYSIS_NOT_FOUND', message: '분석을 찾을 수 없습니다.' });
    }
    return res.status(400).json({
      error: 'ANALYSIS_NOT_COMPLETED',
      message: '완료된 분석에 대해서만 공유 코드를 만들 수 있어요.',
    });
  }
  const bodySchema = z.object({
    expiresInDays: z.number().int().min(0).max(3650).nullable().optional(),
    reason: z.string().max(500).optional(),
  });
  const parsed = bodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '입력 값이 올바르지 않습니다.' });
  }
  const expiresInDays = parsed.data.expiresInDays === undefined
    ? DEFAULT_SHARE_EXPIRES_DAYS
    : parsed.data.expiresInDays;
  const share = createShareForAnalysis({
    analysisId,
    createdBy: req.user.id,
    expiresInDays,
  });
  logAdminAction({
    adminUserId: req.user.id,
    actionType: 'SHARE_CREATED',
    targetType: 'shared_report',
    targetId: share.id,
    after: { analysisId, code: share.code, expiresAt: share.expires_at },
    reason: parsed.data.reason || null,
  });
  res.status(201).json({ share: serializeShareForAdmin(share) });
});

// 만료일 변경. body: { expiresInDays: number | null, reason?: string }
router.patch('/shared-reports/:shareId', (req, res) => {
  const current = getShareById(req.params.shareId);
  if (!current) return res.status(404).json({ error: 'SHARE_NOT_FOUND', message: '공유 코드를 찾을 수 없습니다.' });
  const bodySchema = z.object({
    expiresInDays: z.number().int().min(0).max(3650).nullable(),
    reason: z.string().max(500).optional(),
  });
  const parsed = bodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '입력 값이 올바르지 않습니다.' });
  }
  const ok = updateShareExpiry(req.params.shareId, parsed.data.expiresInDays);
  if (!ok) return res.status(500).json({ error: 'UPDATE_FAILED', message: '만료일 변경에 실패했어요.' });
  const updated = getShareById(req.params.shareId);
  logAdminAction({
    adminUserId: req.user.id,
    actionType: 'SHARE_EXPIRY_UPDATED',
    targetType: 'shared_report',
    targetId: req.params.shareId,
    before: { expiresAt: current.expires_at },
    after: { expiresAt: updated.expires_at },
    reason: parsed.data.reason || null,
  });
  res.json({ share: serializeShareForAdmin(updated) });
});

// 공유 코드 회수(비활성화). body: { reason?: string }
router.post('/shared-reports/:shareId/revoke', (req, res) => {
  const current = getShareById(req.params.shareId);
  if (!current) return res.status(404).json({ error: 'SHARE_NOT_FOUND', message: '공유 코드를 찾을 수 없습니다.' });
  if (current.revoked_at) {
    // 이미 회수됨 — idempotent 200.
    return res.json({ share: serializeShareForAdmin(current) });
  }
  revokeShare(req.params.shareId);
  const updated = getShareById(req.params.shareId);
  logAdminAction({
    adminUserId: req.user.id,
    actionType: 'SHARE_REVOKED',
    targetType: 'shared_report',
    targetId: req.params.shareId,
    before: { revokedAt: null },
    after: { revokedAt: updated.revoked_at },
    reason: (req.body?.reason || '').slice(0, 500) || null,
  });
  res.json({ share: serializeShareForAdmin(updated) });
});

export default router;
