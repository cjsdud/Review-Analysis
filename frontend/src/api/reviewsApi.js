import client from './client.js';

// GET /api/analysis/:id/reviews — 전체 보기용 리뷰 목록 (sentiment/filter/sort/pagination)
// 응답: { items, total, limit, offset }
export async function getAnalysisReviews(analysisId, params = {}) {
  const { data } = await client.get(`/analysis/${analysisId}/reviews`, { params });
  return data;
}
