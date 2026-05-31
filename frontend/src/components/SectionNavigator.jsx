import { useEffect, useRef, useState } from 'react';

// 리포트 내부 섹션 네비게이션. 칩 형태의 sticky 가로 nav.
// - 각 칩 클릭 시 해당 섹션으로 smooth scroll (scroll-margin-top 은 .report-section CSS 에서)
// - IntersectionObserver 로 현재 보이는 섹션을 active 표시
// - sections 의 id 가 페이지에 실제로 존재하지 않으면 무시 (안전망)
//
// props
//   sections: [{ id, label }]  — 표시 순서와 라벨
//   className?: string         — 외부 wrapper 보조
export default function SectionNavigator({ sections = [], className = '' }) {
  const [activeId, setActiveId] = useState(sections[0]?.id || '');
  const listRef = useRef(null);

  // 실제로 DOM 에 존재하는 섹션만 추리고, 없으면 nav 자체를 숨김.
  const visibleSections = sections.filter((s) => typeof document !== 'undefined' && document.getElementById(s.id));

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return undefined;
    if (sections.length === 0) return undefined;

    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter(Boolean);
    if (targets.length === 0) return undefined;

    // 화면 상단(헤더 + nav 높이만큼 띄움) 부근에 들어오는 섹션을 active 로.
    // rootMargin top 음수 값 = "이 섹션이 헤더 아래로 들어오는 순간".
    const observer = new IntersectionObserver(
      (entries) => {
        // 화면에 보이는 entry 중 가장 위(=top 이 작은)에 있는 섹션을 active 로.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-120px 0px -55% 0px', threshold: [0, 0.2, 0.5] },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.map((s) => s.id).join('|')]);

  // 활성 칩이 가로 스크롤 컨테이너 밖이면 자동으로 보이게 스크롤.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeId) return;
    const el = list.querySelector(`[data-section-id="${activeId}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeId]);

  if (visibleSections.length <= 1) return null;

  function handleClick(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  }

  return (
    <nav className={`section-navigator ${className}`.trim()} aria-label="리포트 섹션">
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
                onClick={() => handleClick(s.id)}
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
