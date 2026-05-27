// 패션 리뷰 멀티라벨 분류 (규칙 기반 1차 + 애매한 건 LLM 위임)
import { safeStr } from '../utils/textUtils.js';

// 고정 상위 카테고리
export const FASHION_CATEGORIES = [
  '사이즈',
  '핏/실루엣',
  '색상/화면 차이',
  '소재/두께',
  '마감/불량',
  '착용감',
  '세탁/내구성',
  '배송/포장',
  '가격/가성비',
  '기타',
];

// 카테고리별 키워드 규칙
const KEYWORDS = {
  // '품'은 '상품/제품/반품'과 충돌이 잦아 제외 (품 관련 불만은 어깨/소매/허리로 충분히 포착)
  사이즈: ['작', '크', '사이즈', '타이트', '낑', '껴', '헐렁', '기장', '허리', '어깨', '소매', '길이'],
  '핏/실루엣': ['핏', '라인', '부해', '모델핏', '실루엣', '예쁘게 안', '떨어지는', '핏감'],
  '색상/화면 차이': ['색', '색상', '화면', '사진', '밝', '어둡', '톤', '실물', '차이', '카키', '베이지'],
  '소재/두께': ['원단', '소재', '얇', '두껍', '비침', '까슬', '부드럽', '신축', '촉감', '재질'],
  '마감/불량': ['실밥', '마감', '박음질', '지퍼', '단추', '불량', '뜯', '터짐', '구멍'],
  착용감: ['불편', '답답', '까끌', '무거', '가려', '따가', '착용감'],
  '세탁/내구성': ['세탁', '보풀', '물빠짐', '줄어', '변형', '늘어', '수축'],
  '배송/포장': ['배송', '늦', '빠르', '포장', '구김', '택배', '박스', '누락'],
  '가격/가성비': ['가격', '비싸', '가성비', '값', '돈', '저렴', '퀄리티 대비'],
};

// 긍정 신호 (부정 키워드 매칭을 완화하기 위함)
const POSITIVE_HINTS = ['좋', '만족', '예뻐', '예쁘', '딱', '추천', '재구매', '최고', '편하', '맘에', '마음에', '굿'];
const NEGATIVE_HINTS = ['아쉬', '별로', '실망', '불만', '안좋', '나쁘', '환불', '반품', '하자', '안맞'];

export function detectSentiment(review) {
  if (typeof review.rating === 'number') {
    if (review.rating <= 2) return 'negative';
    if (review.rating === 3) return 'neutral';
    return 'positive';
  }
  // rating 없으면 텍스트 기반 추정
  const t = safeStr(review.content);
  const pos = POSITIVE_HINTS.filter((w) => t.includes(w)).length;
  const neg = NEGATIVE_HINTS.filter((w) => t.includes(w)).length;
  if (neg > pos) return 'negative';
  if (pos > neg) return 'positive';
  return 'neutral';
}

// 규칙 기반 카테고리 매칭 (멀티라벨)
function ruleMatch(review) {
  const text = `${safeStr(review.title)} ${safeStr(review.content)}`;
  const matched = [];
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    const hits = words.filter((w) => text.includes(w));
    if (hits.length > 0) {
      // confidence: 매칭 키워드 수 기반 (0.5 ~ 0.9)
      const confidence = Math.min(0.9, 0.5 + hits.length * 0.13);
      matched.push({
        name: cat,
        hits,
        confidence: Number(confidence.toFixed(2)),
        evidence: review.content.slice(0, 120),
        source: 'rule',
      });
    }
  }
  return matched;
}

// 단일 리뷰 분류 → ReviewClassification
// 부정/중립 리뷰만 카테고리 부여 (긍정 리뷰는 불만 분석 대상에서 제외하되 sentiment는 기록)
export function classifyReview(review) {
  const sentiment = detectSentiment(review);
  let categories = ruleMatch(review).map((m) => ({
    name: m.name,
    issue: null, // issueLabel은 이슈 탐지 단계에서 생성
    confidence: m.confidence,
    evidence: m.evidence,
    source: m.source,
    _hits: m.hits,
  }));

  // 긍정 리뷰는 불만 카테고리에서 제외 (단, 매칭이 강하면 유지)
  if (sentiment === 'positive') {
    categories = categories.filter((c) => c.confidence >= 0.75);
  }

  // 카테고리가 하나도 없는데 부정/중립이면 '기타'로
  const ambiguous = categories.length === 0 && sentiment !== 'positive';
  if (ambiguous) {
    categories.push({
      name: '기타',
      issue: null,
      confidence: 0.3,
      evidence: review.content.slice(0, 120),
      source: 'rule',
      _hits: [],
    });
  }

  return {
    reviewId: review.id,
    productName: review.productName,
    sentiment,
    ambiguous, // LLM 분류 대상 여부 (confidence 낮음)
    categories,
  };
}

// 전체 분류. ambiguous 한 건은 LLM에게 위임 가능.
export async function classifyAll(reviews, aiClient) {
  const classifications = reviews.map(classifyReview);

  const ambiguous = classifications.filter((c) => c.ambiguous);
  if (ambiguous.length > 0 && aiClient) {
    try {
      const reviewMap = new Map(reviews.map((r) => [r.id, r]));
      const llmResults = await aiClient.classifyAmbiguousReviews(
        ambiguous.map((c) => ({ id: c.reviewId, content: reviewMap.get(c.reviewId)?.content })),
        FASHION_CATEGORIES,
      );
      const byId = new Map(llmResults.map((r) => [r.reviewId, r]));
      for (const c of classifications) {
        const llm = byId.get(c.reviewId);
        if (llm && Array.isArray(llm.categories) && llm.categories.length) {
          c.categories = llm.categories.map((cat) => ({
            name: FASHION_CATEGORIES.includes(cat.name) ? cat.name : '기타',
            issue: cat.issue || null,
            confidence: cat.confidence ?? 0.6,
            evidence: reviewMap.get(c.reviewId)?.content.slice(0, 120) || '',
            source: 'llm',
            _hits: [],
          }));
        }
      }
    } catch (e) {
      // LLM 실패 시 규칙 결과 유지
      console.warn('[classify] LLM fallback:', e.message);
    }
  }

  return classifications;
}
