// LLM 추상화 모듈.
// LLM_PROVIDER(mock|openai|gemini|claude)로 provider를 고르고,
// 키가 없거나 호출/파싱이 실패하면 항상 mock 응답으로 안전하게 fallback 한다.
// 모든 provider 응답은 JSON으로 파싱하며, 파싱/검증 실패 시 mock 기본값을 반환한다.
import { buildReplyTemplates } from './replyTemplates.service.js';

// ---------- provider / key / model 해석 ----------
const PROVIDER = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || 'mock').toLowerCase();
const GENERIC_KEY = process.env.LLM_API_KEY || process.env.AI_API_KEY || '';
const KEYS = {
  openai: process.env.OPENAI_API_KEY || GENERIC_KEY,
  gemini: process.env.GEMINI_API_KEY || GENERIC_KEY,
  claude: process.env.ANTHROPIC_API_KEY || GENERIC_KEY,
};
const DEFAULT_MODEL = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  claude: 'claude-sonnet-4-6',
};
const SUPPORTED = ['openai', 'gemini', 'claude'];
const API_KEY = KEYS[PROVIDER] || '';
const MODEL = process.env.LLM_MODEL || process.env.AI_MODEL || DEFAULT_MODEL[PROVIDER] || '';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 20000);

// 실제 호출 가능한 provider + 키가 있으면 그 이름, 아니면 'mock'
export const aiMode = SUPPORTED.includes(PROVIDER) && API_KEY ? PROVIDER : 'mock';

// 인증 실패(401/403)가 한 번 발생하면 이후 호출은 곧장 mock 으로 (불필요한 재시도/비용 방지)
let authDisabled = false;

// 마지막 LLM 호출의 token usage — recordLlmUsage 가 읽어 llm_usage_logs 에 저장한다.
// provider 별 응답 schema 차이를 한 곳에서 흡수 (OpenAI=usage, Gemini=usageMetadata, Claude=usage).
// mock/rule 호출이거나 응답에 usage 가 없으면 0 으로 리셋된다.
export let lastUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
function setLastUsage(input, output) {
  const i = Number(input) || 0;
  const o = Number(output) || 0;
  lastUsage = { inputTokens: i, outputTokens: o, totalTokens: i + o };
}
function resetLastUsage() {
  lastUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

const SYSTEM =
  '너는 한국 패션 이커머스 리뷰 분석 도우미다. 항상 지시한 JSON만 출력한다. 코드블록(```), 주석, 설명 문장을 덧붙이지 않는다.';

// ---------- JSON 안전 파싱 ----------
// 입력: text(string). 출력: 파싱된 값 또는 fallback. 코드블록/잡텍스트가 섞여도 첫 JSON 블록을 추출 시도.
function parseJsonSafe(text, fallback) {
  if (typeof text !== 'string') return fallback;
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* noop */
      }
    }
    return fallback;
  }
}

// ---------- 공용 호출 ----------
async function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// provider별 호출 → 모델이 생성한 텍스트(JSON 문자열) 반환. 실패 시 throw(상위에서 mock fallback).
async function callLLM(prompt, { system = SYSTEM } = {}) {
  if (aiMode === 'mock' || authDisabled) throw new Error('MOCK_MODE');
  if (aiMode === 'openai') return callOpenAI(prompt, system);
  if (aiMode === 'gemini') return callGemini(prompt, system);
  if (aiMode === 'claude') return callClaude(prompt, system);
  throw new Error(`unsupported provider: ${aiMode}`);
}

function flagAuth(status) {
  if (status === 401 || status === 403) authDisabled = true;
}

