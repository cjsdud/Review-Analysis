// 패션 리뷰 멀티라벨 분류 엔진
// 절(clause) 단위로 쪼개 카테고리·세부이슈를 매칭하고, 부정어/극성을 반영한다.
import { safeStr } from '../utils/textUtils.js';
import {
  FASHION_CATEGORIES,
  SUBISSUE_RULES,
  CATEGORY_ACTIONS,
  ISSUE_ACTIONS,
} from './fashionLexicon.js';

export { FASHION_CATEGORIES };

// 카테고리만 언급되고 세부 이슈는 안 잡힐 때 쓰는 generic 토큰
const CATEGORY_GENERIC = {
  사이즈: ['사이즈', '치수', '핏이 안 맞', '사이즈가 안'],
  '핏/실루엣': ['핏이', '실루엣', '라인이'],
  '색상/화면 차이': ['색상', '색감', '컬러'],
  '소재/두께': ['원단', '소재', '재질', '촉감'],
  '마감/불량': ['마감', '봉제', '바느질'],
  착용감: ['착용감'],
  '세탁/내구성': ['세탁', '내구성'],
  '배송/포장': ['배송', '택배', '포장'],
  '가격/가성비': ['가격', '가성비'],
};

// 극성 판단용 어휘
const POS_TERMS = [
  '예뻐', '예쁘', '이뻐', '이쁘', '이쁨', '예쁨', '만족', '마음에', '맘에', '좋아', '좋네', '좋고', '좋습니',
  '좋은', '좋았', '편하', '편해', '부드럽', '적당', '딱 맞', '잘 맞', '딱이', '딱', '추천', '재구매', '최고',
  '굿', '시원', '세련', '고급', '가벼워', '가볍', '튼튼',
];
const NEG_TERMS = [
  '작아', '작게', '작음', '짧', '좁', '헐렁', '비침', '비쳐', '까슬', '뻣뻣', '불량', '하자', '터', '뜯', '구멍',
  '실밥', '보풀', '줄어', '늘어', '물빠짐', '이염', '늦', '지연', '구겨', '구김', '누락', '파손', '무거', '답답',
  '불편', '따가', '가려', '비싸', '아깝', '어둡', '칙칙', '차이', '달라', '다르', '별로', '아쉬', '실망', '후회',
  '환불', '반품', '최악', '안 맞', '안맞', '엉성', '부해',
];
const INTENSIFIERS = ['너무', '진짜', '완전', '정말', '매우', '심하게', '상당히', '엄청', '너무너무'];
const DIMINISHERS = ['약간', '살짝', '조금', '다소', '그닥'];

// 항상 불만으로 보는 라벨(불량/누락 등) — 긍정 단어가 있어도 불만으로 인정
const ALWAYS_NEG_LABEL = /(불량|하자|누락|파손|지연|물빠짐|보풀|실밥|터짐|구멍|부실)/;

// 더 구체적인 라벨이 있으면 제거할 포괄 라벨 (사이즈)
const SIZE_GENERIC_LABELS = new Set(['전반적으로 작게 나옴', '전반적으로 크게 나옴']);
// 같은 카테고리에서 더 구체적인 라벨이 있을 때 후순위로 밀리는 약한 라벨
const WEAK_LABELS = new Set([
  '실물 색상이 화면과 차이가 있음',
  '색상이 생각보다 어두움',
  '착용감이 불편함',
  '제품 불량(하자)',
  '마감 상태가 미흡함',
  '핏/실루엣이 기대와 다름',
]);

const CONJUNCTIONS = ['그런데', '근데', '하지만', '그러나', '그리고', '다만', '그래도'];

function splitClauses(text) {
  let s = safeStr(text).replace(/\n+/g, '. ');
  for (const c of CONJUNCTIONS) s = s.split(c).join('§');
  return s
    .split(/[.!?,~§]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);
}

