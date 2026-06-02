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
  // 기본 추정 — 신규 nano/mini 가 정확히 잡히지 않으면 null 반환 후 비용 계산은 스킵.
  const defaults = {
    'gpt-5.4-nano': { input: 0.00005, output: 0.0002 },
    'gpt-5.4-mini': { input: 0.00015, output: 0.0006 },
    'gpt-5.4':      { input: 0.0025,  output: 0.01 },
    'gpt-4o-mini':  { input: 0.00015, output: 0.0006 },
  };
  return defaults[model] || null;
}

function estimateCostUsd({ model, inputTokens, outputTokens }) {
  const p = modelPrice(model);
  if (!p) return null;
  return Number((inputTokens / 1000 * p.input + outputTokens / 1000 * p.output).toFixed(6));
}

// 호출 1건 기록.
//   provider: 'openai' | 'gemini' | 'claude' | 'mock' | 'rule'
//   requestType: 'review_analysis' | 'review_reanalysis' | 'report_summary' | 'cs_reply'
//   usage: { inputTokens, outputTokens, totalTokens? }
//   status: 'ok' | 'error'
//   error: 문자열 (status='error' 일 때)
export function recordLlmUsage({
  userId = null,
  analysisId = null,
  provider,
  model = null,
  promptVersion = null,
  requestType,
  usage = {},
  status = 'ok',
  error = null,
} = {}) {
  if (!provider || !requestType) return null;
  const input = Number(usage.inputTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const total = Number(usage.totalTokens) || input + output;
  const cost = estimateCostUsd({ model, inputTokens: input, outputTokens: output });
  try {
    const r = db.prepare(
      `INSERT INTO llm_usage_logs
         (user_id, analysis_id, provider, model, prompt_version, request_type,
          input_tokens, output_tokens, total_tokens, estimated_cost_usd, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId, analysisId, provider, model, promptVersion, requestType,
      input, output, total, cost, status, error ? String(error).slice(0, 500) : null,
    );
    return r.lastInsertRowid;
  } catch (e) {
    console.warn('[llm-usage] failed to record:', e.message);
    return null;
  }
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
