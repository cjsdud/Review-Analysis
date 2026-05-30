// 사용자 화면 상단 공지/배너.
// 1) GET /api/announcements/active 에서 활성 공지(announcements) + 단일 토글 배너(banner) 가져옴
// 2) localStorage 로 하루 동안 닫기 가능
import { useEffect, useState } from 'react';
import { getActiveAnnouncements } from '../api/adminApi.js';

const HIDE_KEY = 'reviewfit:announcement:hidden';
const HIDE_FOR_MS = 24 * 60 * 60 * 1000; // 1일

function loadHidden() {
  try {
    const raw = localStorage.getItem(HIDE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const fresh = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && now - ts < HIDE_FOR_MS) fresh[id] = ts;
    }
    return fresh;
  } catch { return {}; }
}

function saveHidden(map) {
  try { localStorage.setItem(HIDE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

const TYPE_LABEL = { info: 'ℹ️', warning: '⚠️', maintenance: '🛠️', promotion: '🎁' };

export default function AnnouncementBanner() {
  const [data, setData] = useState({ announcements: [], banner: null });
  const [hidden, setHidden] = useState(loadHidden);

  useEffect(() => {
    getActiveAnnouncements().then(setData).catch(() => {});
  }, []);

  function dismiss(id) {
    const next = { ...hidden, [id]: Date.now() };
    setHidden(next);
    saveHidden(next);
  }

  const items = (data.announcements || []).filter((a) => !hidden[a.id]);
  const banner = data.banner && !hidden['banner_setting'] ? data.banner : null;
  if (items.length === 0 && !banner) return null;

  return (
    <div className="announcement-stack">
      {banner && (
        <div className="announcement announcement--info">
          <span className="announcement__icon">📌</span>
          <div className="announcement__body">{banner.text}</div>
          <button type="button" className="announcement__close" aria-label="닫기" onClick={() => dismiss('banner_setting')}>×</button>
        </div>
      )}
      {items.map((a) => (
        <div key={a.id} className={`announcement announcement--${a.type || 'info'}`}>
          <span className="announcement__icon">{TYPE_LABEL[a.type] || 'ℹ️'}</span>
          <div className="announcement__body">
            <div className="announcement__title">{a.title}</div>
            <div className="announcement__text">{a.content}</div>
          </div>
          <button type="button" className="announcement__close" aria-label="닫기" onClick={() => dismiss(a.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
