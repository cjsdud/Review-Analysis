import client from './client.js';

export async function runAnalysis(uploadId) {
  const { data } = await client.post('/analysis', { uploadId });
  return data;
}

export async function getAnalysis(analysisId) {
  const { data } = await client.get(`/analysis/${analysisId}`);
  return data;
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

export async function generateReplyTemplates(issueLabel, category) {
  const { data } = await client.post('/ai/reply-templates', { issueLabel, category });
  return data.templates;
}

// 사용자 분류 수정 저장
// payload: { productKey, category, issueLabel, newCategory, newIssueLabel, reviewIds? }
export async function saveCorrection(analysisId, payload) {
  const { data } = await client.post(`/analysis/${analysisId}/corrections`, payload);
  return data;
}
