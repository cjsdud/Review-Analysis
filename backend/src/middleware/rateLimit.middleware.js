// Rate limiter — 비용/보안 민감 API 의 abuse 방지용 보조 장치.
//
// 정책:
//   - 기존 billing/plan limit 와 충돌하지 않는다. plan limit 은 "상품 정책",
//     rate limit 은 "abuse 방지". 두 가드는 동시에 켜져 있어도 무방 (다른 응답 코드).
//   - 사용자 친화 한국어 메시지 + JSON {error, code, message} 통일.
//   - 환경 변수로 windowMs / max override 가능 — 운영 중 정책 조정 편의.
//
// 응답 형태 (프론트 client.js 의 인터셉터가 .message 우선 사용):
//   { error: '<service-friendly>', code: '<machine-code>', message: '<same as error>' }
//
// 키 선택:
//   - authLimiter   : IP (로그인 전이라 user 없음)
//   - uploadLimiter : 로그인 사용자면 user.id, 없으면 IP
//   - aiReplyLimiter: 로그인 사용자면 user.id, 없으면 IP
//
// 프록시(Render 등):
//   express-rate-limit 가 정확한 client IP 를 보려면 server.js 에서
//   `app.set('trust proxy', 1)` 가 필요. 이 미들웨어는 그 설정을 가정한다.

import rateLimit from 'express-rate-limit';

// ── env 헬퍼 ───────────────────────────────────────────────────────────────
function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// 테스트/CI 환경에서는 limiter 를 끈다 — 회귀 스위트가 다수의 login/register 를
// 빠르게 호출하면 모든 후속 검증이 429 로 떨어짐.
// NODE_ENV=test (Vitest/Jest 표준) 또는 명시적 DISABLE_RATE_LIMIT=true 일 때 skip.
// 운영에서는 두 값 모두 설정되지 않으므로 정상 동작.
function isDisabled() {
  if (String(process.env.DISABLE_RATE_LIMIT || '').toLowerCase() === 'true') return true;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'test') return true;
  return false;
}
function skipWhenDisabled() {
  return isDisabled();
}

// ── 키 추출 ────────────────────────────────────────────────────────────────
// 로그인 사용자면 user.id, 없으면 IP (express-rate-limit 의 기본 IP 추출).
// 키에 'u:' / 'ip:' prefix 를 붙여 동일 표 안에서 충돌하지 않게.
function userOrIpKey(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  // express-rate-limit 의 ipKeyGenerator(req) 를 그대로 쓰면 v6 호환.
  // 여기선 req.ip 가 표준이고 trust proxy 가 설정되어 있어야 함.
  return `ip:${req.ip || 'unknown'}`;
}

function ipKey(req) {
  return `ip:${req.ip || 'unknown'}`;
}

// ── 공통 핸들러 ────────────────────────────────────────────────────────────
// 429 응답 형식 — 기존 라우트 컨벤션(error=머신 코드, message=한국어 사용자 문구) 과 일치.
// frontend/src/api/client.js 인터셉터가 message 를 우선 사용하므로 사용자에게는
// "잠시 후 다시 시도해주세요" 가 자연스럽게 노출된다.
function rateLimitHandler({ errorText, code }) {
  return (_req, res /*, _next, options */) => {
    res.status(429).json({
      error: code,
      code,
      message: errorText,
    });
  };
}

// ── 1) authLimiter — 로그인 brute force 방지 ───────────────────────────────
// 기본: 15분 / 5회 / IP 기준. env override: AUTH_RATE_LIMIT_WINDOW_MS / AUTH_RATE_LIMIT_MAX.
export const authLimiter = rateLimit({
  windowMs: envInt('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  max: envInt('AUTH_RATE_LIMIT_MAX', 5),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipWhenDisabled,
  keyGenerator: ipKey,
  handler: rateLimitHandler({
    errorText: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
    code: 'RATE_LIMITED',
  }),
});

// ── 2) uploadLimiter — 파일 업로드 / 분석 시작 남용 방지 ───────────────────
// 기본: 24h / 10회. 로그인 사용자면 user.id, 없으면 IP.
// 기존 plan limit (checkCanUploadFile/checkCanCreateAnalysis) 과 별개.
export const uploadLimiter = rateLimit({
  windowMs: envInt('UPLOAD_RATE_LIMIT_WINDOW_MS', 24 * 60 * 60 * 1000),
  max: envInt('UPLOAD_RATE_LIMIT_MAX', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipWhenDisabled,
  keyGenerator: userOrIpKey,
  handler: rateLimitHandler({
    errorText: '파일 업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    code: 'UPLOAD_RATE_LIMITED',
  }),
});

// ── 3) aiReplyLimiter — CS 답글 LLM 비용 폭주 방지 ─────────────────────────
// 기본: 24h / 50회. 로그인 사용자면 user.id, 없으면 IP.
// 기존 checkCanGenerateCsReply 의 월 한도(플랜별) 와 별개.
export const aiReplyLimiter = rateLimit({
  windowMs: envInt('AI_REPLY_RATE_LIMIT_WINDOW_MS', 24 * 60 * 60 * 1000),
  max: envInt('AI_REPLY_RATE_LIMIT_MAX', 50),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipWhenDisabled,
  keyGenerator: userOrIpKey,
  handler: rateLimitHandler({
    errorText: 'CS 답글 생성 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    code: 'AI_REPLY_RATE_LIMITED',
  }),
});

// ── 운영 가시성 ────────────────────────────────────────────────────────────
// 부팅 시 한 줄 요약을 콘솔에 남겨 정책 변경이 적용됐는지 운영자가 확인.
export function logRateLimitConfig() {
  console.info(
    '[rate-limit] auth=' + envInt('AUTH_RATE_LIMIT_MAX', 5) +
    '/' + Math.round(envInt('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000) / 60000) + 'm' +
    ' upload=' + envInt('UPLOAD_RATE_LIMIT_MAX', 10) +
    '/' + Math.round(envInt('UPLOAD_RATE_LIMIT_WINDOW_MS', 24 * 60 * 60 * 1000) / 3600000) + 'h' +
    ' ai_reply=' + envInt('AI_REPLY_RATE_LIMIT_MAX', 50) +
    '/' + Math.round(envInt('AI_REPLY_RATE_LIMIT_WINDOW_MS', 24 * 60 * 60 * 1000) / 3600000) + 'h',
  );
}

// 테스트/관리자 진단용 — env 파싱 결과를 그대로 노출.
export function getRateLimitConfig() {
  return {
    auth:    { windowMs: envInt('AUTH_RATE_LIMIT_WINDOW_MS',    15 * 60 * 1000),     max: envInt('AUTH_RATE_LIMIT_MAX',    5)  },
    upload:  { windowMs: envInt('UPLOAD_RATE_LIMIT_WINDOW_MS',  24 * 60 * 60 * 1000), max: envInt('UPLOAD_RATE_LIMIT_MAX',   10) },
    aiReply: { windowMs: envInt('AI_REPLY_RATE_LIMIT_WINDOW_MS', 24 * 60 * 60 * 1000), max: envInt('AI_REPLY_RATE_LIMIT_MAX', 50) },
  };
}
