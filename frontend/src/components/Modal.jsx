import { useEffect, useId, useRef } from 'react';

// 공용 모달.
// - ESC 또는 backdrop 클릭으로 닫힘
// - body scroll lock 적용 (open 동안)
// - 접근성: role="dialog", aria-modal, aria-labelledby
// - 모바일에서는 거의 전체 화면 (CSS 측에서 처리)
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md', // 'sm' | 'md' | 'lg'
  footer,
}) {
  const labelId = useId();
  const descId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    // 모달이 열리면 첫 포커스 가능한 요소로 포커스 이동
    setTimeout(() => {
      const el = dialogRef.current?.querySelector('[data-modal-close]');
      el?.focus();
    }, 0);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelId : undefined}
        aria-describedby={description ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div className="modal__head-text">
            {title && <h2 id={labelId} className="modal__title">{title}</h2>}
            {description && <div id={descId} className="modal__desc">{description}</div>}
          </div>
          <button
            type="button"
            className="modal__close"
            aria-label="닫기"
            data-modal-close
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
