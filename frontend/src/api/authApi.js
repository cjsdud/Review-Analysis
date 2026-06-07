import client from './client.js';

// 모든 인증 요청은 cookie 포함을 위해 withCredentials.
const opts = { withCredentials: true };

export async function register({ email, password, name }) {
  const { data } = await client.post('/auth/register', { email, password, name }, opts);
  return data;
}

export async function login({ email, password }) {
  const { data } = await client.post('/auth/login', { email, password }, opts);
  return data;
}

export async function logout() {
  const { data } = await client.post('/auth/logout', {}, opts);
  return data;
}

export async function getMe() {
  const { data } = await client.get('/me', opts);
  return data;
}

export async function getPlans() {
  const { data } = await client.get('/billing/plans');
  return data;
}

// 계정 탈퇴 — 본인 데이터 일괄 삭제. 성공 시 백엔드가 쿠키도 만료시키고,
// 호출 측은 AuthContext 를 null 로 갱신해 즉시 로그아웃 상태로.
export async function deleteAccount() {
  const { data } = await client.delete('/me/account', opts);
  return data;
}
