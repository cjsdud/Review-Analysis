import client from './client.js';

// 외부(셀러) 공개 공유 결과 조회 — 인증 없이 호출 가능.
// 잘못된 코드는 client 인터셉터가 status=404, message='공유 코드를 확인할 수 없습니다.' 로 전달.
export async function getSharedReport(code) {
  const { data } = await client.get(`/shared-reports/${encodeURIComponent(code)}`);
  return data;
}

// 입력 폼에서 검증만 (성공 시 정규화된 code 반환). 실패 시 throw → 호출부에서 catch.
export async function resolveSharedReportCode(code) {
  const { data } = await client.post('/shared-reports/resolve', { code });
  return data;
}

// 관리자 — 공유 코드 관리 API (adminApi 확장).
export const sharedReportAdminApi = {
  listAll:    () => client.get('/admin/shared-reports').then((r) => r.data),
  listForAnalysis: (analysisId) =>
    client.get(`/admin/analyses/${encodeURIComponent(analysisId)}/share`).then((r) => r.data),
  create:     (analysisId, body = {}) =>
    client.post(`/admin/analyses/${encodeURIComponent(analysisId)}/share`, body).then((r) => r.data),
  patch:      (shareId, body) =>
    client.patch(`/admin/shared-reports/${encodeURIComponent(shareId)}`, body).then((r) => r.data),
  revoke:     (shareId, body = {}) =>
    client.post(`/admin/shared-reports/${encodeURIComponent(shareId)}/revoke`, body).then((r) => r.data),
};
