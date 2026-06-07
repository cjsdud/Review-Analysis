// 고객용 답글 초안 생성기 — issueLabel 을 그대로 노출하지 않고 자연스러운 표현으로 변환한다.
// LLM 없이 규칙 기반으로 생성하며, aiClient.generateReplyTemplates 의 mock 응답으로도 사용된다.
import {
  REPLY_TONES,
  REPLY_TONE_FULL_LABEL,
  DEFAULT_PRECOMPUTED_TONE,
  normalizeReplyTone,
} from '../constants/replyTones.js';

// 내부 분석 라벨 → 고객용 표현
const CUSTOMER_FACING_ISSUE_PHRASE = {
  // 사이즈
  '전반적으로 작게 나옴': '전체적인 사이즈감이 기대보다 작게 느껴지셨을 수 있을 것 같습니다',
  '전반적으로 크게 나옴': '전체적인 사이즈감이 기대보다 여유 있게 느껴지셨을 수 있을 것 같습니다',
  '허리가 작게 나옴': '허리 부분이 다소 타이트하게 느껴지셨을 수 있을 것 같습니다',
  '허리가 크게 나옴': '허리 부분이 다소 여유 있게 느껴지셨을 수 있을 것 같습니다',
  '어깨가 좁음': '어깨 부분이 다소 타이트하게 느껴지셨을 수 있을 것 같습니다',
  '어깨가 큼': '어깨 라인이 기대보다 여유 있게 느껴지셨을 수 있을 것 같습니다',
  '소매가 김': '소매 길이가 기대보다 길게 느껴지셨을 수 있을 것 같습니다',
  '소매가 짧음': '소매 길이가 기대보다 짧게 느껴지셨을 수 있을 것 같습니다',
  '기장이 김': '기장감이 기대보다 길게 느껴지셨을 수 있을 것 같습니다',
  '기장이 짧음': '기장감이 기대보다 짧게 느껴지셨을 수 있을 것 같습니다',
  '목 부분이 타이트함': '목 부분이 기대보다 타이트하게 느껴지셨을 수 있을 것 같습니다',
  '발볼이 좁음': '발볼이 기대보다 좁게 느껴지셨을 수 있을 것 같습니다',
  '신발이 큼': '신발 사이즈가 기대보다 크게 느껴지셨을 수 있을 것 같습니다',

  // 핏/실루엣
  '핏/실루엣이 기대와 다름': '실제 착용 핏이 기대와 다르게 느껴지셨을 수 있을 것 같습니다',
  '착용 시 부해 보임': '착용 시 실루엣이 기대와 다르게 느껴지셨을 수 있을 것 같습니다',

  // 색상/화면 차이
  '실물 색상이 화면보다 어두움': '받아보신 상품의 색감이 화면보다 어둡게 느껴지셨을 수 있을 것 같습니다',
  '실물 색상이 화면보다 밝음': '받아보신 상품의 색감이 화면보다 밝게 느껴지셨을 수 있을 것 같습니다',
  '실물 색상이 화면과 차이가 있음': '화면에서 보신 색감과 실제 색감에 차이가 느껴지셨을 수 있을 것 같습니다',
  '색상이 생각보다 어두움': '색감이 기대보다 어둡게 느껴지셨을 수 있을 것 같습니다',
  '사진과 색감 차이가 있음': '화면에서 보신 색감과 실제 색감에 차이가 느껴지셨을 수 있을 것 같습니다',

  // 소재/두께
  '원단이 얇고 비침이 있음': '원단 두께나 비침 정도가 기대와 달라 아쉬우셨을 수 있을 것 같습니다',
  '원단 비침이 있음': '원단의 비침 정도가 기대와 달라 아쉬우셨을 수 있을 것 같습니다',
  '원단이 얇음': '원단 두께가 기대보다 얇게 느껴지셨을 수 있을 것 같습니다',
  '원단이 두꺼움': '원단 두께감이 예상보다 두껍게 느껴지셨을 수 있을 것 같습니다',
  '원단이 까슬함': '원단의 촉감이 기대와 달라 아쉬우셨을 수 있을 것 같습니다',
  '원단이 뻣뻣함': '원단의 부드러움이 기대와 달라 아쉬우셨을 수 있을 것 같습니다',

  // 마감/불량
  '실밥/마감 처리가 미흡함': '마감 상태나 실밥 처리가 기대에 미치지 못해 아쉬우셨을 수 있을 것 같습니다',
  '지퍼·단추 등 부자재 불량': '부자재 작동이 매끄럽지 않아 불편을 드린 점 정말 죄송합니다',
  '터짐·구멍 등 봉제 불량': '봉제 상태가 좋지 않은 상품이 출고된 점 진심으로 죄송합니다',
  '마감 상태가 미흡함': '마감 상태가 기대에 미치지 못해 아쉬우셨을 수 있을 것 같습니다',
  '마감 상태가 아쉬움': '마감 상태가 기대에 미치지 못해 아쉬우셨을 수 있을 것 같습니다',
  '제품 불량(하자)': '하자가 있는 상품이 출고된 점 진심으로 죄송합니다',

  // 착용감
  '착용 시 따갑거나 가려움': '착용 시 피부 자극이 있어 불편하셨을 것 같습니다',
  '착용감이 답답함': '착용감이 다소 답답하게 느껴지셨을 수 있을 것 같습니다',
  '무게가 무거움': '무게감이 기대보다 무겁게 느껴지셨을 수 있을 것 같습니다',
  '착용감이 불편함': '착용감이 기대와 달라 아쉬우셨을 수 있을 것 같습니다',

  // 세탁/내구성
  '세탁 후 보풀이 생김': '세탁 후 보풀이나 원단 변화가 생겨 아쉬우셨을 수 있을 것 같습니다',
  '세탁 후 줄어듦': '세탁 후 사이즈 변화가 느껴져 불편하셨을 수 있을 것 같습니다',
  '세탁 후 늘어남/변형': '세탁 후 형태 변화가 생겨 아쉬우셨을 수 있을 것 같습니다',
  '세탁 시 물빠짐/이염': '세탁 시 색상 변화가 발생해 불편을 드린 점 정말 죄송합니다',

  // 배송/포장
  '배송 중 파손': '배송 과정에서 상품이 파손된 점 진심으로 죄송합니다',
  '구성품 누락': '구성품이 누락된 채로 배송된 점 진심으로 죄송합니다',
  '포장이 부실함(구김 등)': '상품 포장 상태가 기대에 미치지 못해 아쉬우셨을 수 있을 것 같습니다',
  '포장 상태가 아쉬움': '상품 포장 상태가 기대에 미치지 못해 아쉬우셨을 수 있을 것 같습니다',
  '배송이 지연됨': '상품을 기다리시는 동안 배송이 늦어져 불편하셨을 것 같습니다',

  // 가격/가성비
  '가격 대비 품질이 아쉬움': '가격 대비 품질이 기대에 미치지 못한다고 느끼셨을 수 있을 것 같습니다',
  '가격이 비쌈': '가격이 기대보다 부담스럽게 느껴지셨을 수 있을 것 같습니다',
};

