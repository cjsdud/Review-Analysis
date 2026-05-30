import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import BrandTitle from './BrandTitle.jsx';

const NAV = [
  { to: '/upload', label: '리뷰 업로드', icon: '⬆️' },
  { to: '/history', label: '분석 히스토리', icon: '🗂️' },
  { to: '/pricing', label: '요금제', icon: '💳' },
  { to: '/settings', label: '매핑 템플릿', icon: '⚙️' },
];
const ADMIN_NAV = { to: '/admin', label: '관리자 콘솔', icon: '🛡️' };

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, subscription, usage, logout } = useAuth();
  const title = (() => {
    if (location.pathname.startsWith('/upload')) return '리뷰 파일 업로드';
    if (location.pathname.startsWith('/mapping')) return '컬럼 매핑 확인';
    if (location.pathname.startsWith('/dashboard')) return '분석 대시보드';
    if (location.pathname.startsWith('/products')) return '상품 상세 리포트';
    if (location.pathname.startsWith('/settings')) return '매핑 템플릿';
    if (location.pathname.startsWith('/admin')) return '관리자 콘솔';
    return 'ReviewFit';
  })();

  // 사이드바 하단 흐름 표시용 단계
  const flowStep = location.pathname.startsWith('/mapping')
    ? 2
    : location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/products')
      ? 3
      : 1;
  const showFlow = ['/upload', '/mapping', '/dashboard', '/products'].some((p) => location.pathname.startsWith(p));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <BrandTitle size="md" clickable />
          <div className="sidebar__brand-sub">패션 셀러 리뷰 리포트</div>
        </div>

        <div className="sidebar__nav-label">메뉴</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className="sidebar__link">
            <span className="ico">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        {user?.role === 'admin' && (
          <NavLink to={ADMIN_NAV.to} className="sidebar__link">
            <span className="ico">{ADMIN_NAV.icon}</span>
            {ADMIN_NAV.label}
          </NavLink>
        )}

        {showFlow && (
          <div className="sidebar__flow">
            <div className="sidebar__flow-title">진행 단계</div>
            <FlowMini step={flowStep} />
          </div>
        )}

        <div className="sidebar__footer">
          리뷰 엑셀만 올리면 상품별 불만과 상세페이지 수정안을 3분 안에.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__crumbs">
            <span>ReviewFit</span>
            <span className="sep">/</span>
            <span className="here">{title}</span>
          </div>
          <div className="topbar__right">
            <span className="tag tag--neutral">MVP</span>
            {user ? (
              <div className="topbar__user">
                {subscription?.planCode && (
                  <span className={`tag tag--${subscription.planCode === 'free' ? 'neutral' : 'success'}`} title="현재 플랜">
                    {subscription.planName || subscription.planCode}
                  </span>
                )}
                {usage && usage.monthlyAnalysisLimit != null && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    이번 달 {usage.monthlyAnalysisUsed} / {usage.monthlyAnalysisLimit}회
                  </span>
                )}
                <span className="topbar__user-name">{user.name || user.email}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={async () => { await logout(); navigate('/login'); }}
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <div className="topbar__user">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/login')}>
                  로그인
                </button>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/login', { state: { mode: 'register' } })}>
                  회원가입
                </button>
              </div>
            )}
          </div>
        </header>
        <div className="content">
          <AnnouncementBanner />
          <Outlet />
        </div>
      </div>
    </div>
  );
}

// 사이드바용 세로 단계 표시 (간단 버전)
function FlowMini({ step }) {
  const items = ['업로드', '컬럼 매핑', '분석 결과'];
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {items.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        const color = done ? '#10b981' : active ? '#2563eb' : '#94a3b8';
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color, fontWeight: active ? 700 : 600 }}>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: 10,
                color: done || active ? '#fff' : color,
                background: done ? '#10b981' : active ? '#2563eb' : 'transparent',
                border: `2px solid ${color}`,
              }}
            >
              {done ? '✓' : n}
            </span>
            {label}
          </div>
        );
      })}
    </div>
  );
}
