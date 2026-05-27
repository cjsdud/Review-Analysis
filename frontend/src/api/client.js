import axios from 'axios';

// vite 프록시를 통해 /api → 백엔드로 전달
const client = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.error || err.message || '요청 중 오류가 발생했습니다.';
    return Promise.reject(new Error(message));
  },
);

export default client;
