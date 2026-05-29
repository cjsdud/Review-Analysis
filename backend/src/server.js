import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import uploadRoutes from './routes/upload.routes.js';
import analysisRoutes from './routes/analysis.routes.js';
import aiRoutes from './routes/ai.routes.js';
import { aiMode } from './services/aiClient.service.js';
import { purgeStaleUploadRows } from './db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const UPLOAD_ROWS_TTL_MIN = Number(process.env.UPLOAD_ROWS_TTL_MIN || 60);
const isProd = process.env.NODE_ENV === 'production';

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '2mb' }));

// ===== API =====
app.get('/api/health', (_req, res) => res.json({ ok: true, aiMode }));
app.use('/api/uploads', uploadRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/ai', aiRoutes);

// ===== Production: 프론트 정적 파일 + SPA fallback =====
// 로컬에서는 Vite dev server 가 프론트를 서빙하므로 prod 모드에서만 활성.
// SPA fallback은 path-to-regexp 안전한 미들웨어 방식(`app.use`)으로 작성.
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const distExists = fs.existsSync(path.join(frontendDist, 'index.html'));
if (isProd && distExists) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else if (isProd && !distExists) {
  console.warn(`[review-fit] NODE_ENV=production 이지만 ${frontendDist}/index.html 이 없어 정적 서빙을 건너뜁니다. 'npm run build:frontend' 를 먼저 실행하세요.`);
}

// ===== 에러 핸들러 (multer 등) =====
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(Number(process.env.MAX_UPLOAD_BYTES || 10485760) / 1024 / 1024);
      return res.status(413).json({ error: `파일이 너무 큽니다. 최대 ${mb}MB까지 업로드할 수 있습니다.` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message || '요청 처리 중 오류가 발생했습니다.' });
  res.status(500).json({ error: 'Unknown error' });
});

// ===== TTL 청소 =====
purgeStaleUploadRows(UPLOAD_ROWS_TTL_MIN);
const purgeTimer = setInterval(() => purgeStaleUploadRows(UPLOAD_ROWS_TTL_MIN), 30 * 60 * 1000);
purgeTimer.unref?.();

app.listen(PORT, () => {
  const serving = isProd && distExists ? ', serving frontend/dist' : '';
  console.log(`[review-fit] backend on port ${PORT} (AI mode: ${aiMode}${serving})`);
});
