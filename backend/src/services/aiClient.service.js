// LLM API 추상화. API_KEY 없으면 mock 응답으로 동작.
// OpenAI/Gemini/Claude 중 하나로 쉽게 교체 가능하도록 provider 분기.

const PROVIDER = (process.env.AI_PROVIDER || 'mock').toLowerCase();
const API_KEY = process.env.AI_API_KEY || '';
const MODEL = process.env.AI_MODEL || '';

export const aiMode = !API_KEY || PROVIDER === 'mock' ? 'mock' : PROVIDER;

// ---------- 공용 호출부 (실제 provider 연동 지점) ----------
async function callLLM(prompt, { json = true } = {}) {
  if (aiMode === 'mock') {
    throw new Error('MOCK_MODE'); // 각 함수에서 mock 으로 처리
  }
  // TODO: provider 별 실제 호출. 아래는 OpenAI 호환 예시 스텁.
  // const res = await fetch('https://api.openai.com/v1/chat/completions', {...})
  // return parseJsonSafe(res...)
  throw new Error(`provider ${aiMode} not implemented; set AI_PROVIDER=mock`);
}

// JSON 파싱 실패 시 fallback
function parseJsonSafe(text, fallback) {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
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

// ===================================================================
// 1) 애매한 리뷰 분류
// ===================================================================
export async function classifyAmbiguousReviews(reviews, categories) {
  if (aiMode === 'mock') {
    return reviews.map((r) => ({
      reviewId: r.id,
      categories: [{ name: '기타', issue: null, confidence: 0.4 }],
    }));
  }
  const prompt = buildClassifyPrompt(reviews, categories);
  const raw = await callLLM(prompt).catch(() => null);
  const parsed = parseJsonSafe(raw, null);
  if (!parsed || !Array.isArray(parsed)) {
    return reviews.map((r) => ({ reviewId: r.id, categories: [{ name: '기타', confidence: 0.4 }] }));
  }
  return parsed;
}

// ===================================================================
// 2) 이슈 묶음 라벨 생성
// ===================================================================
export async function generateIssueLabel(category, reviews) {
  if (aiMode === 'mock') {
    return `${category} 관련 반복 의견`;
  }
  const prompt = `다음은 "${category}" 카테고리 리뷰들이다. 공통 불만을 한국어 12자 이내 한 문장 라벨로 요약. JSON {"label":"..."} 만 출력.\n${reviews.join('\n')}`;
  const raw = await callLLM(prompt).catch(() => null);
  return parseJsonSafe(raw, { label: `${category} 관련 의견` }).label;
}

// ===================================================================
// 3) 상품별 개선 리포트 생성
// ===================================================================
export async function generateProductImprovementReport(productSummary) {
  if (aiMode === 'mock') {
    return mockProductReport(productSummary);
  }
  const prompt = buildReportPrompt(productSummary);
  const raw = await callLLM(prompt).catch(() => null);
  const parsed = parseJsonSafe(raw, null);
  return parsed || mockProductReport(productSummary);
}

// ===================================================================
// 4) 이슈별 답글 템플릿 생성
// ===================================================================
export async function generateReplyTemplates(issueSummary) {
  if (aiMode === 'mock') {
    return mockReplyTemplates(issueSummary);
  }
  const prompt = buildReplyPrompt(issueSummary);
  const raw = await callLLM(prompt).catch(() => null);
  const parsed = parseJsonSafe(raw, null);
  return parsed && Array.isArray(parsed.templates) ? parsed.templates : mockReplyTemplates(issueSummary);
}

// ===================================================================
// 5) 월간/전체 요약
// ===================================================================
export async function generateMonthlyReport(overallSummary) {
  if (aiMode === 'mock') {
    const { totalReviews, negativeReviews, negativeRatio = 0, topCategories = [] } = overallSummary;
    const pct = Math.round((negativeRatio || (negativeReviews / Math.max(totalReviews, 1))) * 100);
    const topNames = topCategories
      .filter((c) => c.name !== '기타')
      .slice(0, 3)
      .map((c) => c.name)
      .join(', ');
    return {
      summary: `총 ${totalReviews}건 리뷰 중 ${negativeReviews}건(${pct}%)에서 불만이 확인됐습니다. 불만은 주로 ${topNames || '특정 없음'} 영역에 집중돼 있어, 해당 영역의 상세페이지 보강과 출고 검수를 우선 점검하길 권합니다.`,
    };
  }
  const prompt = `다음 요약 데이터로 셀러를 위한 3문장 운영 코멘트를 작성. JSON {"summary":"..."} 만 출력.\n${JSON.stringify(overallSummary)}`;
  const raw = await callLLM(prompt).catch(() => null);
  return parseJsonSafe(raw, { summary: '분석 요약을 생성하지 못했습니다.' });
}

// ===================================================================
// Mock 헬퍼 (실제 응답 형태와 동일하게 유지)
// ===================================================================
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

// 카테고리별 구체적 개선 약속 (답글에 자연스럽게 삽입)
const REPLY_PROMISE = {
  사이즈: '사이즈 정보를 더 정확하게 안내드리도록 상세페이지를 보완하겠습니다',
  '핏/실루엣': '다양한 착용컷으로 실제 핏을 더 잘 보여드리겠습니다',
  '색상/화면 차이': '실물에 가까운 색상 컷과 안내를 추가하겠습니다',
  '소재/두께': '소재와 두께 정보를 더 상세히 기재하겠습니다',
  '마감/불량': '검수 과정을 강화하고, 원하시면 교환·반품을 바로 도와드리겠습니다',
  착용감: '착용감 관련 안내를 보완하겠습니다',
  '세탁/내구성': '세탁·관리 방법을 더 명확히 안내드리겠습니다',
  '배송/포장': '배송과 포장 과정을 점검해 개선하겠습니다',
  '가격/가성비': '가격에 걸맞은 가치를 드릴 수 있도록 노력하겠습니다',
  기타: '주신 의견을 꼼꼼히 반영하겠습니다',
};

function mockReplyTemplates(issueSummary) {
  const label = issueSummary.issueLabel || issueSummary.category || '불편하셨던 점';
  const promise = REPLY_PROMISE[issueSummary.category] || REPLY_PROMISE['기타'];
  const tones = {
    기본: `안녕하세요 고객님, 소중한 후기 감사합니다. '${label}' 관련해 불편을 드려 죄송합니다. ${promise}.`,
    정중: `안녕하세요 고객님, 먼저 불편을 드려 진심으로 죄송합니다. '${label}'에 대한 의견을 담당 부서에 전달했으며, ${promise}. 교환·반품이 필요하시면 언제든 편히 말씀해 주세요.`,
    친근: `고객님 안녕하세요! 후기 남겨주셔서 정말 감사해요 :) '${label}' 때문에 불편하셨다니 속상하네요. ${promise}! 다음엔 꼭 더 만족하실 수 있게 할게요.`,
  };
  return [
    { issueLabel: label, tone: '기본', template: tones.기본 },
    { issueLabel: label, tone: '정중', template: tones.정중 },
    { issueLabel: label, tone: '친근', template: tones.친근 },
  ];
}

// ---------- 프롬프트 빌더 (실제 연동 시 사용) ----------
function buildClassifyPrompt(reviews, categories) {
  return [
    '너는 패션 리뷰 분류기다. 아래 카테고리 중에서만 라벨링한다.',
    `카테고리: ${categories.join(', ')}`,
    '각 리뷰는 여러 카테고리에 속할 수 있다(multi-label).',
    '반드시 아래 JSON 배열만 출력. 설명 금지.',
    '[{"reviewId":"...","categories":[{"name":"사이즈","issue":"허리가 작음","confidence":0.8}]}]',
    '리뷰:',
    JSON.stringify(reviews),
  ].join('\n');
}

function buildReportPrompt(productSummary) {
  return [
    '너는 패션 셀러 컨설턴트다. 아래 상품 불만 요약으로 상세페이지 개선안을 제안한다.',
    '반드시 JSON {"detailPageActions":["..."],"summary":"..."} 만 출력.',
    JSON.stringify(productSummary),
  ].join('\n');
}

function buildReplyPrompt(issueSummary) {
  return [
    '너는 CS 담당자다. 아래 이슈에 대한 답글 초안을 기본/정중/친근 3가지 말투로 작성.',
    '반드시 JSON {"templates":[{"issueLabel":"...","tone":"기본","template":"..."}]} 만 출력.',
    JSON.stringify(issueSummary),
  ].join('\n');
}

export default {
  aiMode,
  classifyAmbiguousReviews,
  generateIssueLabel,
  generateProductImprovementReport,
  generateReplyTemplates,
  generateMonthlyReport,
};
