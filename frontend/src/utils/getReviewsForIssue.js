// 차트 클릭 / IssueCard 클릭 / 샘플 페이지 등 여러 진입점에서
// "이 이슈와 관련된 리뷰" 를 골라낼 때 공통으로 쓰는 유틸.
//
// 정책:
//   1) reviewIds 가 명시되어 있으면 그 id 들만 반환 (가장 정확)
//   2) issueLabel 이 있으면 detectedIssues 의 label 매칭 (정규화 비교)
//   3) category 가 있으면 detectedIssues 의 category 매칭 (정규화 비교)
//   4) 위 중 어느 것도 없으면 [] 반환
//
// 비교는 keep-all 한국어를 고려해 "trim + 공백 모두 제거 + lower-case" 수준만.
// 너무 느슨한 substring 매칭은 다른 이슈가 섞일 수 있어 피한다.

import { normalizeIssueCategory } from './issueFilters.js';

export function normalizeIssueName(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, '').toLowerCase();
}

// 차트 item / IssueCard / 사용자 입력 등 다양한 형태에서 "이슈 이름" 추출.
// 우선순위: issueLabel > issue > label > name > category.
export function getIssueNameFromChartItem(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return (
    item.issueLabel ||
    item.issue ||
    item.label ||
    item.name ||
    item.category ||
    ''
  );
}

// 리뷰 본문 텍스트를 다양한 필드명에서 안전하게 추출.
export function getReviewText(review) {
  if (!review) return '';
  return (
    review.content ||
    review.reviewText ||
    review.text ||
    review.comment ||
    review.body ||
    ''
  );
}

// 리뷰에 붙어있는 이슈 이름 목록 (detectedIssues / issues / categories / 단일 필드).
export function getReviewIssueNames(review) {
  if (!review) return [];
  const out = [];
  const detected = review.detectedIssues || review.issues || review.categories || [];
  if (Array.isArray(detected)) {
    for (const d of detected) {
      if (!d) continue;
      if (typeof d === 'string') out.push(d);
      else {
        if (d.issueLabel) out.push(d.issueLabel);
        if (d.issue) out.push(d.issue);
        if (d.category) out.push(d.category);
        if (d.label) out.push(d.label);
      }
    }
  }
  if (review.issueLabel) out.push(review.issueLabel);
  if (review.issue) out.push(review.issue);
  if (review.issueCategory) out.push(review.issueCategory);
  if (review.category) out.push(review.category);
  return out;
}

function reviewId(r) {
  return r?.id || r?.reviewId || r?._id || null;
}

// 메인: 이슈 또는 차트 item 으로 필터된 리뷰 배열을 반환.
export function getReviewsForIssue(reviews = [], issueOrChartItem = null) {
  if (!Array.isArray(reviews) || reviews.length === 0) return [];
  if (!issueOrChartItem) return [];

  // 문자열 입력은 issueLabel 로 간주 (fallback: category)
  const item =
    typeof issueOrChartItem === 'string'
      ? { issueLabel: issueOrChartItem }
      : issueOrChartItem;

  // 1) reviewIds 우선 — 가장 정확하고 빠르다
  const ids = Array.isArray(item.reviewIds) ? item.reviewIds : null;
  if (ids && ids.length > 0) {
    const set = new Set(ids.map(String));
    return reviews.filter((r) => set.has(String(reviewId(r))));
  }

  const labelKey = normalizeIssueName(item.issueLabel || item.issue || item.label);
  const rawCategory = item.category || item.issueCategory || '';
  // category 는 normalizeIssueCategory (사이즈/핏 → 사이즈 등) 거친 뒤 비교
  const catKey = rawCategory
    ? normalizeIssueName(normalizeIssueCategory(rawCategory))
    : '';

  if (!labelKey && !catKey) return [];

  return reviews.filter((r) => {
    const names = getReviewIssueNames(r);
    if (names.length === 0) return false;
    return names.some((n) => {
      const nKey = normalizeIssueName(n);
      // 정확 일치 (label 또는 category 정규화 후)
      if (labelKey && nKey === labelKey) return true;
      if (!labelKey && catKey) {
        const cKey = normalizeIssueName(normalizeIssueCategory(n));
        if (cKey === catKey) return true;
      }
      return false;
    });
  });
}
