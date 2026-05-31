import { useCallback, useEffect, useRef, useState } from 'react';

// 리포트 내부 섹션 네비게이션. sticky 가로 chip nav.
//
// active 감지 방식: scrollY + offset 기준선.
//   IntersectionObserver 는 섹션 높이가 크게 다르거나 sticky 헤더가
//   여러 개일 때 callback 순서/threshold 만으로 안정적인 active 가
//   잘 안 잡혀 "C 를 보고 있는데 B 가 active" 같은 버그가 발생.
//   대신 "기준선(viewport top + offset)을 막 지나간 마지막 섹션" 을
//   active 로 잡으면 단순하고 안정적이다.
//
// props
//   sections: [{ id, label }]
//   offset?: number      — 기준선 (헤더 + nav 높이). 기본 140.
//   stickyMode?: 'always' | 'desktop' | 'none'  — 기본 'always'.
//   enableKeyboard?: boolean  — j/k/화살표로 섹션 이동 (입력 focus / 모달 열림에선 무시).
//   className?: string
export default function SectionNavigator({
  sections = [],
  offset = 140,
  stickyMode = 'always',
  enableKeyboard = false,
  className = '',
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id || '');
  const listRef = useRef(null);
  // rAF throttle 용
  const rafRef = useRef(0);

  const ids = sections.map((s) => s.id).join('|');

  // scroll/resize 기반 active 계산
  const recompute = useCallback(() => {
    if (typeof window === 'undefined') return;
    const baseY = window.scrollY + offset;
    let next = sections[0]?.id || '';
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top + window.scrollY;
      if (top <= baseY) next = s.id;
      else break;
    }
    setActiveId((prev) => (prev === next ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, offset]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onScroll() {
      if (rafRef.current) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = 0;
        recompute();
      });
    }
    recompute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [recompute]);

  // 활성 칩이 가로 스크롤 컨테이너 밖이면 자동으로 보이게 스크롤
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeId) return;
    const el = list.querySelector(`[data-section-id="${activeId}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeId]);

  // 키보드 단축키 — j/k 또는 화살표. 입력 / 모달 열림 시 무시.
  useEffect(() => {
    if (!enableKeyboard) return undefined;
    function shouldIgnore(e) {
      const t = e.target;
      const tag = t?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (t?.isContentEditable) return true;
      if (document.body.classList.contains('modal-open')) return true;
      return false;
    }
    function onKey(e) {
      if (shouldIgnore(e)) return;
      const idx = sections.findIndex((s) => s.id === activeId);
      const total = sections.length;
      if (total === 0) return;
      let target = null;
      if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        target = sections[Math.min(total - 1, idx + 1)];
      } else if (e.key === 'k' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        target = sections[Math.max(0, idx - 1)];
      }
      if (target) {
        e.preventDefault();
        scrollTo(target.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableKeyboard, ids, activeId]);

  function scrollTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // smooth scroll 중간에 recompute 가 늦으면 active 가 잠시 어긋날 수 있어 명시적으로 미리 설정
    setActiveId(id);
  }

  const visibleSections = sections.filter((s) =>
    typeof document !== 'undefined' && document.getElementById(s.id),
  );
  if (visibleSections.length <= 1) return null;

  const stickyClass =
    stickyMode === 'always'
      ? ' section-navigator--sticky'
      : stickyMode === 'desktop'
        ? ' section-navigator--sticky-desktop'
        : '';

  return (
    <nav className={`section-navigator${stickyClass} ${className}`.trim()} aria-label="리포트 섹션">
      <ul ref={listRef} className="section-navigator__list">
        {sections.map((s) => {
          const isActive = s.id === activeId;
          return (
            <li key={s.id} className="section-navigator__item">
              <button
                type="button"
                data-section-id={s.id}
                className={`section-navigator__chip${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => scrollTo(s.id)}
              >
                {s.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
