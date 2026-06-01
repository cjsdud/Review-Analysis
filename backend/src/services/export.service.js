// 분석 결과 CSV 생성.
// 화면 일부가 아니라 product 데이터 전체(요약 + 모든 이슈 + 마스킹 리뷰 + CS 답글)를 flatten 한다.
// 모든 row 는 section 컬럼으로 종류를 구분해 같은 CSV 안에서 함께 다운로드.

import xlsx from 'xlsx';

// ── 사용자 친화 라벨 변환 ──
const SENTIMENT_LABEL = { positive: '긍정', neutral: '중립', negative: '부정', mixed: '복합 반응' };
const SEVERITY_LABEL = { low: '낮음', medium: '중간', high: '높음' };
function sentimentLabel(v) { return SENTIMENT_LABEL[v] || '미분류'; }
function severityLabel(v) { return SEVERITY_LABEL[v] || '중간'; }
function pctLabel(r) { return r == null ? '' : `${Math.round(Number(r) * 100)}%`; }
function evidenceText(arr) {
  return (arr || []).map((e) => (typeof e === 'string' ? e : e?.content || '')).filter(Boolean).join(' | ');
}

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

// ── XLSX 다중 시트 리포트 ──
// 셀러가 바로 업무에 쓸 수 있도록 한글 컬럼명 + 시트 분리.
// 시트: 리포트 요약 / 상품별 요약 / 반복 이슈 / 리뷰 데이터 / CS 답글 초안
//
// 입력:
//   products: ProductAnalysis[]
//   summary:  전체 요약 (analysis_jobs.summary). 없으면 products 로부터 일부 계산.
//   meta:     { analysisDate?, productName? } — productName 이 있으면 단일 상품 리포트.
function aoaSheet(rows) {
  return xlsx.utils.aoa_to_sheet(rows);
}
function setColWidths(ws, widths) {
  ws['!cols'] = widths.map((w) => ({ wch: w }));
}
function freezeHeader(ws) {
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  // xlsx 0.18 은 표준 freeze 미지원이라 무시될 수 있음 — 있으면 활용.
}

function buildSummarySheet(products, summary, meta) {
  const s = summary || {};
  const sc = s.sentimentCounts || {};
  const topCat = (s.categoryDistribution || []).slice().sort((a, b) => b.count - a.count)[0];
  const firstFix = (s.productRankingByNegative || [])[0];
  const rows = [
    ['항목', '내용'],
    ['분석일', meta?.analysisDate || new Date().toISOString().slice(0, 10)],
    ['전체 리뷰 수', s.totalReviews ?? products.reduce((a, p) => a + (p.totalReviews || 0), 0)],
    ['분석 상품 수', s.productCount ?? products.length],
    ['긍정 리뷰 수', sc.positive ?? ''],
    ['중립 리뷰 수', sc.neutral ?? ''],
    ['부정 리뷰 수', sc.negative ?? ''],
    ['개선 이슈 발견 리뷰 수', s.issueReviewCount ?? ''],
    ['가장 많이 반복된 이슈', topCat ? `${topCat.name} (${topCat.count}건)` : ''],
    ['먼저 확인할 상품', firstFix ? firstFix.productName : ''],
    ['전체 리뷰 요약', s.aiComment || ''],
    ['주의 사항', '개선 이슈는 긍정 리뷰 안에서도 발견될 수 있어, 부정 리뷰 수와 다를 수 있습니다. 모든 리뷰 내용은 개인정보가 가려진 데이터입니다.'],
  ];
  const ws = aoaSheet(rows);
  setColWidths(ws, [22, 70]);
  freezeHeader(ws);
  return ws;
}

