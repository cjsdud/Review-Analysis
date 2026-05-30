// 사용자 공개용 공지/배너 조회 API.
import { Router } from 'express';
import db from '../db/database.js';
import { getBooleanSetting, getSetting } from '../services/settings.service.js';

const router = Router();

// GET /api/announcements/active — 현재 시점에 활성인 공지 목록 + 단일 토글 배너.
// is_active=1 + (starts_at <= now or null) + (ends_at >= now or null)
router.get('/active', (_req, res) => {
  const rows = db.prepare(
    `SELECT id, title, content, type, starts_at, ends_at
       FROM announcements
       WHERE is_active = 1
         AND (starts_at IS NULL OR starts_at <= datetime('now'))
         AND (ends_at   IS NULL OR ends_at   >= datetime('now'))
       ORDER BY created_at DESC`,
  ).all();

  // 단일 토글 배너 (settings 기반) — 별도로 노출
  const bannerEnabled = getBooleanSetting('notice_banner_enabled', false);
  const bannerText = getSetting('notice_banner_text', '');
  const banner = bannerEnabled && bannerText ? { type: 'info', text: bannerText } : null;

  res.json({ announcements: rows, banner });
});

export default router;
