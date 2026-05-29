// 패션 리뷰 멀티라벨 분류 엔진 — 문맥 기반.
// 절(clause) 단위로 쪼개고, 각 절에 대해
//   1) positive/no-problem 표현 검사  →  해당 카테고리 이슈 차단
//   2) 카테고리 문맥(category context) 가드  →  관련 키워드 없으면 해당 카테고리로 분류 금지
//   3) 부정어/극성 인지 토큰 매칭
//   4) 사이즈 방향(buy-down/buy-up, 강한 large/small 토큰)으로 충돌 해소
//   5) 완화(조금/살짝)·강조(너무/완전) 표현으로 severity 결정
import { safeStr } from '../utils/textUtils.js';
import {
  FASHION_CATEGORIES,
  SUBISSUE_RULES,
  CATEGORY_ACTIONS,
  ISSUE_ACTIONS,
  SIZE_DIRECTION_TOKENS,
  CATEGORY_CONTEXT,
  ANY_POSITIVE_PHRASES,
  CATEGORY_POSITIVE_PHRASES,
  SOFT_POSITIVE_PHRASES,
  PART_NO_PROBLEM,
  CONTRAST_MARKERS,
  MITIGATION_PHRASES,
  INTENSITY_PHRASES,
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
  '예뻐', '예쁘', '예쁜', '이뻐', '이쁘', '이쁜', '이쁨', '예쁨',
  '만족', '마음에', '맘에',
  '좋아', '좋네', '좋고', '좋습니', '좋은', '좋았',
  '괜찮', '편하', '편해', '편안',
  '부드럽', '적당', '딱 맞', '잘 맞', '딱이',
  '추천', '재구매', '최고', '강추',
  '굿', '시원', '세련', '고급',
  '가벼워', '가볍', '튼튼', '탄탄', '꼼꼼', '깔끔',
  '문제없', '문제 없', '이상 없', '이상없',
  '도톰', '두께감 좋',
];
// NEG_TERMS: 부정 신호 어휘. '별로' 는 '색상별로/조금별로' 같은 합성어로 오탐이 잦아
// 안전한 표면형(별로요/별로네/별로다/이 별로/가 별로/는 별로/은 별로)만 등록한다.
const NEG_TERMS = [
  '작아', '작게', '작음', '짧', '좁', '헐렁', '벙벙', '타이트', '꽉 끼', '꽉 껴', '낑',
  '비침', '비쳐', '얇아', '얇음', '얇네', '까슬', '뻣뻣', '두꺼', '두툼해',
  '불량', '하자', '터', '뜯', '구멍', '실밥', '보풀',
  '줄어', '늘어', '물빠짐', '이염',
  '늦', '지연', '구겨', '구김', '누락', '파손',
  '무거', '답답', '불편', '따가', '가려', '쓸려',
  '비싸', '아깝',
  '어둡', '칙칙', '차이가 있', '차이 있', '차이가 나', '차이 나', '달라', '다르게',
  '별로요', '별로네', '별로예', '별로다', '이 별로', '가 별로', '는 별로', '은 별로', '별로 안',
  '아쉬', '실망', '후회', '환불', '반품', '최악',
  '안 맞', '안맞', '엉성', '부해', '부족', '삐뚤',
];
const INTENSIFIERS = INTENSITY_PHRASES;
const DIMINISHERS = ['약간', '살짝', '조금', '다소', '그닥'];

// 항상 불만으로 보는 라벨(불량/누락 등) — 긍정 단어가 있어도 불만으로 인정
const ALWAYS_NEG_LABEL = /(불량|하자|누락|파손|지연|물빠짐|보풀|실밥|터짐|구멍|부실)/;

// 사이즈 카테고리에서 더 구체적인 라벨이 있을 때 제거할 포괄 라벨
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

// 부정 단서 없이도 발동해도 되는 카테고리 (강한 신호가 있는 라벨).
// 배송/포장 은 제외 — '오래 걸으면 발이 아파' 같은 false-positive 를 막기 위해 카테고리 문맥 필수.
const ALWAYS_FIRE_CATEGORIES = new Set(['마감/불량']);

const CONJUNCTIONS = ['그런데', '근데', '하지만', '그러나', '그리고', '다만', '그래도'];

