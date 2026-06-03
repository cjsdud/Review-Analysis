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

// 요청 유형별 모델 — OPENAI_<ROLE>_MODEL env 우선, 없으면 LLM_MODEL fallback,
// 그래도 없으면 provider 기본값. 관리자 로그에 requestType 별 model 이 정확히
// 기록되도록 호출 시 명시적으로 골라 쓴다.
const ROLE_MODELS = {
  review:    process.env.OPENAI_REVIEW_MODEL    || MODEL,
  summary:   process.env.OPENAI_SUMMARY_MODEL   || MODEL,
  precision: process.env.OPENAI_PRECISION_MODEL || MODEL,
  csReply:   process.env.OPENAI_CS_REPLY_MODEL  || MODEL,
};
export function modelForRole(role) {
  return ROLE_MODELS[role] || MODEL || '';
}

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

// 호출 단위 상태 — 가장 최근 tryLLM 의 결과.
//   'idle'     : 아직 호출 안 됨
//   'ok'       : 실제 LLM 이 의미 있는 결과를 줌
//   'fallback' : 호출은 했지만 실패/파싱불가 → mock 응답으로 떨어짐 (예: openai 429)
//   'skipped'  : aiMode=mock 또는 authDisabled 라서 호출 자체를 안 함
// 분석 단위 누적 카운트도 함께 — runAnalysis 같은 한 트랜잭션이 끝났을 때
// "정말 OpenAI 가 호출됐는지" 를 정확하게 보여주기 위해.
let lastCallStatus = 'idle';
let lastCallError = null;
let lastCallModel = null;
let sessionStats = { realCalls: 0, fallbacks: 0, skipped: 0, lastError: null };
function setCallStatus(status, error = null) {
  lastCallStatus = status;
  lastCallError = error;
  if (status === 'ok') sessionStats.realCalls++;
  else if (status === 'fallback') {
    sessionStats.fallbacks++;
    if (error) sessionStats.lastError = error;
  } else if (status === 'skipped') sessionStats.skipped++;
}
export function resetSessionStats() {
  sessionStats = { realCalls: 0, fallbacks: 0, skipped: 0, lastError: null };
  lastCallStatus = 'idle';
  lastCallError = null;
}

const SYSTEM =
  '너는 한국 패션 이커머스 리뷰 분석 도우미다. 항상 지시한 JSON만 출력한다. 코드블록(```), 주석, 설명 문장을 덧붙이지 않는다.';

// CS 답글 말투 5 종 — 프론트 segmented 컨트롤이 toneLabel 을 그대로 보여준다.
// LLM 이 '기본/정중/친근' 같은 legacy 한글 라벨을 줘도 normalizeReplyTone 에서 흡수.
export const REPLY_TONE_LABELS = {
  polite: '정중한 말투',
  friendly: '친근한 말투',
  concise: '간결한 말투',
  empathetic: '공감형 말투',
  professional: '전문적인 말투',
};
const REPLY_TONE_LEGACY = {
  // 한글 legacy 매핑 — 구버전 데이터/응답 호환.
  기본: 'polite',
  정중: 'polite',
  친근: 'friendly',
  간결: 'concise',
  공감: 'empathetic',
  전문: 'professional',
};
export function normalizeReplyTone(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (REPLY_TONE_LABELS[raw]) return raw;
  if (REPLY_TONE_LEGACY[value?.trim?.()]) return REPLY_TONE_LEGACY[value.trim()];
  return 'polite';
}

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
// model 은 ROLE_MODELS 에서 결정된 실제 호출 모델. 호출 직후 lastCallModel 에 저장되어
// recordLlmUsage 가 정확한 모델명을 llm_usage_logs 에 남긴다.
async function callLLM(prompt, { system = SYSTEM, model } = {}) {
  if (aiMode === 'mock' || authDisabled) throw new Error('MOCK_MODE');
  const m = model || MODEL;
  lastCallModel = m;
  if (aiMode === 'openai') return callOpenAI(prompt, system, m);
  if (aiMode === 'gemini') return callGemini(prompt, system, m);
  if (aiMode === 'claude') return callClaude(prompt, system, m);
  throw new Error(`unsupported provider: ${aiMode}`);
}

function flagAuth(status) {
  if (status === 401 || status === 403) authDisabled = true;
}