// 카테고리별 fallback 표현 (이슈 라벨이 매핑 사전에 없을 때)
const CATEGORY_FALLBACK_PHRASE = {
  사이즈: '사이즈감이 기대와 달라 아쉬우셨을 수 있을 것 같습니다',
  '핏/실루엣': '실제 착용 핏이 기대와 달라 아쉬우셨을 수 있을 것 같습니다',
  '색상/화면 차이': '화면과 실제 색감에 차이가 느껴지셨을 수 있을 것 같습니다',
  '소재/두께': '원단이나 두께가 기대와 달라 아쉬우셨을 수 있을 것 같습니다',
  '마감/불량': '마감 상태가 기대에 미치지 못해 아쉬우셨을 수 있을 것 같습니다',
  착용감: '착용감이 기대와 달라 아쉬우셨을 수 있을 것 같습니다',
  '세탁/내구성': '세탁 후 변화가 느껴져 아쉬우셨을 수 있을 것 같습니다',
  '배송/포장': '배송이나 포장 과정에서 불편을 드린 점 죄송합니다',
  '가격/가성비': '가격 대비 만족도가 기대에 미치지 못한다고 느끼셨을 수 있을 것 같습니다',
  기타: '이용 중 아쉬운 점이 있으셨을 수 있을 것 같습니다',
};

