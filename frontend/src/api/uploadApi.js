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

export async function saveMapping(uploadId, mapping, opts = {}) {
  const { data } = await client.post(`/uploads/${uploadId}/mapping`, {
    mapping,
    saveAsTemplate: opts.saveAsTemplate || false,
    templateName: opts.templateName,
  });
  return data;
}
