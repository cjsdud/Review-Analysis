import client from './client.js';

export async function runAnalysis(uploadId, { analysisMode } = {}) {
  const body = { uploadId };
  if (analysisMode) body.analysisMode = analysisMode;
  const { data } = await client.post('/analysis', body);
  return data;
}

export async function getAnalysis(analysisId) {
  // 비동기 job — 진행 중이면 202 가 떨어진다 (data.status = 'processing'/'failed').
  // 202 도 정상 응답으로 받기 위해 validateStatus 확장.
  const { data } = await client.get(`/analysis/${analysisId}`, { validateStatus: (s) => s >= 200 && s < 300 });
  return data;
}

export async function getAnalysisStatus(analysisId) {
  const { data } = await client.get(`/analysis/${analysisId}/status`);
  return data?.analysis || null;
}

// 최근 분석 히스토리 목록 (로그인 없음: 서버에 저장된 전체 분석)
export async function getAnalyses(limit = 20) {
  const { data } = await client.get('/analyses', { params: { limit } });
  return data;
}

export async function getProducts(analysisId) {
  const { data } = await client.get(`/analysis/${analysisId}/products`);
  return data;
}

export async function getProductDetail(analysisId, productKey) {
  const { data } = await client.get(`/analysis/${analysisId}/products/${productKey}`);
  return data;
}

export function exportCsvUrl(analysisId) {
  return `/api/analysis/${analysisId}/export.csv`;
}

// 사용자용 다중 시트 엑셀 리포트. productKey 가 있으면 해당 상품만.
export function exportXlsxUrl(analysisId, productKey) {
  const base = `/api/analysis/${analysisId}/export.xlsx`;
  return productKey ? `${base}?productKey=${encodeURIComponent(productKey)}` : base;
}

// 선택한 tone 1개의 CS 답글 초안만 lazy 로 요청.
// body: { issueLabel, category?, tone?, recommendedAction?, polarity?, severity?, isActionableIssue?, sentiment? }
// 응답: { templates: [{ issueLabel, tone, toneLabel, template }] } (배열 길이 1)
export async function generateReplyTemplates(body) {
  const { data } = await client.post('/ai/reply-templates', body || {});
  return data.templates || [];
}

// 사용자 분류 수정 저장
// payload: { productKey, category, issueLabel, newCategory, newIssueLabel, reviewIds? }
export async function saveCorrection(analysisId, payload) {
  const { data } = await client.post(`/analysis/${analysisId}/corrections`, payload);
  return data;
}

// 기간별 리뷰 변화 — Pro 이상에서만 200(available) 가능. Free/Starter 는 locked shape.
// mode: 'recent_30_vs_previous_30' | 'recent_90_vs_previous_90' | 'custom' | 'monthly_trend' | 'weekly_trend'
// custom 일 때만 currentStart/currentEnd/previousStart/previousEnd 사용 (YYYY-MM-DD).
export async function getPeriodComparison(analysisId, params = {}) {
  const { data } = await client.get(`/analysis/${analysisId}/period-comparison`, {
    params,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return data;
}