// 강한 불편 이슈 — "죄송합니다" 사과 표현 사용
const STRONG_ISSUE_RE =
  /(불량|하자|파손|누락|지연|물빠짐|이염|봉제|찢|구멍|오배송|훼손|환불|반품)/;

// 추천 조치(내부 셀러 가이드) → 고객 답글용 약속 문장
const ACTION_PHRASE_MAP = [
  {
    re: /실측|모델.*키|키.*몸무게|사이즈표/,
    phrase: '앞으로는 실측 사이즈와 모델 착용 정보를 더 자세히 안내드리겠습니다',
  },
  {
    re: /모델 키|키별 기장|기장 가이드/,
    phrase: '앞으로는 모델 착용 정보와 키별 기장 안내를 더 자세히 제공해드리겠습니다',
  },
  {
    re: /색상.*비교|자연광|실내|색상 컷|색상 안내/,
    phrase: '앞으로는 자연광과 실내 조명에서의 색상 차이를 더 정확히 안내드리겠습니다',
  },
  {
    re: /비침|원단 두께|두께.*비침|이너/,
    phrase: '앞으로는 원단 두께와 비침 정도를 더 자세히 안내드리겠습니다',
  },
  {
    re: /검수|출고/,
    phrase: '앞으로는 출고 전 검수 기준을 더 강화하겠습니다',
  },
  {
    re: /세탁|관리|수축|손세탁|드라이/,
    phrase: '앞으로는 세탁·관리 방법을 더 명확히 안내드리겠습니다',
  },
  {
    re: /배송|포장|구김|완충/,
    phrase: '앞으로는 배송·포장 과정을 점검해 더 안전하게 보내드리겠습니다',
  },
];

const CATEGORY_DEFAULT_ACTION = {
  사이즈: '앞으로는 실측 사이즈와 모델 착용 정보를 더 자세히 안내드리겠습니다',
  '핏/실루엣': '앞으로는 다양한 착용 컷으로 실제 핏을 더 잘 보여드리겠습니다',
  '색상/화면 차이': '앞으로는 자연광과 실내 조명에서의 색상 차이를 더 정확히 안내드리겠습니다',
  '소재/두께': '앞으로는 원단 두께와 비침 정도를 더 자세히 안내드리겠습니다',
  '마감/불량': '앞으로는 출고 전 검수 기준을 더 강화하겠습니다',
  착용감: '앞으로는 착용감 관련 안내를 더 자세히 제공해드리겠습니다',
  '세탁/내구성': '앞으로는 세탁·관리 방법을 더 명확히 안내드리겠습니다',
  '배송/포장': '앞으로는 배송·포장 과정을 점검해 더 안전하게 보내드리겠습니다',
  '가격/가성비': '앞으로는 가격에 합당한 품질과 안내를 제공해드릴 수 있도록 노력하겠습니다',
  기타: '앞으로는 주신 의견을 꼼꼼히 반영하겠습니다',
};

// "관련 의견" 으로 끝나거나 빈 라벨은 generic — 답글 생성 안 함
const GENERIC_LABEL_RE = /관련 의견$/;

// 입력: issueLabel(string|null), category(string)
// 출력: 고객용 자연스러운 표현 문장(따옴표/issueLabel 직접 노출 없음)
export function getCustomerFacingIssuePhrase(issueLabel, category) {
  if (issueLabel && CUSTOMER_FACING_ISSUE_PHRASE[issueLabel]) {
    return CUSTOMER_FACING_ISSUE_PHRASE[issueLabel];
  }
  return CATEGORY_FALLBACK_PHRASE[category] || CATEGORY_FALLBACK_PHRASE['기타'];
}

