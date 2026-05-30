import axios from 'axios';

// vite 프록시를 통해 /api → 백엔드로 전달
const client = axios.create({
  baseURL: '/api',
  timeout: 60000,
  withCredentials: true, // httpOnly auth cookie 포함
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const code = err.response?.data?.error;
    const message = err.response?.data?.message || code || err.message || '요청 중 오류가 발생했습니다.';
    // 호출부에서 분기할 수 있도록 status / code 도 같이 노출
    const e = new Error(message);
    e.status = status;
    e.code = code;
    e.response = err.response;
    return Promise.reject(e);
  },
);

export default client;
