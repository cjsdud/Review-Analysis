import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import uploadRoutes from './routes/upload.routes.js';
import analysisRoutes from './routes/analysis.routes.js';
import historyRoutes from './routes/history.routes.js';
import aiRoutes from './routes/ai.routes.js';
import authRoutes from './routes/auth.routes.js';
import billingRoutes from './routes/billing.routes.js';
import plansRoutes from './routes/plans.routes.js';
import adminRoutes from './routes/admin.routes.js';
import announcementsRoutes from './routes/announcements.routes.js';
import shareRoutes from './routes/share.routes.js';
import { aiMode } from './services/aiClient.service.js';
import { purgeStaleUploadRows } from './db/database.js';
import { maintenanceGate } from './middleware/maintenance.middleware.js';
import analyticsRoutes from './routes/analytics.routes.js';
import { seedConfiguredAccounts } from './services/seedAccounts.service.js';
import { logRateLimitConfig } from './middleware/rateLimit.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
// 임시 업로드 데이터(rows / sheet_parse_results) 보관 시간. 최소 1분.
const UPLOAD_ROWS_TTL_MIN = Math.max(1, Number(process.env.UPLOAD_ROWS_TTL_MIN || 60));
// cleanup 주기(분). 최소 1분.
const UPLOAD_CLEANUP_INTERVAL_MIN = Math.max(1, Number(process.env.UPLOAD_CLEANUP_INTERVAL_MIN || 10));
const isProd = process.env.NODE_ENV === 'production';

// Render / 일반 프록시 환경에서 올바른 client IP 기반 rate limit + 로그를 위해 trust proxy 설정.
// 1 = 직속 프록시 1개(예: Render edge) 를 신뢰. 멀티 hop CDN 사용 시 늘려야 함.
// express-rate-limit 가 정확한 req.ip 를 보기 위해서도 필요.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ===== API =====
app.get('/api/health', (_req, res) => res.json({ ok: true, aiMode }));
// 공개 analytics — 점검 모드와 무관하게 동작해야 하므로 gate 이전에 등록.
app.use('/api/analytics', analyticsRoutes);
// 점검 모드 게이트 — health/auth/admin/announcements/active 를 제외한 일반 API 차단
app.use(maintenanceGate);
app.use('/api/auth', authRoutes); // POST /register /login /logout, GET /me
// GET /api/me 별칭 — /api/auth/me 와 동일하게 동작
app.get('/api/me', (req, res, next) => { req.url = '/me'; authRoutes(req, res, next); });
app.use('/api/billing', billingRoutes);
// 공개 플랜 features SSOT — PLAN_FEATURES + analysisModes 노출. PricingPage 사용.
app.use('/api/plans', plansRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/announcements', announcementsRoutes);
// 공유 코드(외부 셀러용 읽기 전용) — 비로그인 접근.
// shareLimiter 가 라우터 내부에서 코드 무차별 대입을 차단.
app.use('/api/shared-reports', shareRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/analyses', historyRoutes); // 분석 히스토리 목록 (복수형)
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
// 임시 업로드 파싱 데이터(rows / sheet_parse_results)만 정리한다.
// 분석 결과(analysis_jobs / product_analyses / reviews / review_classifications)는 히스토리로 유지.
function runCleanup(reason) {
  try {
    const changes = purgeStaleUploadRows(UPLOAD_ROWS_TTL_MIN);
    if (changes > 0) {
      console.info(
        `[review-fit] upload cleanup (${reason}): ${changes}건의 임시 파싱 데이터를 정리했습니다 (TTL ${UPLOAD_ROWS_TTL_MIN}분).`,
      );
    }
  } catch (e) {
    console.warn('[review-fit] upload cleanup 실패:', e.message);
  }
}

// 서버 시작 시 1회 + 주기 실행
runCleanup('startup');
const purgeTimer = setInterval(() => runCleanup('interval'), UPLOAD_CLEANUP_INTERVAL_MIN * 60 * 1000);
purgeTimer.unref?.();

// ===== 베타 테스트용 계정 seed =====
// SEED_ACCOUNTS_ENABLED=true 일 때만 동작. Render Free 처럼 디스크가 휘발성인 환경에서
// 재배포 직후 로그인 테스트가 바로 가능하도록 관리자/베타 테스터 계정을 보장한다.
// 비밀번호는 bcrypt 해시로만 저장되며 로그에는 절대 출력되지 않는다.
try {
  seedConfiguredAccounts();
} catch (e) {
  console.warn('[seed][warning] seedConfiguredAccounts 실패:', e.message);
}

// 서버 부팅 후 한 번 — 재시작/배포로 인해 멈춰 있던 processing/pending row 를
// failed 로 일괄 전환. 실패 사유를 errorMessage 에 남겨 사용자/관리자가 인지 가능.
import { recoverStaleAnalysisJobs } from './services/analysisJob.service.js';
try {
  recoverStaleAnalysisJobs();
} catch (e) {
  console.warn('[startup] analysisJob recovery skipped:', e.message);
}

app.listen(PORT, () => {
  const serving = isProd && distExists ? ', serving frontend/dist' : '';
  console.log(`[review-fit] backend on port ${PORT} (AI mode: ${aiMode}${serving})`);
  logRateLimitConfig();
});
