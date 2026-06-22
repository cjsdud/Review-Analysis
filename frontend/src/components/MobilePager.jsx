// 이전/다음 페이저. desktop 은 inline, mobile 은 sticky 하단 바.
// 스타일은 _mobile-primitives.scss 의 .m-pager 가 담당.
//
// 사용:
//   <MobilePager
//     index={0}                   // 0-based
//     total={products.length}
//     onPrev={() => setIdx(i - 1)}
//     onNext={() => setIdx(i + 1)}
//     prevLabel="이전 상품"        // default: "이전"
//     nextLabel="다음 상품"        // default: "다음"
//   />

export default function MobilePager({
  index,
  total,
  onPrev,
  onNext,
  prevLabel = '이전',
  nextLabel = '다음',
}) {
  if (!total || total <= 1) return null;
  const safeIndex = Math.max(0, Math.min(index || 0, total - 1));
  return (
    <div className="m-pager" role="navigation" aria-label="페이지 이동">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onPrev}
        disabled={safeIndex <= 0}
        aria-label={prevLabel}
      >
        ← {prevLabel}
      </button>
      <span className="m-pager__count" aria-live="polite">
        {safeIndex + 1} / {total}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onNext}
        disabled={safeIndex >= total - 1}
        aria-label={nextLabel}
      >
        {nextLabel} →
      </button>
    </div>
  );
}