async function callOpenAI(prompt, system) {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    flagAuth(res.status);
    throw new Error(`openai ${res.status}`);
  }
  const data = await res.json();
  setLastUsage(data?.usage?.prompt_tokens, data?.usage?.completion_tokens);
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(prompt, system) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${system}\n\n${prompt}` }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    flagAuth(res.status);
    throw new Error(`gemini ${res.status}`);
  }
  const data = await res.json();
  setLastUsage(data?.usageMetadata?.promptTokenCount, data?.usageMetadata?.candidatesTokenCount);
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callClaude(prompt, system) {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.3,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    flagAuth(res.status);
    throw new Error(`claude ${res.status}`);
  }
  const data = await res.json();
  setLastUsage(data?.usage?.input_tokens, data?.usage?.output_tokens);
  return data.content?.[0]?.text ?? '';
}

// 실제 호출 → 파싱 → 검증. 어떤 단계든 실패하면 null 반환(호출부가 mock 사용).
// 입력: prompt(string), pick(parsed→결과|null). 출력: 결과 또는 null.
async function tryLLM(prompt, pick) {
  if (aiMode === 'mock' || authDisabled) return null;
  // 매 호출 직전에 lastUsage 리셋 — 직전 호출의 값이 남지 않도록.
  resetLastUsage();
  try {
    const raw = await callLLM(prompt);
    const parsed = parseJsonSafe(raw, null);
    const result = pick(parsed);
    return result ?? null;
  } catch (e) {
    console.warn(`[aiClient:${aiMode}] fallback (${e.message})`);
    return null;
  }
}

// ===================================================================
// 1) 애매한 리뷰 분류
//    입력: reviews([{id, content}]), categories(string[])
//    출력: [{ reviewId, categories:[{name, issue, confidence}] }]
// ===================================================================
export async function classifyAmbiguousReviews(reviews, categories) {
  const llm = await tryLLM(buildClassifyPrompt(reviews, categories), (parsed) => {
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : null;
    if (!arr || !arr.length) return null;
    return arr
      .filter((x) => x && x.reviewId)
      .map((x) => ({ reviewId: x.reviewId, categories: Array.isArray(x.categories) ? x.categories : [] }));
  });
  return llm || mockClassify(reviews);
}

// ===================================================================
// 2) 이슈 묶음 라벨 생성
//    입력: category(string), reviews(string[]). 출력: 라벨 문자열.
// ===================================================================
export async function generateIssueLabel(category, reviews) {
  const prompt = `다음은 "${category}" 카테고리에 묶인 리뷰들이다. 공통 불만을 한국어 16자 이내 한 줄 라벨로 요약하라. JSON {"label":"..."} 만 출력.\n${reviews
    .slice(0, 8)
    .join('\n')}`;
  const llm = await tryLLM(prompt, (parsed) => {
    const label = typeof parsed?.label === 'string' ? parsed.label.trim() : '';
    return label ? label.slice(0, 30) : null;
  });
  return llm || `${category} 관련 의견`;
}

// ===================================================================
// 3) 상품별 개선 리포트
//    입력: productSummary({productName, totalReviews, negativeReviews, negativeRatio, topIssues})
//    출력: { detailPageActions:string[], summary:string }
// ===================================================================
export async function generateProductImprovementReport(productSummary) {
  const fallback = mockProductReport(productSummary);
  const llm = await tryLLM(buildReportPrompt(productSummary), (parsed) => {
    if (!parsed) return null;
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null;
    if (!summary) return null;
    const detailPageActions = Array.isArray(parsed.detailPageActions)
      ? parsed.detailPageActions.filter((a) => typeof a === 'string' && a.trim())
      : fallback.detailPageActions;
    return { detailPageActions: detailPageActions.length ? detailPageActions : fallback.detailPageActions, summary };
  });
  return llm || fallback;
}

// ===================================================================
// 4) 이슈별 답글 템플릿 (기본/정중/친근)
//    입력: issueSummary({category, issueLabel}). 출력: [{issueLabel, tone, template}]
// ===================================================================
export async function generateReplyTemplates(issueSummary) {
  // 정책 가드 — generic / positive / non-actionable 이슈는 답글 자체를 만들지 않는다.
  // (UI 단의 필터와 별개로 백엔드에서도 한 번 더 차단)
  const ruleBased = buildReplyTemplates(issueSummary);
  if (!ruleBased.length) return [];

  const llm = await tryLLM(buildReplyPrompt(issueSummary), (parsed) => {
    const arr = Array.isArray(parsed?.templates) ? parsed.templates : Array.isArray(parsed) ? parsed : null;
    if (!arr || !arr.length) return null;
    const out = arr
      .filter((t) => t && typeof t.template === 'string' && t.template.trim())
      // LLM 출력이 issueLabel 을 따옴표로 그대로 노출하면 거부 — 규칙 기반으로 fallback.
      .filter((t) => {
        const lbl = (issueSummary?.issueLabel || '').trim();
        if (!lbl) return true;
        const lit = new RegExp(`['"\\u2018\\u2019\\u201C\\u201D]\\s*${escapeRegex(lbl)}\\s*['"\\u2018\\u2019\\u201C\\u201D]`);
        return !lit.test(t.template);
      })
      .map((t) => ({
        issueLabel: t.issueLabel || issueSummary.issueLabel || '',
        tone: t.tone || '기본',
        template: t.template.trim(),
      }));
    return out.length ? out : null;
  });
  return llm || ruleBased;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===================================================================
// 5) 전체/월간 요약
//    입력: overallSummary({totalReviews, negativeReviews, negativeRatio, topCategories})
//    출력: { summary:string }
// ===================================================================
export async function generateMonthlyReport(overallSummary) {
  const prompt = `다음 요약 데이터로 패션 셀러를 위한 3문장 운영 코멘트를 작성하라. JSON {"summary":"..."} 만 출력.\n${JSON.stringify(
    overallSummary,
  )}`;
  const llm = await tryLLM(prompt, (parsed) => {
    const summary = typeof parsed?.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null;
    return summary ? { summary } : null;
  });
  return llm || mockMonthly(overallSummary);
}

