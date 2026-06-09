// Vitest + React Testing Library 공통 셋업.
// jest-dom 매처(toBeInTheDocument 등) 활성.
import '@testing-library/jest-dom/vitest';

// 환경 변수 기본값 — 테스트에서 import.meta.env.VITE_GOOGLE_CLIENT_ID 등이 undefined 면 빈 문자열.
// (vitest 는 vite 환경을 그대로 쓰므로 추가 모킹 불요지만 fallback 안전망.)
if (typeof globalThis.import === 'undefined') globalThis.import = {};

// matchMedia 폴리필 — jsdom 에 없음. 일부 컴포넌트가 호출.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
