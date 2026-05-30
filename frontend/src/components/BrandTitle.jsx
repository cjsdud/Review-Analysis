// 공식 워드마크(ReviewFit) 렌더링 컴포넌트.
//
// 사용:
//   <BrandTitle size="md" />                      // 일반 크기, 홈 링크 없음
//   <BrandTitle size="lg" clickable={false} />    // 큰 워드마크 (로그인/랜딩)
//   <BrandTitle size="sm" clickable />            // 사이드바/탑바용 (홈으로)
//
// 자산:
//   `frontend/src/assets/branding/reviewfit-logo.jpg`         — 풀 워드마크 (사용자 원본 JPG, 1231x294)
//   `frontend/src/assets/branding/reviewfit-logo-compact.svg` — RF 컴팩트 아이콘 (favicon)
//
// 접근성:
//   - <img alt="ReviewFit"> 로 식별 가능.
//   - clickable=true 인 경우 홈("/") 으로 이동하는 <a> 로 감싸고 aria-label 제공.
//   - 워드마크는 장식이 아니라 브랜드 식별 요소 — alt 를 비우지 않는다.
//
// 반응형:
//   - height 기준으로 크기를 잡고 width:auto (비율 유지).
//   - object-fit: contain, user-select: none, max-width 는 _brand.scss 에 정의.
//   - 래스터(JPG) 라 다운스케일 시 또렷도 보정: image-rendering: -webkit-optimize-contrast (_brand.scss).

import { Link } from 'react-router-dom';
import wordmark from '../assets/branding/reviewfit-logo.jpg';

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
      src={wordmark}
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
