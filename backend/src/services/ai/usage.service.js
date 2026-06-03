// llm_usage_logs 헬퍼 — LLM 호출 단위 token usage / 비용 기록.
// 호출 성공/실패 모두 기록 가능 (status='ok' | 'error'). 모델별 단가는
// 운영 환경변수로 받거나 기본 추정값을 쓴다.
import db from '../../db/database.js';

// 모델별 1k token 단가 (USD). 실제 운영 단가에 맞춰 env 로 덮을 수 있게.
// OpenAI 의 nano/mini 모델은 향후 발표 시점에 맞춰 갱신 필요.
function modelPrice(model) {
  if (!model) return null;
  const key = `LLM_PRICE_${String(model).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const envInput = Number(process.env[`${key}_INPUT_PER_1K`]);
  const envOutput = Number(process.env[`${key}_OUTPUT_PER_1K`]);
  if (Number.isFinite(envInput) && Number.isFinite(envOutput)) {
    return { input: envInput, output: envOutput };
  }
  // 기본 추정 단가 (1k token 당 USD). env 로 덮지 않은 모델은 여기서 잡힌다.
  // 모르는 모델은 null → 비용 계산 스킵 (token 수만 기록).
  const defaults = {
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4o':      { input: 0.0025,  output: 0.01 },
    'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },
    'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
    'gpt-4.1':      { input: 0.002,  output: 0.008 },
  };
  return defaults[model] || null;
}

function estimateCostUsd({ model, inputTokens, outputTokens }) {
  const p = modelPrice(model);
  if (!p) return null;
  return Number((inputTokens / 1000 * p.input + outputTokens / 1000 * p.output).toFixed(6));
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
  const input = Number(usage.inputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const total = Number(usage.totalTokens) || input + output;
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
  return {
    todayTotalTokens: Number(today?.tokens || 0),
    todayEstimatedCostUsd: Number((today?.cost || 0).toFixed?.(6) || 0),
    monthTotalTokens: Number(month?.tokens || 0),
    monthEstimatedCostUsd: Number((month?.cost || 0).toFixed?.(6) || 0),
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