async function callOpenAI(prompt, system, model) {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
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

async function callGemini(prompt, system, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
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

async function callClaude(prompt, system, model) {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
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
// 호출 결과는 lastCallStatus / sessionStats 에 정확히 기록되어 관리자 로그가
// "openaiCalled=true 인데 token=0" 처럼 거짓말하지 않도록 한다.
async function tryLLM(prompt, pick, { role = 'review' } = {}) {
  if (aiMode === 'mock' || authDisabled) {
    setCallStatus('skipped');
    return null;
  }
  resetLastUsage();
  const model = modelForRole(role);
  try {
    const raw = await callLLM(prompt, { model });
    const parsed = parseJsonSafe(raw, null);
    const result = pick(parsed);
    if (result == null) {
      // 응답은 받았지만 파싱/검증 실패 → fallback 으로 본다.
      setCallStatus('fallback', `${aiMode} parse_failed`);
      return null;
    }
    setCallStatus('ok');
    return result;
  } catch (e) {
    console.warn(`[aiClient:${aiMode}] fallback (${e.message})`);
    setCallStatus('fallback', `${aiMode} ${e.message}`);
    return null;
  }
}

// ===================================================================
// 1) 애매한 리뷰 분류
//    입력: reviews([{id, content}]), categories(string[])
//    출력: [{ reviewId, categories:[{name, issue, confidence}] }]
// ===================================================================
export async function classifyAmbiguousReviews(reviews, categories) {
  const llm = await tryLLM(
    buildClassifyPrompt(reviews, categories),
    (parsed) => {
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.results) ? parsed.results : null;
      if (!arr || !arr.length) return null;
      return arr
        .filter((x) => x && x.reviewId)
        .map((x) => normalizeClassifyResult(x));
    },
    { role: 'precision' },
  );
  return llm || mockClassify(reviews);
}

// LLM 응답 한 건 정규화 — 새 schema (sentiment / mentionedAspects /
// improvementIssues / needsReply) 를 기본으로 받고, 구 schema (categories)
// 도 호환 허용. 어떤 모양이 들어와도 다운스트림은 두 배열을 안정적으로 본다.
function normalizeClassifyResult(x) {
  const id = x.reviewId;
  const sentiment = ['positive', 'neutral', 'negative', 'mixed'].includes(x.sentiment) ? x.sentiment : null;
  const confidence = typeof x.confidence === 'number' ? x.confidence : null;
  const mentionedAspects = Array.isArray(x.mentionedAspects)
    ? x.mentionedAspects
        .filter((a) => a && (a.category || a.categoryLabel))
        .map((a) => ({
          category: a.category || a.categoryLabel,
          categoryLabel: a.categoryLabel || a.category,
          sentiment: ['positive', 'neutral', 'negative', 'mixed'].includes(a.sentiment) ? a.sentiment : 'neutral',
        }))
    : [];
  let improvementIssues = Array.isArray(x.improvementIssues)
    ? x.improvementIssues
        .filter((i) => i && (i.issueLabel || i.category))
        .map((i) => ({
          category: i.category || i.categoryLabel || '기타',
          categoryLabel: i.categoryLabel || i.category || '기타',
          issueLabel: i.issueLabel || `${i.category || ''} 관련 의견`,
          severity: ['low', 'medium', 'high'].includes(i.severity) ? i.severity : 'medium',
          evidence: (i.evidence || '').slice(0, 140),
          confidence: typeof i.confidence === 'number' ? i.confidence : (confidence ?? 0.7),
        }))
    : [];
  // 구 schema fallback — `categories: [{name, issue, confidence}]` 만 줬을 때
  // improvementIssues 로 흡수. (mentionedAspects 로는 절대 넣지 않음)
  if (improvementIssues.length === 0 && Array.isArray(x.categories)) {
    improvementIssues = x.categories
      .filter((c) => c && c.name)
      .map((c) => ({
        category: c.name,
        categoryLabel: c.name,
        issueLabel: c.issue || `${c.name} 관련 의견`,
        severity: ['low', 'medium', 'high'].includes(c.severity) ? c.severity : 'medium',
        evidence: '',
        confidence: typeof c.confidence === 'number' ? c.confidence : 0.7,
      }));
  }
  return {
    reviewId: id,
    sentiment,
    confidence,
    mentionedAspects,
    improvementIssues,
    needsReply: x.needsReply === true,
  };
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
  }, { role: 'summary' });
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
  }, { role: 'summary' });
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
        tone: normalizeReplyTone(t.tone),
        toneLabel: REPLY_TONE_LABELS[normalizeReplyTone(t.tone)] || '정중한 말투',
        template: t.template.trim(),
      }));
    return out.length ? out : null;
  }, { role: 'csReply' });
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
  }, { role: 'summary' });
  return llm || mockMonthly(overallSummary);
}

