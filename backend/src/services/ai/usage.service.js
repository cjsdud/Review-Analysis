// llm_usage_logs 헬퍼 — LLM 호출 단위 token usage / 비용 기록.
// 호출 성공/실패 모두 기록 가능 (status='ok' | 'error'). 모델별 단가는
// 운영 환경변수로 받거나 기본 추정값을 쓴다.
import db from '../../db/database.js';

// 모델별 1k token 단가 (USD). 실제 운영 단가에 맞춰 env 로 덮을 수 있게.
// OpenAI 공식 가격 페이지 (https://openai.com/pricing) 기준으로 주기적 갱신 필요.
// suffix 가 붙은 풀 모델명(gpt-4o-mini-2024-07-18 등) 도 normalizeModelName 으로 흡수.
const DEFAULT_PRICES = {
  'gpt-4o-mini':  { input: 0.00015, output: 0.0006 },   // $0.15/$0.60 per 1M
  'gpt-4o':       { input: 0.0025,  output: 0.01 },     // $2.50/$10.00 per 1M
  'gpt-4.1-nano': { input: 0.0001,  output: 0.0004 },
  'gpt-4.1-mini': { input: 0.0004,  output: 0.0016 },
  'gpt-4.1':      { input: 0.002,   output: 0.008 },
  // 과거 코드에서 placeholder 로 사용했던 'gpt-5.4-*' 도 0 처리 안 되도록 보존.
  // 실제 호출이 되면 OpenAI 측에서 404 가 나서 fallback 으로 빠지지만, 만약 env override 로
  // 진짜 새 모델로 매핑된 경우엔 가격값을 env 로 다시 덮으면 된다.
  'gpt-5.4-nano': { input: 0.00005, output: 0.0002 },
  'gpt-5.4-mini': { input: 0.00015, output: 0.0006 },
  'gpt-5.4':      { input: 0.0025,  output: 0.01 },
};

// suffix 가 붙은 OpenAI 모델명을 base 모델명으로 정규화.
// 예: 'gpt-4o-mini-2024-07-18' → 'gpt-4o-mini', 'GPT-4o' → 'gpt-4o'.
export function normalizeModelName(model) {
  const raw = String(model || '').trim().toLowerCase();
  if (!raw) return '';
  if (DEFAULT_PRICES[raw]) return raw;
  // 가장 긴 prefix 부터 매칭 — 'gpt-4o-mini' 가 'gpt-4o' 보다 우선.
  const ordered = Object.keys(DEFAULT_PRICES).sort((a, b) => b.length - a.length);
  for (const base of ordered) {
    if (raw.startsWith(base)) return base;
  }
  return raw;
}

function modelPrice(model) {
  if (!model) return null;
  const normalized = normalizeModelName(model);
  const key = `LLM_PRICE_${normalized.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const envInput = Number(process.env[`${key}_INPUT_PER_1K`]);
  const envOutput = Number(process.env[`${key}_OUTPUT_PER_1K`]);
  if (Number.isFinite(envInput) && Number.isFinite(envOutput)) {
    return { input: envInput, output: envOutput };
  }
  return DEFAULT_PRICES[normalized] || null;
}

// 알 수 없는 모델은 console.warn 한 번만 — 같은 모델이 매번 찍히지 않게 dedupe.
const _missingPricingWarned = new Set();
function warnMissingPricing(model) {
  if (!model || _missingPricingWarned.has(model)) return;
  _missingPricingWarned.add(model);
  console.warn(`[llm-cost] missing pricing for model="${model}" — estimated_cost_usd will be 0. Add it to DEFAULT_PRICES or set LLM_PRICE_<MODEL>_*_PER_1K env.`);
}

function estimateCostUsd({ model, inputTokens, outputTokens }) {
  const p = modelPrice(model);
  if (!p) {
    warnMissingPricing(model);
    // null 이 아니라 0 을 반환 — SQL SUM 이 NULL row 를 만들지 않고 일관 합계.
    return 0;
  }
  return Number((inputTokens / 1000 * p.input + outputTokens / 1000 * p.output).toFixed(8));
}

// OpenAI/Gemini/Claude 응답의 usage 구조를 방어적으로 흡수.
// totalTokens 만 있고 input/output 이 0 이면 토큰이 합쳐진 형태 — input 으로 추정해 비용 0 방지.
export function normalizeUsage(usage = {}) {
  const u = usage || {};
  let input = Number(u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? u.promptTokenCount ?? 0) || 0;
  let output = Number(u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? 0) || 0;
  let total = Number(u.totalTokens ?? u.total_tokens ?? u.totalTokenCount ?? 0) || 0;
  if (total > 0 && input === 0 && output === 0) input = total; // 분리 정보 없으면 보수적으로 input 으로
  if (total === 0 && (input > 0 || output > 0)) total = input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

// 호출 1건 기록.
//   provider: 'openai' | 'gemini' | 'claude' | 'mock' | 'rule' | 'cache'
//   requestType: 'review_analysis' | 'review_reanalysis' | 'report_summary' | 'cs_reply' | 'analysis_summary'
//   usage: { inputTokens, outputTokens, totalTokens? }
//   status: 'ok' | 'error'
//   error: 문자열 (status='error' 일 때)
//   reviewCount / cacheHitCount / cacheMissCount / miniReanalysisCount: 분석 단위 요약용
//   openaiCalled / fallbackUsed / fallbackProvider: 관리자 로그 화면 표시용
export function recordLlmUsage({
  userId = null,
  analysisId = null,
  provider,
  model = null,
  promptVersion = null,
  analysisVersion = null,
  requestType,
  usage = {},
  status = 'ok',
  error = null,
  reviewCount = null,
  cacheHitCount = 0,
  cacheMissCount = 0,
  miniReanalysisCount = 0,
  openaiCalled = false,
  fallbackUsed = false,
  fallbackProvider = null,
} = {}) {
  if (!provider || !requestType) return null;
  // 다양한 provider 응답 schema 흡수 — prompt_tokens / promptTokenCount 등도 인식.
  const norm = normalizeUsage(usage);
  const input = norm.inputTokens;
  const output = norm.outputTokens;
  const total = norm.totalTokens;
  // 모델명은 호출 직전 lastCallModel 기준이 정상 — null 이면 cost 0 + warning.
  const cost = estimateCostUsd({ model, inputTokens: input, outputTokens: output });
  try {
    const r = db.prepare(
      `INSERT INTO llm_usage_logs
         (user_id, analysis_id, provider, model, prompt_version, analysis_version, request_type,
          input_tokens, output_tokens, total_tokens, estimated_cost_usd,
          review_count, cache_hit_count, cache_miss_count, mini_reanalysis_count,
          openai_called, fallback_used, fallback_provider,
          status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId, analysisId, provider, model, promptVersion, analysisVersion, requestType,
      input, output, total, cost,
      reviewCount, cacheHitCount, cacheMissCount, miniReanalysisCount,
      openaiCalled ? 1 : 0, fallbackUsed ? 1 : 0, fallbackProvider,
      status, error ? String(error).slice(0, 500) : null,
    );
    return r.lastInsertRowid;
  } catch (e) {
    console.warn('[llm-usage] failed to record:', e.message);
    return null;
  }
}

