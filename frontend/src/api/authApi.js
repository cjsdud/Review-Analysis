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
