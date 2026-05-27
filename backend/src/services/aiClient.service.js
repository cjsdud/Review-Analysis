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
    const { totalReviews, negativeReviews, topCategories = [] } = overallSummary;
    const topNames = topCategories.slice(0, 3).map((c) => c.name).join(', ');
    return {
      summary: `총 ${totalReviews}건 리뷰 중 ${negativeReviews}건이 부정적입니다. 주요 불만은 ${topNames || '특이사항 없음'} 영역에 집중되어 있습니다. 해당 영역의 상세페이지 보강을 우선 검토하세요.`,
    };
  }
  const prompt = `다음 요약 데이터로 셀러를 위한 3문장 운영 코멘트를 작성. JSON {"summary":"..."} 만 출력.\n${JSON.stringify(overallSummary)}`;
  const raw = await callLLM(prompt).catch(() => null);
  return parseJsonSafe(raw, { summary: '분석 요약을 생성하지 못했습니다.' });
}

// ===================================================================
// Mock 헬퍼 (실제 응답 형태와 동일하게 유지)
// ===================================================================
function categoryAction(category) {
  const map = {
    사이즈: '상세페이지 상단에 실측 사이즈표(평균 오차 포함)와 모델 착용 사이즈를 명시하세요.',
    '핏/실루엣': '다양한 체형의 착용컷과 정면/측면/후면 사진을 추가하세요.',
    '색상/화면 차이': '자연광/실내조명 등 환경별 색상 비교컷과 "모니터에 따라 색상이 다를 수 있음" 안내를 추가하세요.',
    '소재/두께': '원단 두께·비침 여부·신축성 정보를 표로 정리하고 클로즈업 컷을 추가하세요.',
    '마감/불량': '출고 전 검수 기준을 강화하고, 교환/반품 절차 안내를 명확히 노출하세요.',
    착용감: '착용감 관련 소재 특성과 이너 착용 권장 여부를 안내하세요.',
    '세탁/내구성': '세탁 방법(손세탁/드라이 등)과 관리 주의사항을 상세페이지에 추가하세요.',
    '배송/포장': '평균 출고/배송 소요일과 포장 방식을 안내하고 구김 방지 포장을 검토하세요.',
    '가격/가성비': '제품의 차별점(소재/봉제 품질)을 강조하는 콘텐츠를 보강하세요.',
    기타: '반복 언급되는 의견을 모니터링하고 상세페이지 FAQ에 반영하세요.',
  };
  return map[category] || '상세페이지 안내 문구를 보강하세요.';
}

function mockProductReport(productSummary) {
  const { productName, topIssues = [] } = productSummary;
  const detailPageActions = topIssues.slice(0, 5).map((i) => categoryAction(i.category));
  const summary = topIssues.length
    ? `${productName}의 주요 불만은 ${topIssues.slice(0, 3).map((i) => i.issueLabel).join(', ')} 입니다. 상세페이지 보강과 검수 강화로 개선할 수 있습니다.`
    : `${productName}는 두드러진 반복 불만이 적습니다. 긍정 리뷰를 상세페이지에 노출해 전환을 높이세요.`;
  return { detailPageActions: [...new Set(detailPageActions)], summary };
}

function mockReplyTemplates(issueSummary) {
  const label = issueSummary.issueLabel || issueSummary.category || '불편';
  const tones = {
    기본: `안녕하세요 고객님, 소중한 후기 감사합니다. 말씀해주신 '${label}' 관련 내용 확인하여 개선에 반영하겠습니다. 불편을 드려 죄송합니다.`,
    정중: `안녕하세요 고객님, 먼저 불편을 드려 진심으로 죄송합니다. '${label}' 관련해 주신 의견은 담당 부서에 전달하여 신중히 검토하겠습니다. 교환/반품이 필요하시면 언제든 도와드리겠습니다.`,
    친근: `고객님 안녕하세요! 후기 남겨주셔서 정말 감사해요 :) '${label}' 부분 불편하셨다니 속상하네요. 더 좋은 상품으로 보답할 수 있도록 꼭 개선할게요!`,
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
