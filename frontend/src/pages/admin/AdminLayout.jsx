import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/admin', label: '대시보드', end: true },
  { to: '/admin/users', label: '사용자 관리' },
  { to: '/admin/reports', label: '리포트 추이' },
  { to: '/admin/settings', label: '운영 설정' },
  { to: '/admin/announcements', label: '공지/배너' },
  { to: '/admin/action-logs', label: '액션 로그' },
];

export default function AdminLayout() {
  return (
    <div className="admin-shell">
      <header className="admin-shell__header">
        <div className="admin-shell__title">관리자 콘솔</div>
        <div className="admin-shell__sub muted">운영 책임자 전용 — 모든 변경은 액션 로그에 기록됩니다.</div>
        <nav className="admin-tabs" role="tablist">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => `admin-tab${isActive ? ' is-active' : ''}`}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="admin-shell__body">
        <Outlet />
      </div>
    </div>
  );
}
