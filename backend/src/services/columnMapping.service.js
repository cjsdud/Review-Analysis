import { normalizeKey, isLongText } from '../utils/textUtils.js';
import { looksLikeDate } from '../utils/dateUtils.js';

// 필드별 컬럼명 후보
export const FIELD_CANDIDATES = {
  productName: ['상품명', '제품명', 'product_name', 'product', 'item_name', '상품', '상품명/옵션'],
  optionName: ['옵션', '옵션명', '옵션정보', 'option', 'variant', '선택옵션', '구매옵션'],
  rating: ['평점', '별점', 'rating', 'score', '리뷰평점', '만족도'],
  title: ['제목', 'title', '리뷰제목', '후기제목'],
  content: ['리뷰내용', '리뷰', '후기', '내용', 'comment', 'review', 'body', '상품평', '구매후기'],
  createdAt: ['작성일', '등록일', '리뷰작성일', 'created_at', 'date', '작성일자'],
  replyText: ['답글', '댓글', '판매자답글', 'reply', 'response', '답변', '관리자답변'],
  reviewId: ['리뷰번호', '후기번호', 'review_id', 'id', '게시글번호', 'article_no'],
  writer: ['작성자', '아이디', '닉네임', 'writer', 'user', '구매자'],
};

export const FIELDS = Object.keys(FIELD_CANDIDATES);

// 컬럼 헤더와 후보 간 이름 점수
function nameScore(header, candidate) {
  const h = normalizeKey(header);
  const c = normalizeKey(candidate);
  if (!h || !c) return 0;
  if (header.trim() === candidate.trim()) return 100; // 정확 일치
  if (h === c) return 90; // 공백/기호 제거 후 일치
  if (h.includes(c) || c.includes(h)) return 70; // 포함 관계
  return 0;
}

// 데이터 패턴 가산점
function dataBonus(field, values) {
  const samples = values.filter((v) => v !== '' && v != null).slice(0, 30);
  if (samples.length === 0) return 0;

  if (field === 'rating') {
    const nums = samples
      .map((v) => Number(String(v).replace(/[^\d.]/g, '')))
      .filter((n) => !Number.isNaN(n));
    if (nums.length && nums.every((n) => n >= 1 && n <= 5)) return 20;
  }
  if (field === 'createdAt') {
    const ok = samples.filter((v) => looksLikeDate(v)).length;
    if (ok / samples.length >= 0.5) return 20;
  }
  if (field === 'content') {
    const longCount = samples.filter((v) => isLongText(v)).length;
    if (longCount / samples.length >= 0.4) return 20;
  }
  return 0;
}

// 헤더 목록 + 샘플 행으로 필드별 최적 컬럼 후보를 점수화해 산출한다.
// 입력: headers(string[]), rows(object[] — 마스킹된 행이어도 무방)
// 출력: { field: { column: string|null, score: number } } (이름 점수 + 데이터 패턴 가산점)
export function autoMapColumns(headers, rows) {
  const columnValues = {};
  for (const h of headers) columnValues[h] = rows.map((r) => r[h]);

  const result = {};
  const usedHeaders = new Set();

  // 각 필드에 대해 모든 헤더 점수 계산
  const scored = {};
  for (const field of FIELDS) {
    scored[field] = headers.map((header) => {
      const best = Math.max(0, ...FIELD_CANDIDATES[field].map((c) => nameScore(header, c)));
      const bonus = best > 0 ? dataBonus(field, columnValues[header]) : 0;
      return { header, score: best + bonus };
    });
  }

  // content > productName > 나머지 순으로 우선 배정 (충돌 방지)
  const priority = ['content', 'productName', 'rating', 'createdAt', 'optionName', 'title', 'replyText', 'reviewId', 'writer'];
  for (const field of priority) {
    const candidates = scored[field]
      .filter((c) => c.score > 0 && !usedHeaders.has(c.header))
      .sort((a, b) => b.score - a.score);
    const top = candidates[0];
    if (top && top.score >= 60) {
      result[field] = { column: top.header, score: top.score };
      usedHeaders.add(top.header);
    } else {
      result[field] = { column: null, score: top ? top.score : 0 };
    }
  }

  return result; // { field: { column, score } }
}

// 매핑 객체 검증: content는 필수
export function isMappingValid(mapping) {
  return Boolean(mapping && mapping.content);
}
