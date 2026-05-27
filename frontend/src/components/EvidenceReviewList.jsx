// 근거 리뷰 목록 (AI/규칙 분석 결과의 신뢰를 위한 원문 노출)
export default function EvidenceReviewList({ reviews = [] }) {
  if (!reviews.length) return null;
  return (
    <ul className="evidence-list">
      {reviews.map((r, i) => (
        <li key={i}>{r}</li>
      ))}
    </ul>
  );
}