// 입력: issueLabel, category, recommendedAction(원본 셀러 가이드 문장)
// 출력: 고객 답글에 자연스럽게 들어갈 약속 문장
export function getReplyActionPhrase(issueLabel, category, recommendedAction) {
  if (typeof recommendedAction === 'string' && recommendedAction.trim()) {
    for (const { re, phrase } of ACTION_PHRASE_MAP) {
      if (re.test(recommendedAction)) return phrase;
    }
  }
  return CATEGORY_DEFAULT_ACTION[category] || CATEGORY_DEFAULT_ACTION['기타'];
}

// 강한 불편 이슈 여부 — 사과 표현 강도를 결정
export function isStrongIssue(issueLabel, category) {
  if (STRONG_ISSUE_RE.test(issueLabel || '')) return true;
  return category === '마감/불량' && STRONG_ISSUE_RE.test(issueLabel || '');
}

// 입력: { issueLabel, category, recommendedAction, polarity?, isActionableIssue?, severity? }
// 출력: [{ issueLabel, tone, template }, ...]  (정책상 답글 생성 불가면 [] 반환)
export function buildReplyTemplates(input) {
  const {
    issueLabel,
    category,
    recommendedAction,
    polarity = 'negative',
    isActionableIssue = true,
    severity = 'medium',
  } = input || {};

  // 정책: positive / non-actionable / generic 라벨은 답글 생성하지 않음
  if (isActionableIssue === false) return [];
  if (polarity === 'positive') return [];
  if (!issueLabel || GENERIC_LABEL_RE.test(issueLabel)) return [];

  const phrase = getCustomerFacingIssuePhrase(issueLabel, category);
  const promise = getReplyActionPhrase(issueLabel, category, recommendedAction);
  const strong = isStrongIssue(issueLabel, category) || severity === 'high';

  // 5 가지 말투(tone) — 사용자가 segmented 컨트롤에서 골라 사용한다.
  // 각 tone 은 단순 어휘 치환이 아니라 시작 문장 / 공감 표현 / 길이 / 끝맺음이 모두
  // 분명히 달라지도록 작성. 기본값은 'polite' (기존 '기본' 톤과 호환).
  //
  //   polite       : 정중한 말투  — 기본 고객센터 톤. 안정적, 사과 1회.
  //   friendly     : 친근한 말투  — 부드럽고 가까운 톤. 딱딱한 표현 회피.
  //   concise      : 간결한 말투  — 1~2 문장, 군더더기 없음.
  //   empathetic   : 공감형 말투  — 불편 인정 + 구체적 지점 언급 (부정 리뷰에 적합).
  //   professional : 전문적 말투  — 공식 브랜드 응대, 검토/개선 절차 중심.
  let tones;
  if (strong) {
    tones = {
      polite: `안녕하세요 고객님, 소중한 후기 남겨주셔서 감사합니다.\n이용에 불편을 드린 점 정중히 사과드립니다. ${phrase}.\n남겨주신 의견은 담당 부서에 전달해 ${promise}. 교환·반품이 필요하시면 편히 말씀해 주세요.`,
      friendly: `안녕하세요 고객님, 후기 정성스럽게 남겨주셔서 감사합니다.\n불편하셨을 텐데 정말 죄송해요. ${phrase}.\n말씀해 주신 부분은 꼼꼼히 확인해서 ${promise}. 다음엔 꼭 더 만족하실 수 있게 준비할게요.`,
      concise: `후기 감사합니다. 불편을 드려 죄송합니다.\n${phrase} 관련 의견은 확인 후 ${promise}.`,
      empathetic: `${phrase} 부분에서 많이 불편하셨을 것 같습니다. 먼저 죄송하다는 말씀 드립니다.\n남겨주신 의견은 같은 불편이 반복되지 않도록 ${promise}. 교환·반품이 필요하시면 언제든 말씀해 주세요.`,
      professional: `안녕하세요 고객님, 소중한 피드백 감사합니다.\n해당 ${phrase} 사례는 품질 검수 및 공정 점검 대상으로 접수하였습니다.\n관련 부서와 함께 ${promise}. 추가 안내가 필요하시면 고객센터로 문의해 주시기 바랍니다.`,
    };
  } else {
    tones = {
      polite: `안녕하세요 고객님, 소중한 후기 남겨주셔서 감사합니다.\n${phrase}.\n남겨주신 의견은 관련 안내를 보완하는 데 참고하겠습니다. ${promise}.`,
      friendly: `안녕하세요 고객님, 후기 남겨주셔서 감사합니다.\n${phrase}.\n말씀해 주신 부분은 꼼꼼히 확인해서 상품 안내에 더 잘 반영해 볼게요.`,
      concise: `후기 감사합니다. ${phrase} 관련 의견은 상품 안내에 참고하겠습니다.`,
      empathetic: `${phrase} 부분에서 아쉬움을 느끼셨을 것 같습니다.\n남겨주신 의견은 더 만족스러운 상품을 준비하는 데 참고하겠습니다. ${promise}.`,
      professional: `소중한 피드백 감사합니다.\n${phrase} 관련 의견은 상품 품질 검토 및 상세페이지 개선 과정에 반영하도록 검토하겠습니다.`,
    };
  }

  return [
    { issueLabel, tone: 'polite',       toneLabel: '정중한 말투',     template: tones.polite },
    { issueLabel, tone: 'friendly',     toneLabel: '친근한 말투',     template: tones.friendly },
    { issueLabel, tone: 'concise',      toneLabel: '간결한 말투',     template: tones.concise },
    { issueLabel, tone: 'empathetic',   toneLabel: '공감형 말투',     template: tones.empathetic },
    { issueLabel, tone: 'professional', toneLabel: '전문적인 말투',   template: tones.professional },
  ];
}

