// 상품 상태 배지 — productStatus 문자열 기반 색상 분류.
const STATUS_CLASS = {
  '만족도 높음': 'is-good',
  '좋은데 고칠 점 있음': 'is-mixed',
  '개선 우선': 'is-warn',
  '주의 필요': 'is-danger',
  '리뷰 부족': 'is-neutral',
  보통: 'is-neutral',
};

export default function ProductStatusBadge({ status }) {
  if (!status) return null;
  const cls = STATUS_CLASS[status] || 'is-neutral';
  return <span className={`status-badge ${cls}`}>{status}</span>;
}
