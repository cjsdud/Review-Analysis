// 모바일에서만 접고/펼치는 accordion. desktop 에서는 항상 펼쳐진 형태.
//
// 사용:
//   <Disclosure title="반복 이슈" meta="5건" defaultOpen>
//     ...본문...
//   </Disclosure>
//
// 구현 메모:
//   - <details> 기반 — JS state 없이 브라우저 native disclosure 동작.
//   - desktop 표시는 _mobile-primitives.scss .disc 의 media query 가 처리한다.
//   - desktop 에서는 항상 펼쳐 보이게 하기 위해 부모 CSS 로 chevron 을 숨기고
//     summary 를 비활성 cursor 처리. defaultOpen=false 여도 desktop 에선
//     본문이 보이도록 force open: <details> 가 mobile 에서만 닫히게 props 로 제어 안 하고,
//     CSS 가 desktop 에서 summary 의 toggle 가시성을 무력화하는 대신,
//     details[open] state 자체는 닫혀 있어도 본문을 항상 보이게 CSS 로 처리.
//     → 보다 안전한 접근: desktop 에선 details 가 항상 open 이 되도록 useEffect 로 강제.
//       (정말 가벼운 작업이라 무관함.)

import { useEffect, useRef } from 'react';

export default function Disclosure({
  title,
  meta,
  defaultOpen = false,
  children,
  className = '',
}) {
  const ref = useRef(null);

  // desktop 에서는 항상 펼친 상태로 표시되도록 보장.
  // (브라우저 native <details> 는 open prop 으로만 제어되므로, 768px 이상에서는 강제 open.)
  // mobile 에서는 사용자 토글을 그대로 따른다.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mql = window.matchMedia('(min-width: 769px)');
    function sync() {
      if (mql.matches) el.open = true;
    }
    sync();
    mql.addEventListener?.('change', sync);
    return () => mql.removeEventListener?.('change', sync);
  }, []);

  return (
    <details
      ref={ref}
      className={`disc${className ? ` ${className}` : ''}`}
      open={defaultOpen || undefined}
    >
      <summary className="disc__head">
        <svg className="disc__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <span className="disc__title">{title}</span>
        {meta != null && <span className="disc__meta">{meta}</span>}
      </summary>
      <div className="disc__body">{children}</div>
    </details>
  );
}
