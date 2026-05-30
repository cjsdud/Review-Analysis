// 공식 워드마크(ReviewFit) 렌더링 컴포넌트.
//
// 사용:
//   <BrandTitle size="md" />                      // 일반 크기, 홈 링크 없음
//   <BrandTitle size="lg" clickable={false} />    // 큰 워드마크 (로그인/랜딩)
//   <BrandTitle size="sm" clickable />            // 사이드바/탑바용 (홈으로)
//
// 자산:
//   `frontend/src/assets/branding/reviewfit-title.png`     — 풀 해상도 원본 (1142x188, 트림+패딩 적용)
//   `frontend/src/assets/branding/reviewfit-title@2x.png`  — 600x99 (retina/HiDPI 헤더용)
//   `frontend/src/assets/branding/reviewfit-title@1x.png`  — 300x49 (저해상도/사이드바용)
//
// 접근성:
//   - <img alt="ReviewFit"> 로 식별 가능.
//   - clickable=true 인 경우 홈("/") 으로 이동하는 <a> 로 감싸고 aria-label 제공.
//   - 워드마크는 장식이 아니라 브랜드 식별 요소 — alt 를 비우지 않는다.
//
// 반응형:
//   - height 기준으로 크기를 잡고 width:auto (비율 유지).
//   - object-fit: contain, user-select: none, max-width: 100% 는 _brand.scss 에 정의.
//   - 좁은 헤더에서 늘어나지 않도록 부모가 flex-shrink: 0 으로 감싸는 것을 권장.
//   - srcset 으로 HiDPI 디스플레이에서 또렷하게.

import { Link } from 'react-router-dom';
import wordmark from '../assets/branding/reviewfit-title.png';
import wordmark1x from '../assets/branding/reviewfit-title@1x.png';
import wordmark2x from '../assets/branding/reviewfit-title@2x.png';

const SIZE_CLASS = {
  sm: 'brand-title--sm',
  md: 'brand-title--md',
  lg: 'brand-title--lg',
};

export default function BrandTitle({
  size = 'md',
  clickable = false,
  className = '',
  showTextFallback = false,
}) {
  const sizeCls = SIZE_CLASS[size] || SIZE_CLASS.md;
  const cls = `brand-title ${sizeCls}${className ? ` ${className}` : ''}`;

  const img = (
    <img
      src={wordmark1x}
      srcSet={`${wordmark1x} 1x, ${wordmark2x} 2x, ${wordmark} 4x`}
      alt="ReviewFit"
      className="brand-title__img"
      draggable="false"
    />
  );

  const inner = (
    <>
      {img}
      {showTextFallback && (
        <span className="brand-title__text-fallback" aria-hidden="true">ReviewFit</span>
      )}
    </>
  );

  if (clickable) {
    return (
      <Link to="/" className={cls} aria-label="ReviewFit 홈으로 이동">
        {inner}
      </Link>
    );
  }
  return <span className={cls}>{inner}</span>;
}
