import { NavLink, Outlet, useLocation } from 'react-router-dom';

const NAV = [
  { to: '/upload', label: '리뷰 업로드', icon: '⬆️' },
  { to: '/settings', label: '매핑 템플릿', icon: '⚙️' },
];

export default function Layout() {
  const location = useLocation();
  const title = (() => {
    if (location.pathname.startsWith('/upload')) return '리뷰 파일 업로드';
    if (location.pathname.startsWith('/mapping')) return '컬럼 매핑 확인';
    if (location.pathname.startsWith('/dashboard')) return '분석 대시보드';
    if (location.pathname.startsWith('/products')) return '상품 상세 리포트';
    if (location.pathname.startsWith('/settings')) return '매핑 템플릿';
    return '리뷰핏';
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
        <NavLink to="/" className="sidebar__brand">
          <span className="sidebar__brand-logo">R</span>
          <span>
            <div className="sidebar__brand-name">리뷰핏</div>
            <div className="sidebar__brand-sub">패션 셀러 리뷰 리포트</div>
          </span>
        </NavLink>

        <div className="sidebar__nav-label">메뉴</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className="sidebar__link">
            <span className="ico">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}

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
            <span>리뷰핏</span>
            <span className="sep">/</span>
            <span className="here">{title}</span>
          </div>
          <div className="topbar__right">
            <span className="tag tag--neutral">MVP</span>
          </div>
        </header>
        <div className="content">
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
