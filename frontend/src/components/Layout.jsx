import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import BrandTitle from './BrandTitle.jsx';

const NAV = [
  { to: '/history', label: '분석 히스토리', icon: '🗂️' },
  { to: '/upload', label: '리뷰 업로드', icon: '⬆️' },
  { to: '/pricing', label: '요금제', icon: '💳' },
  { to: '/settings', label: '매핑 템플릿', icon: '⚙️' },
];
const ADMIN_NAV = { to: '/admin', label: '관리자 콘솔', icon: '🛡️' };

// 포커스 가능한 요소 selector. focus trap 에서 Tab 순환 대상 결정용.
// summary/contenteditable/role=button/menuitem 같은 복합 인터랙티브도 포함.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="menuitem"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// 실제로 보이고 포커스 가능한 요소만 필터링.
function getVisibleFocusable(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // position:fixed 내부 요소는 offsetParent 가 null 일 수 있어 rect 로 확인
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, subscription, usage, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const drawerRef = useRef(null);
  const hamburgerRef = useRef(null);

  const title = (() => {
    if (location.pathname.startsWith('/upload')) return '리뷰 파일 업로드';
    if (location.pathname.startsWith('/mapping')) return '컬럼 매핑 확인';
    if (location.pathname.startsWith('/dashboard')) return '분석 대시보드';
    if (location.pathname.startsWith('/products')) return '상품 상세 리포트';
    if (location.pathname.startsWith('/history')) return '분석 히스토리';
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

  // 라우트 변경 시 모바일 drawer / 계정 메뉴 자동 닫기
  useEffect(() => {
    setDrawerOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  // drawer 열렸을 때:
  //   1) body scroll lock
  //   2) ESC 로 닫기
  //   3) focus trap — Tab/Shift+Tab 이 drawer 내부에서만 순환
  //   4) drawer 열릴 때 내부 첫 번째 focusable 로 포커스 이동
  //   5) drawer 닫힐 때 햄버거 버튼으로 포커스 복귀
  useEffect(() => {
    if (!drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    const prevActive = document.activeElement;
    document.body.style.overflow = 'hidden';

    // 첫 focusable 로 이동 (close 버튼 또는 첫 메뉴)
    const focusFirst = () => {
      const items = getVisibleFocusable(drawerRef.current);
      if (items.length > 0) items[0].focus();
    };
    // transform transition 끝나기 전에 포커스 옮기면 어색하므로 다음 tick.
    const t = setTimeout(focusFirst, 0);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const root = drawerRef.current;
      if (!root) return;
      const items = getVisibleFocusable(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      // 닫힐 때 햄버거 버튼으로 포커스 복귀 (없으면 이전 activeElement).
      const target = hamburgerRef.current || (prevActive instanceof HTMLElement ? prevActive : null);
      if (target && typeof target.focus === 'function') target.focus();
    };
  }, [drawerOpen]);

  function NavItems({ onClick }) {
    return (
      <>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className="sidebar__link" onClick={onClick}>
            <span className="ico" aria-hidden="true">{n.icon}</span>
            <span className="sidebar__link-label">{n.label}</span>
          </NavLink>
        ))}
        {user?.role === 'admin' && (
          <NavLink to={ADMIN_NAV.to} className="sidebar__link" onClick={onClick}>
            <span className="ico" aria-hidden="true">{ADMIN_NAV.icon}</span>
            <span className="sidebar__link-label">{ADMIN_NAV.label}</span>
          </NavLink>
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      {/* 데스크톱 사이드바 — 모바일에서는 _layout.scss 가 display:none 처리 */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <BrandTitle size="md" clickable />
          <div className="sidebar__brand-sub">패션 셀러 리뷰 리포트</div>
        </div>

        <div className="sidebar__nav-label">메뉴</div>
        <NavItems />

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

      {/* 모바일 drawer — display:flex (max-width: bp-tablet) 일 때만 동작 */}
      <div
        className={`mobile-backdrop${drawerOpen ? ' is-open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
      />
      <aside
        ref={drawerRef}
        id="mobile-navigation-drawer"
        className={`mobile-drawer${drawerOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="모바일 메뉴"
        aria-hidden={!drawerOpen}
      >
        <div className="mobile-drawer__head">
          <BrandTitle size="sm" />
          <button
            type="button"
            className="mobile-drawer__close"
            onClick={() => setDrawerOpen(false)}
            aria-label="메뉴 닫기"
          >
            ✕
          </button>
        </div>
        <nav className="mobile-drawer__nav">
          <NavItems onClick={() => setDrawerOpen(false)} />
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          {/* 모바일 햄버거 */}
          <button
            ref={hamburgerRef}
            type="button"
            className="topbar__hamburger"
            aria-label="메뉴 열기"
            aria-expanded={drawerOpen}
            aria-controls="mobile-navigation-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <div className="topbar__crumbs">
            <span className="topbar__crumbs-root">ReviewFit</span>
            <span className="sep">/</span>
            <span className="here">{title}</span>
          </div>

          <div className="topbar__right">
            {user ? (
              <UserMenu
                user={user}
                subscription={subscription}
                usage={usage}
                open={accountOpen}
                onToggle={() => setAccountOpen((v) => !v)}
                onClose={() => setAccountOpen(false)}
                onLogout={async () => { await logout(); navigate('/login'); }}
                onAdminConsole={() => navigate('/admin')}
              />
            ) : (
              <div className="topbar__auth">
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

// 계정 메뉴 — 모바일에서는 ADMIN/Free/사용량/로그아웃을 헤더에 펼치지 않고
// 이 메뉴 안에 접어 한 줄을 유지. 데스크톱에서도 동일 구조로 통일.
function UserMenu({ user, subscription, usage, open, onToggle, onClose, onLogout, onAdminConsole }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const name = displayName(user);

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu__trigger"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="계정 메뉴"
      >
        <span className="user-menu__avatar" aria-hidden="true">{(name || '?').slice(0, 1).toUpperCase()}</span>
        <span className="user-menu__name">{name}</span>
        {user.role === 'admin' && (
          <span className="tag tag--admin user-menu__admin-chip" title="관리자 계정">ADMIN</span>
        )}
        <span className="user-menu__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="user-menu__pop" role="menu">
          <div className="user-menu__row user-menu__row--head">
            <div className="user-menu__head-name">{name}</div>
            <div className="user-menu__head-email muted">{user.email}</div>
          </div>
          {(subscription?.planCode || (usage && usage.monthlyAnalysisLimit != null)) && (
            <div className="user-menu__row">
              {subscription?.planCode && (
                <span className={`tag tag--${subscription.planCode === 'free' ? 'neutral' : 'success'}`}>
                  {subscription.planName || subscription.planCode}
                </span>
              )}
              {usage && usage.monthlyAnalysisLimit != null && (
                <span className="muted user-menu__usage">
                  이번 달 {usage.monthlyAnalysisUsed} / {usage.monthlyAnalysisLimit}회
                </span>
              )}
            </div>
          )}
          {user.role === 'admin' && (
            <button type="button" className="user-menu__item" role="menuitem" onClick={onAdminConsole}>
              🛡️ 관리자 콘솔
            </button>
          )}
          <button type="button" className="user-menu__item user-menu__item--danger" role="menuitem" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

// 상단 표시명 정리 — seed 계정의 내부 명칭("Seed Admin"/"Seed Beta Tester") 은
// 일반 사용자에게 자연스러운 라벨로 바꾸고, 그 외에는 user.name → email 앞부분 순.
function displayName(user) {
  if (!user) return '';
  const name = (user.name || '').trim();
  if (name === 'Seed Admin') return '관리자';
  if (name === 'Seed Beta Tester') return '베타 테스터';
  if (name) return name;
  const email = user.email || '';
  const local = email.split('@')[0];
  return local || email;
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
