import client from './client.js';

// 모든 인증 요청은 cookie 포함을 위해 withCredentials.
// 이메일/비밀번호 로그인은 제거되었다 — Google 로그인 (googleLogin) 만 사용한다.
const opts = { withCredentials: true };

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

// Google 로그인 — 백엔드가 GOOGLE_CLIENT_ID 로 ID Token 을 검증한 뒤 ReviewFit JWT(쿠키) 발급.
// credential: Google Identity Services 의 callback 으로 받은 ID Token 문자열.
export async function googleLogin(credential) {
  const { data } = await client.post('/auth/google', { credential }, opts);
  return data;
}

// Google 로그인 기능 활성 여부 — 백엔드 GOOGLE_CLIENT_ID 미설정 시 false.
// 프론트는 VITE_GOOGLE_CLIENT_ID 도 같이 확인해 둘 중 하나라도 비면 버튼을 숨긴다.
export async function getGoogleLoginConfig() {
  try {
    const { data } = await client.get('/auth/google/config');
    return Boolean(data?.enabled);
  } catch {
    return false;
  }
}
