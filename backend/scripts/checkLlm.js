// 실제 LLM provider 연결 점검.
// - LLM_PROVIDER=mock → 호출 없이 종료
// - openai/gemini/claude → 간단한 JSON 응답 테스트, 실패해도 프로세스를 죽이지 않음
// 실행: npm run check:llm
import 'dotenv/config';

const PROVIDER = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || 'mock').toLowerCase();
const GENERIC_KEY = process.env.LLM_API_KEY || process.env.AI_API_KEY || '';
const KEY_BY_PROVIDER = {
  openai: process.env.OPENAI_API_KEY || GENERIC_KEY,
  gemini: process.env.GEMINI_API_KEY || GENERIC_KEY,
  claude: process.env.ANTHROPIC_API_KEY || GENERIC_KEY,
};
const KEY_ENV_NAME = {
  openai: 'OPENAI_API_KEY (또는 LLM_API_KEY)',
  gemini: 'GEMINI_API_KEY (또는 LLM_API_KEY)',
  claude: 'ANTHROPIC_API_KEY (또는 LLM_API_KEY)',
};
const DEFAULT_MODEL = { openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash', claude: 'claude-sonnet-4-6' };
const MODEL = process.env.LLM_MODEL || process.env.AI_MODEL || DEFAULT_MODEL[PROVIDER] || '';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 20000);
const KEY = KEY_BY_PROVIDER[PROVIDER];

const PROMPT =
  '아래 형식의 JSON만 출력하라. 다른 설명은 금지.\n{"ok":true,"provider":"' + PROVIDER + '"}';
const SYSTEM = '너는 JSON만 출력한다. 코드블록도 설명도 금지.';

function info(msg) {
  console.log(`[check:llm] ${msg}`);
}
function warn(msg) {
  console.warn(`[check:llm] ⚠ ${msg}`);
}

function parseJsonSafe(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* noop */
      }
    }
    return null;
  }
}

async function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callOpenAI() {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: PROMPT },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${SYSTEM}\n\n${PROMPT}` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callClaude() {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: 'user', content: PROMPT }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

const CALLERS = { openai: callOpenAI, gemini: callGemini, claude: callClaude };

async function main() {
  info(`provider=${PROVIDER}, model=${MODEL || '(미지정)'}`);

  if (PROVIDER === 'mock') {
    info('mock mode, skip real LLM call');
    info('  → 실제 provider 점검이 필요하면 .env에 LLM_PROVIDER=openai|gemini|claude 와 해당 키를 설정하세요.');
    return;
  }

  const caller = CALLERS[PROVIDER];
  if (!caller) {
    warn(`지원하지 않는 provider: ${PROVIDER} (mock|openai|gemini|claude 중 하나)`);
    warn('mock fallback will be used in app');
    return;
  }

  if (!KEY) {
    warn(`${PROVIDER} provider 키가 비어 있습니다. 필요 환경변수: ${KEY_ENV_NAME[PROVIDER]}`);
    warn('mock fallback will be used in app');
    return;
  }

  info(`실제 호출 시도 → ${PROVIDER} (timeout ${TIMEOUT_MS}ms)`);
  let raw;
  try {
    raw = await caller();
  } catch (e) {
    warn(`호출 실패: ${e.message}`);
    warn('mock fallback will be used in app');
    return;
  }

  info(`raw response (first 200 chars): ${(raw || '').slice(0, 200)}`);
  const parsed = parseJsonSafe(raw);
  if (!parsed) {
    warn('JSON 파싱 실패 — 응답이 JSON 형식이 아니거나 비어 있습니다.');
    warn('mock fallback will be used in app');
    return;
  }

  const okShape = parsed.ok === true && parsed.provider === PROVIDER;
  if (okShape) {
    info(`✓ JSON 파싱 성공 + 기대 형식 일치: ${JSON.stringify(parsed)}`);
  } else {
    info(`✓ JSON 파싱은 성공, 다만 형식이 기대와 다름: ${JSON.stringify(parsed)}`);
    info('  (앱에서는 함수별 검증 로직이 실패 시 mock fallback)');
  }
}

main().catch((e) => {
  warn(`예기치 못한 오류: ${e.message}`);
  warn('mock fallback will be used in app');
});
