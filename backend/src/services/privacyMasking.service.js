// 개인정보 마스킹: 전화번호, 이메일, 긴 주문번호, 주소, (옵션)작성자명

const EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
// 10자리 이상 연속 숫자(앞뒤가 숫자가 아님) = 주문번호로 간주. 전화번호보다 먼저 처리.
const ORDER_NO = /(?<!\d)\d{10,}(?!\d)/g;
// 전화번호: 숫자 경계로 한정해 긴 숫자열 내부 오탐 방지
const PHONE = /(?<!\d)(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})(?!\d)/g;
// 도로명/지번 주소 단순 패턴
const ADDRESS =
  /([가-힣]+(시|도))?\s?[가-힣]+(시|군|구)\s?[가-힣0-9]+(로|길|동|읍|면)\s?\d{0,4}(-\d{1,4})?/g;

export function maskText(input) {
  if (input == null) return input;
  let s = String(input);
  s = s.replace(EMAIL, '[이메일]');
  s = s.replace(ORDER_NO, '[주문번호]');
  s = s.replace(PHONE, '[전화번호]');
  s = s.replace(ADDRESS, '[주소]');
  return s;
}

// 작성자명: 분석에 불필요하므로 첫 글자만 남기고 마스킹
export function maskWriter(name) {
  const s = (name == null ? '' : String(name)).trim();
  if (!s) return '';
  if (s.length <= 1) return '*';
  return s[0] + '*'.repeat(Math.min(s.length - 1, 3));
}

// 정규화된 리뷰 객체 전체에 마스킹 적용
export function maskReview(review) {
  return {
    ...review,
    title: maskText(review.title),
    content: maskText(review.content),
    replyText: maskText(review.replyText),
    writer: maskWriter(review.writer),
  };
}