function splitClauses(text) {
  let s = safeStr(text).replace(/\n+/g, '. ');
  for (const c of CONJUNCTIONS) s = s.split(c).join('§');
  for (const m of CONTRAST_MARKERS) s = s.split(m).join('§');
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

// NEG_TERMS 중 "없/안/않" 등의 부정 문맥에 있는 단어는 부정 표현으로 치지 않는다.
function hasNegativeAware(clause) {
  for (const tk of NEG_TERMS) {
    let from = 0;
    let idx;
    while ((idx = clause.indexOf(tk, from)) !== -1) {
      if (!isNegated(clause, idx, tk.length)) return true;
      from = idx + tk.length;
    }
  }
  return false;
}

// 절이 카테고리 cat 의 문맥을 담고 있는가
function hasCategoryContext(clause, cat) {
  const ctx = CATEGORY_CONTEXT[cat];
  if (!ctx) return true; // 정의 없으면 통과
  return ctx.some((k) => clause.includes(k));
}

// 절이 어떤 형태로든 긍정 신호(POS_TERMS / ANY_POSITIVE / SOFT_POSITIVE)를 담고 있는가
function clauseHasAnyPositive(clause) {
  if (POS_TERMS.some((t) => clause.includes(t))) return true;
  if (ANY_POSITIVE_PHRASES.some((p) => clause.includes(p))) return true;
  if (SOFT_POSITIVE_PHRASES.some((p) => clause.includes(p))) return true;
  return false;
}

// 절 전체가 긍정인지 (부정 단서가 없거나 모두 부정 문맥 내).
function clauseIsPositive(clause) {
  // '별로' 는 NEG_TERMS 의 안전한 surface form 으로만 잡는다(여기서는 제외).
  const neg = /아쉬|실망|않(?!\s*아)|안 좋|안좋|후회|환불|최악/.test(clause);
  const pos = clauseHasAnyPositive(clause);
  return pos && !neg && !hasNegativeAware(clause);
}

function clauseHasNegative(clause) {
  return hasNegativeAware(clause);
}

function intensityBonus(clause) {
  if (hasAny(clause, INTENSIFIERS)) return 0.1;
  if (hasAny(clause, DIMINISHERS)) return -0.1;
  return 0;
}

// 절이 "진짜 개선이 필요한 불만"인지 — 긍정 절은 아니고 명시적 부정 단서가 있다.
function clauseIsActionable(clause) {
  if (clauseIsPositive(clause)) return false;
  return hasNegativeAware(clause);
}

// 절의 severity 추정 — 단일 절 기준. 클러스터 단계에서 count 로 한 번 더 조정한다.
function clauseSeverity(clause) {
  const mit = MITIGATION_PHRASES.some((m) => clause.includes(m));
  const intense = INTENSITY_PHRASES.some((m) => clause.includes(m));
  if (intense && !mit) return 'high';
  if (mit) return 'low';
  return 'medium';
}

// 한 절에서 매칭되는 세부 이슈들 (카테고리별 중복 제거 + 제너릭)
function matchClause(clause) {
  const positive = clauseIsPositive(clause);
  const hasAnyPos = clauseHasAnyPositive(clause);
  const ib = intensityBonus(clause);
  const severity = clauseSeverity(clause);

  // 사이즈 방향 단서
  const buyDown = SIZE_DIRECTION_TOKENS.BUY_DOWN.some((t) => clause.includes(t));
  const buyUp = SIZE_DIRECTION_TOKENS.BUY_UP.some((t) => clause.includes(t));
  const strongLarge = SIZE_DIRECTION_TOKENS.STRONG_LARGE.some((t) => clause.includes(t));
  const strongSmall = SIZE_DIRECTION_TOKENS.STRONG_SMALL.some((t) => clause.includes(t));

  // 카테고리별 긍정 표현이 있으면 그 카테고리는 (강한 부정 라벨이 아닌 한) 차단
  const blockedCategories = new Set();
  for (const [cat, phrases] of Object.entries(CATEGORY_POSITIVE_PHRASES)) {
    if (phrases.some((p) => clause.includes(p))) blockedCategories.add(cat);
  }
  // 소프트 긍정("나쁘지 않") 도 부정 이슈 차단으로 처리
  const softPositive = SOFT_POSITIVE_PHRASES.some((p) => clause.includes(p));

  // 1) 규칙별 raw 매칭 수집 (트리거 토큰 + 규칙 순서 기록)
  const byCategory = new Map();
  SUBISSUE_RULES.forEach((rule, ruleIndex) => {
    const alwaysNeg = ALWAYS_NEG_LABEL.test(rule.label);
    const alwaysFire = ALWAYS_FIRE_CATEGORIES.has(rule.cat);

    // 카테고리 긍정 표현이 있으면 차단 (단, alwaysNeg 는 통과)
    if (blockedCategories.has(rule.cat) && !alwaysNeg) return;
    // 부위별 "문제 없음" 차단
    if (PART_NO_PROBLEM[rule.label]) {
      if (PART_NO_PROBLEM[rule.label].some((p) => clause.includes(p))) return;
    }
    // 절 전체가 긍정인 경우 — 강한 부정 라벨만 통과
    if (positive && !alwaysNeg) return;
    // 소프트 긍정("나쁘지 않") — 강한 부정 라벨만 통과
    if (softPositive && !alwaysNeg) return;

    // 카테고리 문맥 가드 — alwaysNeg / alwaysFire 카테고리는 예외
    if (!alwaysNeg && !alwaysFire && !hasCategoryContext(clause, rule.cat)) return;

    const triggers = [];
    for (const group of rule.all) {
      const tk = matchGroup(clause, group);
      if (!tk) return;
      triggers.push(tk);
    }

    const groups = rule.all.length;
    const confidence = Math.max(0.4, Math.min(0.95, 0.62 + 0.12 * (groups - 1) + ib));
    const strength = groups * 2 + (ib > 0 ? 1 : 0) + 1;
    const list = byCategory.get(rule.cat) || [];
    list.push({ category: rule.cat, label: rule.label, strength, confidence, triggers, ruleIndex });
    byCategory.set(rule.cat, list);
  });

  // 2) 카테고리별 트리거 dedupe — 강도 큰 규칙 우선 → 동일 트리거 공유 약한 규칙은 흡수
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

  // 3) 제너릭: 세부 이슈가 전혀 안 잡힌 카테고리만 (부정 단서 + 카테고리 문맥)
  if (!positive && !softPositive && hasNegativeAware(clause)) {
    for (const [cat, tokens] of Object.entries(CATEGORY_GENERIC)) {
      if (byCategory.has(cat)) continue;
      if (blockedCategories.has(cat)) continue;
      if (!hasCategoryContext(clause, cat)) continue;
      if (matchGroup(clause, tokens)) {
        results.push({ category: cat, label: null, strength: 1, confidence: 0.42 });
      }
    }
  }

  // 4) 사이즈 방향 충돌 해소
  //    BUY_DOWN ("한 치수 작게 사세요") → 실제 상품은 크게 나옴 ⇒ "작게 나옴" 제거
  //    BUY_UP ("한 치수 크게 사세요") → 실제 상품은 작게 나옴 ⇒ "크게 나옴" 제거
  //    STRONG_LARGE (헐렁/넉넉/품이 커) → "작게 나옴" 제거
  //    STRONG_SMALL (타이트/꽉/품이 작) → "크게 나옴" 제거
  const dropLarge = buyUp || (strongSmall && !buyDown && !strongLarge);
  const dropSmall = buyDown || (strongLarge && !buyUp && !strongSmall);
  if (dropSmall || dropLarge) {
    for (let i = results.length - 1; i >= 0; i--) {
      const r = results[i];
      if (r.category !== '사이즈') continue;
      if (dropSmall && r.label === '전반적으로 작게 나옴') results.splice(i, 1);
      else if (dropLarge && r.label === '전반적으로 크게 나옴') results.splice(i, 1);
    }
  }

  const actionableBase = clauseIsActionable(clause);

  return results.map((r) => {
    // 2+ 그룹 구체 규칙이 매칭되었으면(트리거 모두 비부정 문맥에서 발견) actionable 로 본다.
    // 절이 명백한 긍정이 아닌 한, 구체 규칙 매칭은 신뢰할 수 있는 개선 신호.
    const ruleIsSpecific = (r.strength >= 4); // 2 그룹 = strength 5 (1 group = 3)
    const actionable =
      positive ? ALWAYS_NEG_LABEL.test(r.label || '')
      : actionableBase || ruleIsSpecific || ALWAYS_NEG_LABEL.test(r.label || '');
    // polarity: 절에 긍정 단서가 함께 있으면 mixed (대조 구조의 잔재)
    const polarity = positive
      ? (ALWAYS_NEG_LABEL.test(r.label || '') ? 'mixed' : 'positive')
      : actionable
        ? hasAnyPos
          ? 'mixed'
          : 'negative'
        : 'neutral';
    return {
      category: r.category,
      label: r.label,
      strength: r.strength,
      confidence: r.confidence,
      evidence: clause,
      issuePolarity: polarity,
      isActionableIssue: actionable,
      severity,
    };
  });
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

// severity 우선순위 (높을수록 강함)
const SEV_RANK = { low: 1, medium: 2, high: 3 };
function maxSeverity(a, b) {
  return (SEV_RANK[a] || 2) >= (SEV_RANK[b] || 2) ? a : b;
}

// 단일 리뷰를 멀티라벨로 분류한다.
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
      if (!prev || m.strength > prev.strength) {
        // severity 는 max 유지
        const mergedSev = prev ? maxSeverity(prev.severity, m.severity) : m.severity;
        best.set(key, { ...m, severity: mergedSev });
      } else {
        prev.severity = maxSeverity(prev.severity, m.severity);
      }
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

  // 리뷰 전체 차원의 사이즈 충돌 해소: 절 단위에서 못 잡힌 충돌(예: 절1=크게, 절2=작게)을 마지막에 정리
  const sizeLabels = finalMatches.filter((m) => m.category === '사이즈').map((m) => m.label);
  if (sizeLabels.includes('전반적으로 작게 나옴') && sizeLabels.includes('전반적으로 크게 나옴')) {
    // 절 합쳐서 강한 신호로 다시 판정
    const text2 = clauses.join(' ');
    const strongLarge = SIZE_DIRECTION_TOKENS.STRONG_LARGE.some((t) => text2.includes(t));
    const strongSmall = SIZE_DIRECTION_TOKENS.STRONG_SMALL.some((t) => text2.includes(t));
    const buyDown = SIZE_DIRECTION_TOKENS.BUY_DOWN.some((t) => text2.includes(t));
    const buyUp = SIZE_DIRECTION_TOKENS.BUY_UP.some((t) => text2.includes(t));
    let keep = null;
    if (buyDown || strongLarge) keep = '전반적으로 크게 나옴';
    else if (buyUp || strongSmall) keep = '전반적으로 작게 나옴';
    if (keep) {
      for (let i = finalMatches.length - 1; i >= 0; i--) {
        const m = finalMatches[i];
        if (m.category === '사이즈' && SIZE_GENERIC_LABELS.has(m.label) && m.label !== keep) {
          finalMatches.splice(i, 1);
        }
      }
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
    issuePolarity: m.issuePolarity || 'negative',
    isActionableIssue: m.isActionableIssue !== false,
    severity: m.severity || 'medium',
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
              issuePolarity: 'negative',
              isActionableIssue: true,
              severity: 'medium',
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
          issuePolarity: 'neutral',
          isActionableIssue: false,
          severity: 'low',
        },
      ];
    }
  }

  return classifications;
}

// ===== user_corrections 룰 기반 review-level 우선 적용 =====
// 이전 분석에서 사용자가 직접 수정한 분류가 있으면, 같은 productKey 의 신규 리뷰 중
// content 가 oldIssueLabel / newIssueLabel 의 핵심어 2개 이상과 겹치는 경우 우선 적용한다.

function extractKeywords(text) {
  if (!text) return [];
  const toks = String(text)
    .split(/[\s/·,.()\-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return [...new Set(toks)];
}

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

function ruleMatchesContent(content, rule) {
  if (!content) return false;
  let hit = 0;
  for (const k of rule.keywords) {
    if (content.includes(k)) hit++;
    if (hit >= 2) return true;
  }
  return false;
}

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
          issuePolarity: 'negative',
          isActionableIssue: true,
          severity: 'medium',
        },
      ];
      cls.ambiguous = false;
      applied++;
      break;
    }
  }
  return applied;
}
