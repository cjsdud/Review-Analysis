import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import uploadRoutes from './routes/upload.routes.js';
import analysisRoutes from './routes/analysis.routes.js';
import aiRoutes from './routes/ai.routes.js';
import { aiMode } from './services/aiClient.service.js';

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, aiMode }));

app.use('/api/uploads', uploadRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/ai', aiRoutes);

// 에러 핸들러 (multer 파일 크기 초과 등)
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

app.listen(PORT, () => {
  console.log(`[review-insight] backend on http://localhost:${PORT} (AI mode: ${aiMode})`);
});