function buildProductSummarySheet(products) {
  const header = ['상품명', '전체 리뷰 수', '긍정', '중립', '부정', '부정 리뷰 비율', '주요 이슈', '우선 확인 필요', '요약'];
  const rows = [header];
  for (const p of products) {
    const sc = p.sentimentCounts || {};
    const topIssue = (p.topIssues || [])[0];
    rows.push([
      p.productName,
      p.totalReviews ?? '',
      sc.positive ?? '',
      sc.neutral ?? '',
      sc.negative ?? '',
      pctLabel(p.negativeRatio),
      topIssue ? `${topIssue.category} · ${topIssue.issueLabel}` : '',
      p.productStatus || '',
      p.summary || p.productInsight || '',
    ]);
  }
  const ws = aoaSheet(rows);
  setColWidths(ws, [26, 12, 8, 8, 8, 12, 30, 16, 50]);
  freezeHeader(ws);
  return ws;
}

function buildIssueSheet(products) {
  const header = ['이슈 분류', '세부 이슈', '발생 건수', '전체 대비 비율', '중요도', '관련 상품', '대표 근거 리뷰'];
  const rows = [header];
  for (const p of products) {
    const issues = p.allIssues && p.allIssues.length > 0 ? p.allIssues : (p.topIssues || []);
    for (const iss of issues) {
      rows.push([
        iss.category || '',
        iss.issueLabel || '',
        iss.count ?? '',
        pctLabel(iss.ratio),
        severityLabel(iss.severity),
        p.productName,
        evidenceText(iss.evidenceReviews),
      ]);
    }
  }
  if (rows.length === 1) rows.push(['', '발견된 반복 이슈가 없습니다.', '', '', '', '', '']);
  const ws = aoaSheet(rows);
  setColWidths(ws, [16, 26, 10, 14, 8, 24, 60]);
  freezeHeader(ws);
  return ws;
}

function buildReviewSheet(products) {
  const header = ['상품명', '옵션', '별점', '감성', '이슈 분류', '세부 이슈', '리뷰 내용', '작성일'];
  const rows = [header];
  for (const p of products) {
    for (const r of (p.reviews || [])) {
      const cats = (r.detectedIssues || []).map((d) => d.category).filter(Boolean).join(' | ');
      const labels = (r.detectedIssues || []).map((d) => d.issue || d.issueLabel).filter(Boolean).join(' | ');
      rows.push([
        r.productName || p.productName,
        r.optionName || '',
        r.rating ?? '',
        sentimentLabel(r.sentiment),
        cats,
        labels,
        r.content || '',
        r.createdAt || '',
      ]);
    }
  }
  if (rows.length === 1) rows.push(['', '', '', '', '', '', '표시할 리뷰 데이터가 없습니다.', '']);
  const ws = aoaSheet(rows);
  setColWidths(ws, [24, 14, 6, 8, 16, 24, 60, 12]);
  freezeHeader(ws);
  return ws;
}

function buildReplySheet(products) {
  const header = ['상품명', '이슈 분류', '세부 이슈', '말투', 'CS 답글 초안'];
  const rows = [header];
  for (const p of products) {
    for (const rt of (p.replyTemplates || [])) {
      for (const v of (rt.variants || [])) {
        rows.push([
          p.productName,
          rt.category || '',
          rt.issueLabel || '',
          v.tone || v.label || '',
          v.template || v.text || '',
        ]);
      }
    }
  }
  if (rows.length === 1) rows.push(['', '', '', '', '생성된 CS 답글 초안이 없습니다.']);
  const ws = aoaSheet(rows);
  setColWidths(ws, [24, 16, 24, 10, 70]);
  freezeHeader(ws);
  return ws;
}

export function buildAnalysisWorkbook(products, summary, meta = {}) {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, buildSummarySheet(products, summary, meta), '리포트 요약');
  xlsx.utils.book_append_sheet(wb, buildProductSummarySheet(products), '상품별 요약');
  xlsx.utils.book_append_sheet(wb, buildIssueSheet(products), '반복 이슈');
  xlsx.utils.book_append_sheet(wb, buildReviewSheet(products), '리뷰 데이터');
  xlsx.utils.book_append_sheet(wb, buildReplySheet(products), 'CS 답글 초안');
  // 노드 버퍼로 반환 (라우트에서 그대로 전송)
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
