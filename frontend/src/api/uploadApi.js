import client from './client.js';

export async function uploadFile(file, source = 'custom') {
  const form = new FormData();
  form.append('file', file);
  form.append('source', source);
  const { data } = await client.post('/uploads', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function uploadSample() {
  const { data } = await client.post('/uploads/sample');
  return data;
}

export async function getUpload(uploadId) {
  const { data } = await client.get(`/uploads/${uploadId}`);
  return data;
}

export async function getMappingTemplates() {
  const { data } = await client.get('/uploads/templates/list');
  return data;
}

// XLSX 멀티 시트/헤더 행 재선택 — 시트나 헤더 행을 바꾸면 호출.
// body: { sheetName?, headerRowIndex? } → 새 headers/sampleRows/mappingSuggestion 반환
export async function reparseUpload(uploadId, { sheetName, headerRowIndex } = {}) {
  const body = {};
  if (sheetName != null) body.sheetName = sheetName;
  if (headerRowIndex != null) body.headerRowIndex = headerRowIndex;
  const { data } = await client.post(`/uploads/${uploadId}/reparse`, body);
  return data;
}

export async function saveMapping(uploadId, mapping, opts = {}) {
  const { data } = await client.post(`/uploads/${uploadId}/mapping`, {
    mapping,
    saveAsTemplate: opts.saveAsTemplate || false,
    templateName: opts.templateName,
  });
  return data;
}
