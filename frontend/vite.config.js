import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 프론트(5173) → 백엔드(4000) 프록시
export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  // Vitest 설정 — jsdom + RTL setup 파일. css: false 로 SCSS 컴파일 스킵해 빠른 실행.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.js'],
    css: false,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
});