// 토큰 출현 위치가 부정문맥인지 (없/안/않 등)
function isNegated(clause, idx, len) {
  const before = clause.slice(Math.max(0, idx - 3), idx);
  const after = clause.slice(idx + len, idx + len + 8);
  if (/없|아니|않|안\s?나|안\s?생|안\s?들|안\s?나오/.test(after)) return true;
  if (/안\s$/.test(before)) return true;
  return false;
}

// 그룹(토큰 배열) 중 부정되지 않은 첫 매칭 토큰 반환
function matchGroup(clause, tokens) {
  for (const tk of tokens) {
    let from = 0;
    let idx;
    while ((idx = clause.indexOf(tk, from)) !== -1) {
      if (!isNegated(clause, idx, tk.length)) return tk;
      from = idx + tk.length;
    }
  }
  return null;
}

function hasAny(clause, tokens) {
  return tokens.some((t) => clause.includes(t));
}

function clauseIsPositive(clause) {
  const neg = /별로|아쉬|실망|않|안 좋|안좋/.test(clause);
  const pos = POS_TERMS.some((t) => clause.includes(t));
  return pos && !neg && !hasAny(clause, NEG_TERMS);
}

function clauseHasNegative(clause) {
  return hasAny(clause, NEG_TERMS);
}

function intensityBonus(clause) {
  if (hasAny(clause, INTENSIFIERS)) return 0.1;
  if (hasAny(clause, DIMINISHERS)) return -0.1;
  return 0;
}

// 한 절에서 매칭되는 세부 이슈들 (카테고리별 중복 제거 + 제너릭)
function matchClause(clause) {
  const positive = clauseIsPositive(clause);
  const ib = intensityBonus(clause);

  // 1) 규칙별 raw 매칭 수집 (트리거 토큰 + 규칙 순서 기록)
  const byCategory = new Map();
  SUBISSUE_RULES.forEach((rule, ruleIndex) => {
    const triggers = [];
    for (const group of rule.all) {
      const tk = matchGroup(clause, group);
      if (!tk) return;
      triggers.push(tk);
    }
    const alwaysNeg = ALWAYS_NEG_LABEL.test(rule.label);
    if (positive && !alwaysNeg) return; // 긍정 절에서는 애매한 이슈 제외

    const groups = rule.all.length;
    const confidence = Math.max(0.4, Math.min(0.95, 0.62 + 0.12 * (groups - 1) + ib));
    const strength = groups * 2 + (ib > 0 ? 1 : 0) + 1;
    const list = byCategory.get(rule.cat) || [];
    list.push({ category: rule.cat, label: rule.label, strength, confidence, triggers, ruleIndex });
    byCategory.set(rule.cat, list);
  });

  // 2) 카테고리별로 트리거가 겹치지 않는(서로 다른 부위/측면) 이슈만 남김.
  //    강도 높은(구체적인) 규칙 우선 → 트리거를 공유하는 약한 규칙은 흡수.
  const results = [];
  for (const list of byCategory.values()) {
    list.sort((a, b) => b.strength - a.strength || a.ruleIndex - b.ruleIndex);
    const usedTriggers = new Set();
    for (const m of list) {
      if (m.triggers.some((t) => usedTriggers.has(t))) continue;
      m.triggers.forEach((t) => usedTriggers.add(t));
      results.push(m);
    }
  }

  // 3) 제너릭: 세부 이슈가 전혀 안 잡힌 카테고리만 (부정 단서 있을 때)
  if (!positive && clauseHasNegative(clause)) {
    for (const [cat, tokens] of Object.entries(CATEGORY_GENERIC)) {
      if (byCategory.has(cat)) continue;
      if (matchGroup(clause, tokens)) {
        results.push({ category: cat, label: null, strength: 1, confidence: 0.42 });
      }
    }
  }

  return results.map((r) => ({
    category: r.category,
    label: r.label,
    strength: r.strength,
    confidence: r.confidence,
    evidence: clause,
  }));
}

