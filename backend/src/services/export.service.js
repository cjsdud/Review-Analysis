// 분석 결과 CSV 생성

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// 상품 × 이슈 단위로 펼친 CSV
export function buildAnalysisCsv(products) {
  const header = [
    '상품명',
    '전체리뷰수',
    '부정리뷰수',
    '평균별점',
    '카테고리',
    '세부이슈',
    '건수',
    '비율',
    '추천액션',
    '근거리뷰',
  ];
  const lines = [header.map(csvEscape).join(',')];

  for (const p of products) {
    if (!p.topIssues || p.topIssues.length === 0) {
      lines.push(
        [p.productName, p.totalReviews, p.negativeReviews, p.averageRating ?? '', '', '', '', '', '', ''].map(csvEscape).join(','),
      );
      continue;
    }
    for (const iss of p.topIssues) {
      lines.push(
        [
          p.productName,
          p.totalReviews,
          p.negativeReviews,
          p.averageRating ?? '',
          iss.category,
          iss.issueLabel,
          iss.count,
          iss.ratio,
          iss.recommendedAction,
          (iss.evidenceReviews || []).join(' | '),
        ]
          .map(csvEscape)
          .join(','),
      );
    }
  }
  // 엑셀 한글 깨짐 방지 BOM
  return '﻿' + lines.join('\n');
}
