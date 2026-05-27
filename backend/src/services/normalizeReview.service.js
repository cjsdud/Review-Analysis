import { nanoid } from 'nanoid';
import { safeStr } from '../utils/textUtils.js';
import { parseDate } from '../utils/dateUtils.js';
import { maskReview } from './privacyMasking.service.js';

function toRating(v) {
  if (v === '' || v == null) return undefined;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  if (Number.isNaN(n)) return undefined;
  if (n < 0 || n > 5) return undefined;
  return n;
}

// 파싱된 rows를 확정 매핑에 따라 공통 스키마로 정규화한다.
// 입력: rows(object[]), mapping({field: columnName}), opts({source, storeId, uploadId})
// 출력: ReviewNormalized[] (content 비어있으면 제외, 마스킹 적용)
export function normalizeReviews(rows, mapping, { source = 'custom', storeId, uploadId } = {}) {
  const out = [];
  for (const row of rows) {
    const get = (field) => (mapping[field] ? row[mapping[field]] : undefined);

    const content = safeStr(get('content'));
    if (!content) continue; // content 비어있으면 제외

    const review = {
      id: nanoid(),
      uploadId,
      source,
      storeId,
      productName: safeStr(get('productName')) || '미지정 상품',
      optionName: safeStr(get('optionName')) || undefined,
      rating: toRating(get('rating')),
      title: safeStr(get('title')) || undefined,
      content,
      writer: safeStr(get('writer')) || undefined,
      createdAt: parseDate(get('createdAt')),
      replyText: safeStr(get('replyText')) || undefined,
      reviewId: safeStr(get('reviewId')) || undefined,
      raw: undefined,
    };

    out.push(maskReview(review));
  }
  return out;
}
