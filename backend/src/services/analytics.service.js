// 가벼운 페이지뷰/이벤트 추적. 개인정보 미저장.
// event_name 은 allowlist 로 고정 (클라이언트가 임의 event 이름을 넣지 못함).
// path 도 allowlist 로 제한해 임의 URL 누적 방지.
import db from '../db/database.js';

// 허용 이벤트 — 클라이언트가 보낸 name 은 무시하고, 라우트별로 서버가 고정.
export const DEMO_VIEW = 'demo-view';
const ALLOWED_EVENTS = new Set([DEMO_VIEW]);

// path allowlist — demo-view 는 공개 샘플 리포트 경로만.
const ALLOWED_PATHS = new Set(['/demo/sample-report']);

const insertStmt = db.prepare(
  `INSERT INTO analytics_events (event_name, path, referrer, user_id, metadata)
   VALUES (?, ?, ?, ?, ?)`,
);

// 이벤트 기록. 잘못된 event/path 는 조용히 무시(에러 던지지 않음).
// referrer 는 호스트 단위로만 잘라 저장(개인정보/쿼리스트링 제거).
export function recordEvent({ eventName, path, referrer, userId = null, metadata = null }) {
  if (!ALLOWED_EVENTS.has(eventName)) return { ok: false, reason: 'event_not_allowed' };
  const safePath = ALLOWED_PATHS.has(path) ? path : null;
  let safeReferrer = null;
  if (referrer) {
    try {
      safeReferrer = new URL(referrer).host || null;
    } catch {
      safeReferrer = null;
    }
  }
  let metaStr = null;
  if (metadata && typeof metadata === 'object') {
    try {
      const json = JSON.stringify(metadata);
      // payload 크기 제한 — 과도한 데이터 차단
      metaStr = json.length <= 500 ? json : null;
    } catch {
      metaStr = null;
    }
  }
  insertStmt.run(eventName, safePath, safeReferrer, userId, metaStr);
  return { ok: true };
}

// 관리자용 demo-view 집계.
export function getDemoViewStats() {
  const total = db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_name = ?").get(DEMO_VIEW).c;
  const today = db
    .prepare(
      "SELECT COUNT(*) AS c FROM analytics_events WHERE event_name = ? AND date(created_at) = date('now')",
    )
    .get(DEMO_VIEW).c;
  const last7 = db
    .prepare(
      "SELECT COUNT(*) AS c FROM analytics_events WHERE event_name = ? AND created_at >= datetime('now','-7 days')",
    )
    .get(DEMO_VIEW).c;
  return { totalDemoViews: total, todayDemoViews: today, last7DaysDemoViews: last7 };
}