export function detectSentiment(review) {
  if (typeof review.rating === 'number') {
    if (review.rating <= 2) return 'negative';
    if (review.rating === 3) return 'neutral';
    return 'positive';
  }
  const clauses = splitClauses(`${safeStr(review.title)}. ${safeStr(review.content)}`);
  let pos = 0;
  let neg = 0;
  for (const c of clauses) {
    if (clauseIsPositive(c)) pos++;
    else if (clauseHasNegative(c)) neg++;
  }
  if (neg > pos) return 'negative';
  if (pos > neg) return 'positive';
  return 'neutral';
}

function resolveAction(category, label) {
  return (label && ISSUE_ACTIONS[label]) || CATEGORY_ACTIONS[category] || CATEGORY_ACTIONS['기타'];
}

// 단일 리뷰를 멀티라벨로 분류한다.
// 입력: review(ReviewNormalized)
// 출력: { reviewId, productName, rating, sentiment, ambiguous,
//        categories:[{ name, issue, confidence, evidence, source, action, strength }] }
export function classifyReview(review) {
  const sentiment = detectSentiment(review);
  const text = `${safeStr(review.title)}. ${safeStr(review.content)}`;
  const clauses = splitClauses(text);

  // (category||label) -> best match
  const best = new Map();
  for (const clause of clauses) {
    for (const m of matchClause(clause)) {
      const key = `${m.category}||${m.label || '__'}`;
      const prev = best.get(key);
      if (!prev || m.strength > prev.strength) best.set(key, m);
    }
  }

  // 같은 카테고리에 구체 라벨이 있으면 제너릭(label=null)은 제거
  const catsWithLabel = new Set([...best.values()].filter((m) => m.label).map((m) => m.category));
  for (const [key, m] of best) {
    if (!m.label && catsWithLabel.has(m.category)) best.delete(key);
  }

  // 카테고리별 정리: 사이즈는 부위별 복수 허용(포괄 라벨만 제거),
  // 그 외 카테고리는 리뷰당 1개(유사 이슈 중복 방지, weak 라벨은 후순위)
  const byCat = new Map();
  for (const m of best.values()) {
    if (!byCat.has(m.category)) byCat.set(m.category, []);
    byCat.get(m.category).push(m);
  }
  const finalMatches = [];
  for (const [cat, list] of byCat.entries()) {
    if (cat === '사이즈') {
      const specific = list.filter((m) => m.label && !SIZE_GENERIC_LABELS.has(m.label));
      finalMatches.push(...(specific.length ? specific : list));
    } else {
      list.sort(
        (a, b) =>
          Number(WEAK_LABELS.has(a.label)) - Number(WEAK_LABELS.has(b.label)) ||
          b.strength - a.strength ||
          b.confidence - a.confidence,
      );
      finalMatches.push(list[0]);
    }
  }

  const categories = finalMatches.map((m) => ({
    name: m.category,
    issue: m.label,
    confidence: Number(m.confidence.toFixed(2)),
    evidence: m.evidence.slice(0, 140),
    source: 'rule',
    action: resolveAction(m.category, m.label),
    strength: m.strength,
  }));

  const ambiguous = categories.length === 0 && sentiment === 'negative';

  return {
    reviewId: review.id,
    productName: review.productName,
    rating: review.rating,
    sentiment,
    ambiguous,
    categories,
  };
}