// 선택된 1 tone 만 반환 — 분석 시점에는 polite 만 미리 만들고, 사용자가 다른 tone 을
// 클릭하면 /api/ai/reply-templates 가 이 함수의 결과 또는 LLM 호출 결과를 돌려준다.
// 입력은 buildReplyTemplates 와 동일. 반환은 길이 1 배열 또는 [].
export function buildSingleToneTemplate(input, requestedTone) {
  const tone = normalizeReplyTone(requestedTone, DEFAULT_PRECOMPUTED_TONE);
  const all = buildReplyTemplates(input);
  if (!all.length) return [];
  const picked = all.find((v) => v.tone === tone);
  return picked ? [picked] : [all[0]];
}

// 사과가 필요한 상황인지 — LLM 사용 시점 + rule fallback 모두에서 일관 적용.
// positive 또는 단순 mentionedAspect 만 있는 경우 사과 금지.
// price 양보 패턴(가격이 비싸지만 만족) 도 강한 사과 금지.
//
// 입력: { sentiment?, polarity?, isActionableIssue?, severity?, category?, issueLabel? }
// 출력: { mayApologize, shouldStrongApologize, reason }
export function shouldApologizeForReply(input = {}) {
  const sentiment = input.sentiment || null;
  const polarity = input.polarity || (sentiment === 'positive' ? 'positive' : 'negative');
  const isActionableIssue = input.isActionableIssue !== false;
  const severity = input.severity || 'medium';

  if (polarity === 'positive' || sentiment === 'positive') {
    return { mayApologize: false, shouldStrongApologize: false, reason: 'positive_review' };
  }
  if (!isActionableIssue) {
    return { mayApologize: false, shouldStrongApologize: false, reason: 'no_actionable_issue' };
  }
  // 가격 양보 패턴 — "비싸지만 만족" 류 → 강한 사과 금지.
  if (input.category === '가격/가성비' && /비싸도|비싸지만|비싸긴|돈값|값어치/.test(String(input.issueLabel || ''))) {
    return { mayApologize: true, shouldStrongApologize: false, reason: 'price_concession' };
  }
  if (severity === 'high' || (sentiment === 'negative' && polarity === 'negative')) {
    return { mayApologize: true, shouldStrongApologize: severity === 'high', reason: 'real_inconvenience' };
  }
  return { mayApologize: true, shouldStrongApologize: false, reason: 'default_negative' };
}

export { REPLY_TONES, REPLY_TONE_FULL_LABEL };