// ===================================================================
// Mock 헬퍼 (실제 응답과 동일한 형태 유지)
// ===================================================================
function mockClassify(reviews) {
  return reviews.map((r) => ({
    reviewId: r.id,
    categories: [{ name: '기타', issue: null, confidence: 0.4 }],
  }));
}

function mockMonthly(overallSummary) {
  const { totalReviews, negativeReviews, negativeRatio = 0, topCategories = [] } = overallSummary;
  const pct = Math.round((negativeRatio || negativeReviews / Math.max(totalReviews, 1)) * 100);
  const topNames = topCategories
    .filter((c) => c.name !== '기타')
    .slice(0, 3)
    .map((c) => c.name)
    .join(', ');
  return {
    summary: `총 ${totalReviews}건 리뷰 중 ${negativeReviews}건(${pct}%)에서 불만이 확인됐습니다. 불만은 주로 ${
      topNames || '특정 없음'
    } 영역에 집중돼 있어, 해당 영역의 상세페이지 보강과 출고 검수를 우선 점검하길 권합니다.`,
  };
}

function mockProductReport(productSummary) {
  const { productName, topIssues = [] } = productSummary;
  const detailPageActions = [...new Set(topIssues.map((i) => i.recommendedAction).filter(Boolean))];

  if (!topIssues.length) {
    return {
      detailPageActions,
      summary: `${productName}는 반복되는 불만이 거의 없습니다. 긍정 리뷰를 상세페이지 상단에 노출해 구매 전환을 높여보세요.`,
    };
  }

  const top = topIssues[0];
  const pct = Math.round((top.ratio || 0) * 100);
  const others = topIssues.slice(1, 3).map((i) => i.issueLabel).filter(Boolean);
  let summary = `'${productName}'에서 가장 많이 지적된 점은 '${top.issueLabel}'(으)로, 전체 리뷰의 약 ${pct}%(${top.count}건)에서 언급됐습니다.`;
  if (others.length) summary += ` 이어서 ${others.map((o) => `'${o}'`).join(', ')} 의견도 반복적으로 나타납니다.`;
  summary += ' 상세페이지에 관련 정보를 보강하고 출고 검수를 강화하면 반품·문의를 줄일 수 있습니다.';
  return { detailPageActions, summary };
}

// (mockReplyTemplates / REPLY_PROMISE 는 replyTemplates.service.js 로 이동)

// ---------- 프롬프트 빌더 ----------
function buildClassifyPrompt(reviews, categories) {
  return [
    '너는 패션 리뷰 분류기다. 아래 카테고리 중에서만 라벨링한다.',
    `카테고리: ${categories.join(', ')}`,
    '각 리뷰는 여러 카테고리에 속할 수 있다(multi-label). 불만이 없으면 categories를 빈 배열로 둔다.',
    '반드시 아래 JSON 객체만 출력한다.',
    '{"results":[{"reviewId":"...","categories":[{"name":"사이즈","issue":"허리가 작음","confidence":0.8}]}]}',
    '리뷰:',
    JSON.stringify(reviews),
  ].join('\n');
}

function buildReportPrompt(productSummary) {
  return [
    '너는 패션 셀러 컨설턴트다. 아래 상품 불만 요약으로 상세페이지 개선안을 제안한다.',
    'detailPageActions는 구체적 실행 문장 3~5개, summary는 2~3문장.',
    '반드시 JSON {"detailPageActions":["..."],"summary":"..."} 만 출력.',
    JSON.stringify(productSummary),
  ].join('\n');
}

function buildReplyPrompt(issueSummary) {
  return [
    '너는 패션 쇼핑몰 CS 담당자다. 아래 이슈에 대한 답글 초안을 기본/정중/친근 3가지 말투로 작성한다.',
    '각 답글은 2~3문장, 사과 + 구체적 개선 약속을 포함한다.',
    '반드시 JSON {"templates":[{"issueLabel":"...","tone":"기본","template":"..."}]} 만 출력.',
    JSON.stringify(issueSummary),
  ].join('\n');
}

// default export 는 getter 로 lastUsage 를 노출 — 호출 측이 항상 최신 값을 본다.
// (let 으로 재할당되는 값은 import 후 ref 가 stale 될 수 있어 getter 로 wrap).
export default {
  aiMode,
  classifyAmbiguousReviews,
  generateIssueLabel,
  generateProductImprovementReport,
  generateReplyTemplates,
  generateMonthlyReport,
  get lastUsage() { return lastUsage; },
};