// 전체 리뷰 분류 + 애매한 부정 리뷰만 LLM(또는 mock)에 위임.
// 입력: reviews(ReviewNormalized[]), aiClient(LLM 추상화 모듈)
// 출력: ReviewClassification[] (classifyReview 결과 배열)
export async function classifyAll(reviews, aiClient) {
  const classifications = reviews.map(classifyReview);
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));

  const ambiguous = classifications.filter((c) => c.ambiguous);
  if (ambiguous.length > 0 && aiClient) {
    try {
      const llmResults = await aiClient.classifyAmbiguousReviews(
        ambiguous.map((c) => ({ id: c.reviewId, content: reviewMap.get(c.reviewId)?.content })),
        FASHION_CATEGORIES,
      );
      const byId = new Map((llmResults || []).map((r) => [r.reviewId, r]));
      for (const c of classifications) {
        if (!c.ambiguous) continue;
        const llm = byId.get(c.reviewId);
        const content = reviewMap.get(c.reviewId)?.content || '';
        if (llm && Array.isArray(llm.categories) && llm.categories.length) {
          c.categories = llm.categories.map((cat) => {
            const name = FASHION_CATEGORIES.includes(cat.name) ? cat.name : '기타';
            return {
              name,
              issue: cat.issue || null,
              confidence: cat.confidence ?? 0.55,
              evidence: content.slice(0, 140),
              source: 'llm',
              action: resolveAction(name, cat.issue || null),
              strength: 2,
            };
          });
        }
      }
    } catch (e) {
      console.warn('[classify] LLM fallback:', e.message);
    }
  }

  // LLM 으로도 못 채운 애매 부정 리뷰는 '기타'로
  for (const c of classifications) {
    if (c.ambiguous && c.categories.length === 0) {
      const content = reviewMap.get(c.reviewId)?.content || '';
      c.categories = [
        {
          name: '기타',
          issue: null,
          confidence: 0.35,
          evidence: content.slice(0, 140),
          source: 'rule',
          action: CATEGORY_ACTIONS['기타'],
          strength: 1,
        },
      ];
    }
  }

  return classifications;
}

// ===== user_corrections 룰 기반 review-level 우선 적용 =====
// 이전 분석에서 사용자가 직접 수정한 분류가 있으면, 같은 productKey 의 신규 리뷰 중
// content 가 oldIssueLabel / newIssueLabel 의 핵심어 2개 이상과 겹치는 경우 우선 적용한다.

// 한국어/영어 혼용을 가정한 매우 단순한 토큰화. 조사·종결어미가 섞여 있는 그대로 비교한다.
function extractKeywords(text) {
  if (!text) return [];
  const toks = String(text)
    .split(/[\s/·,.()\-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return [...new Set(toks)];
}

// 단일 correction → 룰 객체
function compileCorrectionRule(c) {
  if (!c || !c.productKey || !c.original || !c.corrected) return null;
  if (!c.corrected.category || !c.corrected.issueLabel) return null;
  const keywords = [
    ...extractKeywords(c.original.issueLabel),
    ...extractKeywords(c.corrected.issueLabel),
  ];
  const dedup = [...new Set(keywords)];
  if (dedup.length < 2) return null;
  return { productKey: c.productKey, corrected: c.corrected, keywords: dedup };
}

// content 에 룰 키워드 2개 이상이 substring 으로 포함되면 매칭
function ruleMatchesContent(content, rule) {
  if (!content) return false;
  let hit = 0;
  for (const k of rule.keywords) {
    if (content.includes(k)) hit++;
    if (hit >= 2) return true;
  }
  return false;
}

// 입력: reviews, classifications(in-place 수정), corrections([{productKey, original, corrected}])
// 출력: 적용된 review 수(number)
export function applyReviewCorrections(reviews, classifications, corrections) {
  if (!corrections?.length) return 0;
  const rules = corrections.map(compileCorrectionRule).filter(Boolean);
  if (!rules.length) return 0;

  const reviewById = new Map(reviews.map((r) => [r.id, r]));
  let applied = 0;
  for (const cls of classifications) {
    const review = reviewById.get(cls.reviewId);
    if (!review) continue;
    for (const rule of rules) {
      if (rule.productKey !== review.productName) continue;
      if (!ruleMatchesContent(review.content, rule)) continue;
      cls.categories = [
        {
          name: rule.corrected.category,
          issue: rule.corrected.issueLabel,
          confidence: 0.95,
          evidence: (review.content || '').slice(0, 140),
          source: 'correction',
          action: resolveAction(rule.corrected.category, rule.corrected.issueLabel),
          strength: 5,
        },
      ];
      cls.ambiguous = false;
      applied++;
      break; // 첫 매칭 룰 적용 후 다음 리뷰
    }
  }
  return applied;
}
