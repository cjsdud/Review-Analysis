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
    if (location.pathname.startsWith('/settings')) return '설정';
    return '리뷰 인사이트';
  })();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="sidebar__brand">
          <span className="sidebar__brand-logo">R</span>
          <span>
            <div className="sidebar__brand-name">리뷰 인사이트</div>
            <div className="sidebar__brand-sub">패션 셀러 리포트</div>
          </span>
        </NavLink>

        <div className="sidebar__nav-label">메뉴</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className="sidebar__link">
            <span>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}

        <div className="sidebar__footer">
          리뷰 엑셀만 올리면
          <br />
          상품별 불만과 상세페이지
          <br />
          수정안을 3분 안에.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">{title}</div>
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
