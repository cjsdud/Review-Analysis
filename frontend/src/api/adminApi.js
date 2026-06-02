import client from './client.js';

// 관리자 API 클라이언트. 모든 호출은 cookie 인증.
export const adminApi = {
  summary:        () => client.get('/admin/summary').then((r) => r.data),
  listUsers:      (params = {}) => client.get('/admin/users', { params }).then((r) => r.data),
  getUser:        (id) => client.get(`/admin/users/${id}`).then((r) => r.data),
  patchUser:      (id, body) => client.patch(`/admin/users/${id}`, body).then((r) => r.data),
  resetUsage:     (id, reason) => client.post(`/admin/users/${id}/usage/reset`, { reason }).then((r) => r.data),
  listDiscounts:  (userId) => client.get(`/admin/users/${userId}/discounts`).then((r) => r.data),
  addDiscount:    (userId, body) => client.post(`/admin/users/${userId}/discounts`, body).then((r) => r.data),
  patchDiscount:  (id, body) => client.patch(`/admin/discounts/${id}`, body).then((r) => r.data),
  reports:        (params = {}) => client.get('/admin/analytics/reports', { params }).then((r) => r.data),
  demoViews:      () => client.get('/admin/analytics/demo').then((r) => r.data),
  listSettings:   (params = {}) => client.get('/admin/settings', { params }).then((r) => r.data),
  patchSetting:   (key, body) => client.patch(`/admin/settings/${key}`, body).then((r) => r.data),
  listAnnouncements: () => client.get('/admin/announcements').then((r) => r.data),
  createAnnouncement: (body) => client.post('/admin/announcements', body).then((r) => r.data),
  patchAnnouncement: (id, body) => client.patch(`/admin/announcements/${id}`, body).then((r) => r.data),
  deleteAnnouncement: (id) => client.delete(`/admin/announcements/${id}`).then((r) => r.data),
  actionLogs:     (params = {}) => client.get('/admin/action-logs', { params }).then((r) => r.data),
};

export async function getActiveAnnouncements() {
  const { data } = await client.get('/announcements/active');
  return data; // { announcements, banner }
}
