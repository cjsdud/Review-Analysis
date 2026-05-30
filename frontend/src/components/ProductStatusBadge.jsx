// 상품 상태 배지 — productStatus 문자열 기반 색상 분류.
// 의미별 톤:
//   - 만족도 높음 → positive (안정적 색감)
//   - 좋은데 고칠 점 있음 → opportunity (정보성 톤, 빨강 X)
//   - 개선 우선 → warning
//   - 주의 필요 → danger (강한 강조)
//   - 리뷰 부족 / 보통 → neutral
// 의미 class(`status-badge--*`) + 기존 색 class(`is-*`) 를 함께 부여해
// 새 디자인 시멘틱과 기존 색 토큰을 모두 유지한다.
const STATUS_CLASS = {
  '만족도 높음': 'status-badge--positive is-good',
  '좋은데 고칠 점 있음': 'status-badge--opportunity is-mixed',
  '개선 우선': 'status-badge--warning is-warn',
  '주의 필요': 'status-badge--danger is-danger',
  '리뷰 부족': 'status-badge--neutral is-neutral',
  보통: 'status-badge--neutral is-neutral',
};

export default function ProductStatusBadge({ status }) {
  if (!status) return null;
  const cls = STATUS_CLASS[status] || 'status-badge--neutral is-neutral';
  return <span className={`status-badge ${cls}`}>{status}</span>;
}

