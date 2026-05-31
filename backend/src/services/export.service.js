// 분석 결과 CSV 생성.
// 화면 일부가 아니라 product 데이터 전체(요약 + 모든 이슈 + 마스킹 리뷰 + CS 답글)를 flatten 한다.
// 모든 row 는 section 컬럼으로 종류를 구분해 같은 CSV 안에서 함께 다운로드.

function csvEscape(v) {
  if (v == null) return '';
  let s = String(v).replace(/\r?\n/g, ' ').trim();
  // CSV injection 방지: =, +, -, @ 로 시작하는 값에 prefix 처리
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// 컬럼:
//   section, productName, optionName, reviewId, rating, sentiment,
//   issueCategory, issueLabel, severity, count, ratio, reviewText, evidence,
//   recommendedAction, replyTone, replyText, createdAt
const HEADER = [
  'section', 'productName', 'optionName', 'reviewId', 'rating', 'sentiment',
  'issueCategory', 'issueLabel', 'severity', 'count', 'ratio', 'reviewText',
  'evidence', 'recommendedAction', 'replyTone', 'replyText', 'createdAt',
];

function emptyRow() {
  return Object.fromEntries(HEADER.map((k) => [k, '']));
}
function row(section, fields) {
  return { ...emptyRow(), section, ...fields };
}
function serialize(rows) {
  const lines = [HEADER.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(HEADER.map((k) => csvEscape(r[k])).join(','));
  }
  // 엑셀 한글 깨짐 방지 BOM
  return '﻿' + lines.join('\n');
}

export function buildAnalysisCsv(products) {
  const rows = [];
  for (const p of products) {
    // 1) 상품 요약
    rows.push(row('product_summary', {
      productName: p.productName,
      rating: p.averageRating ?? '',
      count: p.totalReviews ?? '',
      ratio: p.negativeRatio ?? '',
      sentiment: `긍정 ${p.sentimentCounts?.positive ?? 0} / 중립 ${p.sentimentCounts?.neutral ?? 0} / 부정 ${p.sentimentCounts?.negative ?? 0}`,
      recommendedAction: p.productInsight || p.summary || '',
    }));

    // 2) 모든 이슈 (topIssues 5개 제한 X — allIssues 우선, 없으면 topIssues fallback)
    const issues = p.allIssues && p.allIssues.length > 0 ? p.allIssues : (p.topIssues || []);
    for (const iss of issues) {
      rows.push(row('issue', {
        productName: p.productName,
        issueCategory: iss.category || '',
        issueLabel: iss.issueLabel || '',
        severity: iss.severity || '',
        count: iss.count ?? '',
        ratio: iss.ratio ?? '',
        recommendedAction: iss.recommendedAction || '',
        evidence: (iss.evidenceReviews || []).map((e) => (typeof e === 'string' ? e : e?.content || '')).join(' | '),
      }));
    }

    // 3) 마스킹 리뷰 전체
    for (const r of (p.reviews || [])) {
      rows.push(row('review', {
        productName: r.productName || p.productName,
        optionName: r.optionName || '',
        reviewId: r.id || '',
        rating: r.rating ?? '',
        sentiment: r.sentiment || '',
        reviewText: r.content || r.text || '',
        issueCategory: (r.detectedIssues || []).map((d) => d.category).filter(Boolean).join(' | '),
        issueLabel: (r.detectedIssues || []).map((d) => d.issue || d.issueLabel).filter(Boolean).join(' | '),
        createdAt: r.createdAt || '',
      }));
    }

    // 4) CS 답글 초안 (variants 별로 한 줄씩)
    for (const rt of (p.replyTemplates || [])) {
      const variants = Array.isArray(rt.variants) ? rt.variants : [];
      for (const v of variants) {
        rows.push(row('cs_reply', {
          productName: p.productName,
          issueLabel: rt.issueLabel || '',
          replyTone: v.tone || v.label || '',
          replyText: v.template || v.text || '',
        }));
      }
    }

    // 5) 상세페이지 수정 체크리스트
    for (const a of (p.detailPageActions || [])) {
      rows.push(row('detail_action', {
        productName: p.productName,
        recommendedAction: typeof a === 'string' ? a : (a?.action || a?.text || ''),
      }));
    }
  }
  return serialize(rows);
}