// ===================================================================
// Mock 헬퍼 (실제 응답과 동일한 형태 유지)
// ===================================================================
function mockClassify(reviews) {
  // 새 schema 와 동일한 모양으로 — 룰 기반 결과와 호환되도록 빈 양쪽 배열.
  return reviews.map((r) => normalizeClassifyResult({
    reviewId: r.id,
    sentiment: null,
    confidence: 0.4,
    mentionedAspects: [],
    improvementIssues: [],
    needsReply: false,
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
// 새 schema — mentionedAspects(언급) vs improvementIssues(실제 개선 신호) 를
// 명시적으로 분리해서 받는다. 칭찬 맥락이 improvementIssues 로 새는 것을 막기
// 위해 LLM 지시를 강하게 둔다 (스펙 PART 3 의 원칙 그대로).
function buildClassifyPrompt(reviews, categories) {
  return [
    '너는 패션 리뷰 분석기다. 한국 의류 리뷰에서 "언급된 항목" 과 "실제 개선이 필요한 문제" 를 구분한다.',
    `카테고리(name 후보): ${categories.join(', ')}`,
    '',
    '아래 원칙을 반드시 지킨다:',
    '1) 상품 속성이 언급되었다고 해서 improvementIssues 에 넣지 마라.',
    '2) 칭찬 맥락이면 mentionedAspects 에만 넣어라.',
    '3) improvementIssues 는 실제 불만/아쉬움/불편/결함/기대와의 차이가 있을 때만.',
    '4) "핏이 예뻐요" / "색감 좋아요" / "재질 좋아요" / "배송 빨라요" / "가성비 좋아요" 는 improvementIssues 가 아니다.',
    '5) 긍정 리뷰 안에서도 낮은 severity 의 개선 이슈는 가능하다.',
    '6) improvementIssues 가 있다고 무조건 sentiment=negative 로 분류하지 마라.',
    '7) severity 는 low / medium / high 셋 중 하나.',
    '8) sentiment 는 positive / neutral / negative / mixed 중 하나.',
    '',
    '반드시 아래 JSON 객체만 출력한다 (다른 텍스트 금지):',
    JSON.stringify({
      results: [{
        reviewId: 'string',
        sentiment: 'positive|neutral|negative|mixed',
        confidence: 0.0,
        mentionedAspects: [{ category: 'string', categoryLabel: 'string', sentiment: 'positive|neutral|negative|mixed' }],
        improvementIssues: [{ category: 'string', categoryLabel: 'string', issueLabel: 'string', severity: 'low|medium|high', evidence: 'string', confidence: 0.0 }],
        needsReply: false,
      }],
    }),
    '',
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
    '너는 패션 쇼핑몰 CS 담당자다. 아래 이슈에 대한 답글 초안을 5 가지 말투(tone)로 각각 작성한다.',
    '',
    'tone 별 작성 기준 (반드시 문장 길이 / 시작 문장 / 어휘가 분명히 달라야 한다):',
    '- polite       : 정중한 기본 고객센터 톤. 안정적, 사과 1회, 2~3 문장.',
    '- friendly     : 부드럽고 가까운 톤. 너무 딱딱한 표현 회피. 이모지는 쓰지 않는다.',
    '- concise      : 짧고 명확. 1~2 문장. 군더더기 없음.',
    '- empathetic   : 고객 불편을 먼저 인정. 아쉬웠던 지점을 구체적으로 언급. 부정 리뷰에 적합.',
    '- professional : 공식 브랜드 응대. 차분, 검토/개선 절차 중심. 과한 감정 표현은 없다.',
    '',
    '공통 규칙:',
    '- "반드시 개선하겠습니다" 처럼 확정적 약속 대신 "개선에 참고하겠습니다 / 검토하겠습니다" 처럼 안전하게.',
    '- 긍정 맥락엔 불필요한 사과 금지.',
    '- 답글 본문에 issueLabel 을 따옴표로 그대로 인용하지 말 것.',
    '',
    '반드시 아래 JSON 만 출력한다 (다른 텍스트 금지):',
    '{"templates":[{"issueLabel":"...","tone":"polite|friendly|concise|empathetic|professional","template":"..."}]}',
    '',
    JSON.stringify(issueSummary),
  ].join('\n');
}

// default export 는 getter 로 lastUsage / lastCallStatus / sessionStats 를 노출 —
// 호출 측이 항상 최신 값을 본다.
// (let 으로 재할당되는 값은 import 후 ref 가 stale 될 수 있어 getter 로 wrap).
export default {
  aiMode,
  classifyAmbiguousReviews,
  generateIssueLabel,
  generateProductImprovementReport,
  generateReplyTemplates,
  generateMonthlyReport,
  resetSessionStats,
  modelForRole,
  get lastUsage()      { return lastUsage; },
  get lastCallStatus() { return lastCallStatus; },
  get lastCallError()  { return lastCallError; },
  get lastCallModel()  { return lastCallModel; },
  get sessionStats()   { return sessionStats; },
};