// 관리자 콘솔용: 로그 목록 (페이징 + 필터).
//   filters: { provider, model, requestType, userId, analysisId, dateFrom, dateTo }
export function listLlmLogs({ page = 1, limit = 20, filters = {} } = {}) {
  const where = [];
  const params = [];
  if (filters.provider)    { where.push('l.provider = ?');     params.push(filters.provider); }
  if (filters.model)       { where.push('l.model = ?');        params.push(filters.model); }
  if (filters.requestType) { where.push('l.request_type = ?'); params.push(filters.requestType); }
  if (filters.userId)      { where.push('l.user_id = ?');      params.push(filters.userId); }
  if (filters.analysisId)  { where.push('l.analysis_id = ?');  params.push(filters.analysisId); }
  if (filters.dateFrom)    { where.push('l.created_at >= ?'); params.push(String(filters.dateFrom)); }
  if (filters.dateTo)      { where.push('l.created_at <= ?'); params.push(String(filters.dateTo)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const off = Math.max(0, (Number(page) - 1) * Number(limit));
  const lim = Math.max(1, Math.min(Number(limit) || 20, 200));
  const rows = db.prepare(
    `SELECT l.*, u.email AS user_email FROM llm_usage_logs l
     LEFT JOIN users u ON u.id = l.user_id
     ${whereSql}
     ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, lim, off);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM llm_usage_logs l ${whereSql}`).get(...params).n;
  return { rows, total, page: Number(page) || 1, limit: lim };
}

export function getLlmLog(id) {
  const row = db.prepare(
    `SELECT l.*, u.email AS user_email FROM llm_usage_logs l
     LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
  ).get(id);
  return row || null;
}

// 관리자 콘솔용 요약 카드 — 오늘/이번 달 token 합계 / 예상 비용 / OpenAI 호출 / cache hit / fallback.
export function getLlmUsageSummary() {
  const today = db.prepare(
    `SELECT COALESCE(SUM(total_tokens), 0) AS tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS cost
     FROM llm_usage_logs WHERE created_at >= date('now', 'start of day')`,
  ).get();
  const month = db.prepare(
    `SELECT COALESCE(SUM(total_tokens), 0) AS tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS cost
     FROM llm_usage_logs WHERE created_at >= date('now', 'start of month')`,
  ).get();
  const counts = db.prepare(
    `SELECT SUM(openai_called) AS openai,
            SUM(cache_hit_count) AS cache_hits,
            SUM(fallback_used) AS fallbacks
     FROM llm_usage_logs WHERE created_at >= date('now', 'start of month')`,
  ).get();
  // 명시적 Number 변환 — better-sqlite3 가 numeric 합계를 그대로 number 로 주지만,
  // null 도 가능하므로 fallback 0. toFixed 호출 없이 원본 float 유지 (6 자리에서
  // 끊으면 매우 작은 비용이 0 으로 떨어진다).
  return {
    todayTotalTokens: Number(today?.tokens || 0),
    todayEstimatedCostUsd: Number(today?.cost ?? 0),
    monthTotalTokens: Number(month?.tokens || 0),
    monthEstimatedCostUsd: Number(month?.cost ?? 0),
    openaiCallCount: Number(counts?.openai || 0),
    cacheHitCount: Number(counts?.cache_hits || 0),
    fallbackCount: Number(counts?.fallbacks || 0),
  };
}

// 관리자 콘솔용 — 사용자/분석별 token 합계.
export function getLlmUsageForUser(userId, days = 30) {
  if (!userId) return null;
  return db.prepare(
    `SELECT provider, model, COUNT(*) AS calls,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(total_tokens) AS total_tokens,
            SUM(estimated_cost_usd) AS estimated_cost_usd
     FROM llm_usage_logs
     WHERE user_id = ? AND created_at >= datetime('now', ?)
     GROUP BY provider, model`,
  ).all(userId, `-${days} days`);
}
