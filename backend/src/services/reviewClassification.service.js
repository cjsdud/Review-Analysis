// 패션 리뷰 멀티라벨 분류 엔진 — 문맥 기반.
// 절(clause) 단위로 쪼개고, 각 절에 대해
//   1) positive/no-problem 표현 검사  →  해당 카테고리 이슈 차단
//   2) 카테고리 문맥(category context) 가드  →  관련 키워드 없으면 해당 카테고리로 분류 금지
//   3) 부정어/극성 인지 토큰 매칭
//   4) 사이즈 방향(buy-down/buy-up, 강한 large/small 토큰)으로 충돌 해소
//   5) 완화(조금/살짝)·강조(너무/완전) 표현으로 severity 결정
import { safeStr } from '../utils/textUtils.js';
import { hasWeakPositiveSignal } from './ai/sizeDirection.js';
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
  '부드럽', '적당', '딱 맞', '잘 맞', '딱이', '딱입', '딱이에', '딱이다',
  '추천', '재구매', '최고', '강추', '구매하세', '구매하시',
  '굿', '시원', '세련', '고급',
  '가벼워', '가볍', '튼튼', '탄탄', '꼼꼼', '깔끔',
  '문제없', '문제 없', '이상 없', '이상없',
  '도톰', '두께감 좋',
  // 구어/슬랭 — 실제 리뷰에서 빈번
  '오집니', '오지네', '오져요', '대박', '가성비 오',
  // 충성도/가치 인정 — "별점이 낮아도 본문이 이만큼 강하게 긍정이면 sentiment 보호"
  // 의 핵심 신호.
  '돈값', '값어치',
  '계속 사', '계속 산', '여기서만 사', '여기서만 산',
  '완전 멋', '완전 좋', '완전 만족', '완전 추천',
];
// NEG_TERMS: 부정 신호 어휘. '별로' 는 '색상별로/조금별로' 같은 합성어로 오탐이 잦아
// 안전한 표면형(별로요/별로네/별로다/이 별로/가 별로/는 별로/은 별로)만 등록한다.
// 짧은 한 글자 토큰(터/뜯)은 '고객센터/뜯다' 등에서 오탐되므로 더 긴 surface form 만 사용.
const NEG_TERMS = [
  '작아', '작게', '작음', '작긴', '짧', '짧긴', '좁', '헐렁', '벙벙', '타이트', '꽉 끼', '꽉 껴', '낑',
  '비침', '비쳐', '얇아', '얇음', '얇네', '까슬', '뻣뻣', '두꺼', '두툼해',
  '불량', '하자', '터짐', '터져', '터지', '뜯어', '뜯김', '뜯겨', '구멍', '실밥', '보풀',
  '줄어', '늘어', '물빠짐', '이염',
  '늦', '지연', '구겨', '구김', '누락', '파손',
  '무거', '답답', '불편', '따가', '따갑', '가려', '쓸려',
  '비싸', '아깝',
  '어둡', '어두워', '칙칙', '차이가 있', '차이 있', '차이가 나', '차이 나', '달라', '다르게',
  '별로요', '별로네', '별로예', '별로다', '이 별로', '가 별로', '는 별로', '은 별로', '별로 안', '도 별로', '별로였',
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
  // CONTRAST_MARKERS 는 '쁜데/긴데/큰데/지만' 처럼 형용사 어간 + 어미 구조.
  // 통째로 § 으로 치환하면 "색감은 예쁜데..." → "색감은 예" 가 되어 좌측 절에서
  // '예쁜' 같은 긍정 어휘가 사라지는 문제가 있었다. 마지막 글자(데/만)만 § 으로
  // 바꿔서 어간(예쁜/긴/큰/지)을 좌측 절에 남긴다.
  for (const m of CONTRAST_MARKERS) {
    const head = m.slice(0, -1);
    s = s.split(m).join(`${head}§`);
  }
  // 한국어 연결어미 "X-고 Y..." 도 부드럽게 분리 — 단, 너무 짧은 글자엔 적용 안 함.
  // 예: "마감이 별로고 실밥이 많아요" → "마감이 별로고" / "실밥이 많아요"
  // "늦고 포장도" 등. 한 글자 어휘 뒤의 '고' 는 오탐(고무/고객 등) 가능성이 있어
  // 두 글자 이상의 어휘 뒤만 분리한다.
  s = s.replace(/([가-힣]{2,})고\s+(?=[가-힣])/g, '$1고§');
  return s
    .split(/[.!?,~§]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);
}

// 토큰 출현 위치가 부정문맥인지 (없/안/않 등).
// after window 는 16자까지 — "비침이 거의 없어요", "줄어들지 않았어요" 같은 한국어 어순 대응.
function isNegated(clause, idx, len) {
  const before = clause.slice(Math.max(0, idx - 6), idx);
  const after = clause.slice(idx + len, idx + len + 16);
  if (/없|아니|않|안\s?나|안\s?생|안\s?들|안\s?나오|안\s?비치|비치지\s?않/.test(after)) return true;
  if (/안\s?$|거의\s?$|크게\s?$/.test(before)) return true;
  return false;
}

// 명시적 부정어 반전 표현 검사. 매칭되면 해당 절은 부정 이슈로 보지 않는다.
const REVERSAL_PHRASES = [
  '비침이 거의 없', '비침 거의 없', '비침 없', '비침이 없', '비치지 않', '안 비쳐', '안 비침',
  '실밥 없', '실밥이 없', '실밥 거의 없', '실밥 없이',
  '보풀 없', '보풀이 없', '보풀 안 생', '보풀이 안 생', '보풀 거의 없',
  '줄어들지 않', '크게 줄어들지 않', '줄지 않',
  '물빠짐 없', '물 빠짐 없', '이염 없', '색 빠짐 없',
  '냄새 안 나', '냄새 없',
  '마감이 나쁘지 않', '마감 나쁘지 않',
  '불편하지 않', '답답하지 않', '까슬거림 없', '까슬거리지 않',
  '하자 없', '하자가 없', '문제 없', '문제가 없', '이상 없', '이상이 없',
  '변형 없', '변형이 없',
  '불만은 없', '불만 없', '크게 불만은 없', '큰 불만 없', '큰 불만은 없',
  '신경 안 쓰', '신경 쓰이지 않', '거슬리지 않',
];
export function hasNegationReversal(text) {
  if (!text) return false;
  return REVERSAL_PHRASES.some((p) => text.includes(p));
}

// 텍스트 전체 차원의 "불만 해소/타협" 표현 — 별도의 절에 있어도 전체 부정 점수를 완화한다.
// 예: "배송은 늦었지만 크게 불만은 없어요" — 1번 절은 부정이지만 2번 절에서 해소.
const COMPLAINT_RESOLUTION_PHRASES = [
  '크게 불만은 없', '큰 불만 없', '큰 불만은 없', '불만은 없', '불만 없',
  '신경 안 쓰', '신경 쓰이지 않', '거슬리지 않',
  '크게 문제 없', '큰 문제 없', '문제 없',
];
function hasComplaintResolution(text) {
  if (!text) return false;
  return COMPLAINT_RESOLUTION_PHRASES.some((p) => text.includes(p));
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

// 한 절 안에 등장하는 distinct NEG_TERMS 의 개수 — 같은 토큰의 중복은 1로 친다.
// "마감이 별로고 실밥이 많아요" 처럼 한 절에 여러 부정 신호가 있으면 점수가
// 더 가산되도록.
function countDistinctNegatives(clause) {
  let n = 0;
  const seen = new Set();
  for (const tk of NEG_TERMS) {
    if (seen.has(tk)) continue;
    let from = 0;
    let idx;
    let hit = false;
    while ((idx = clause.indexOf(tk, from)) !== -1) {
      if (!isNegated(clause, idx, tk.length)) { hit = true; break; }
      from = idx + tk.length;
    }
    if (hit) { n++; seen.add(tk); }
  }
  return n;
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
      const label = r.label || '';
      // 전반적 + 부위별 (허리/어깨/소매/기장/목 부분 등) "작게 나옴" / "크게 나옴" 모두 정리.
      // 사용자가 "작게 갈 걸" (BUY_DOWN) 이면 → 제품이 크게 나온다는 뜻 → "작게 나옴" 라벨은 모두 제거.
      if (dropSmall && /작게 나옴|작음$|짧음$|좁음$|타이트함$/.test(label)) results.splice(i, 1);
      else if (dropLarge && /크게 나옴|큼$|김$|넓음$/.test(label)) results.splice(i, 1);
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

// rating 값을 number 로 정규화. "5점" / "평점 4" 같은 문자열도 처리.
// 1~5 범위가 아니면 null.
export function normalizeRating(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value >= 1 && value <= 5 ? value : null;
  }
  const s = String(value).trim();
  if (!s) return null;
  // 직접 number-cast 시도
  const direct = Number(s);
  if (Number.isFinite(direct) && direct >= 1 && direct <= 5) return direct;
  // "5점", "평점 4", "별점 3" 등에서 첫 정수 추출
  const m = s.match(/[1-5]/);
  if (m) {
    const n = Number(m[0]);
    if (n >= 1 && n <= 5) return n;
  }
  return null;
}

// 강한 부정 표현(환불/반품/최악/하자/누락 등) — 1개라도 있으면 hasSevereComplaint=true
const STRONG_COMPLAINT_PHRASES = [
  '환불', '반품', '최악', '실망', '후회', '하자', '불량', '파손', '누락',
  '찢어', '터짐', '구멍', '못 입', '못 신', '입기 어려', '신기 어려',
  '단독으로 입기 어려', '단독 입기 어려',
  '몇 번 못', '필요한 날에 못',
  '오래 걸으면 아', '발이 아파', '발이 너무 아',
];
// 명확한 만족 표현 — hasClearSatisfaction
const CLEAR_SATISFACTION_PHRASES = [
  '만족', '마음에 들', '맘에 들', '추천', '재구매', '잘 샀', '잘 산',
  '더 사고 싶', '오래 입을',
  '저는 이쪽이 더 마음에', '저는 이쪽이 더 맘에',
  '예뻐', '이뻐', '예쁘', '이쁘',
  '좋아요', '좋습니', '좋네',
  '편해', '편안', '깔끔',
  // "딱이다/딱이에요/딱입니다" 류
  '딱이', '딱입', '딱이에', '딱이다',
  // 충성도/반복구매/돈값 표현 — 별점이 낮아도 본문이 이만큼 강하게 긍정이면 sentiment 보호.
  '돈값', '값어치',
  '계속 사', '계속 사게', '여기서만 사', '여기서만 삼',
  '거의 만 사', '여기 만 사', '비긴에서만', // 브랜드 충성도 (사례에서 발견)
  '완전 멋', '완전 좋', '완전 만족',
  '벌이 있', '벌 있', // "바지가 4벌이 있음" 같은 보유 = 만족 신호
];

// 가격 양보 구조 — "비싸긴해도 돈값" 류. 본문에 있으면 가격 issue 는 severity=low 로 강등 +
// 전체 sentiment 는 negative 로 떨어지지 않게 보호.
const PRICE_CONCESSION_PATTERNS = [
  '비싸긴해도 돈값', '비싸긴 해도 돈값', '비싸도 돈값', '비싸지만 돈값',
  '비싸긴해도 값어치', '비싸긴 해도 값어치', '비싸도 값어치',
  '비싸지만 만족', '비싸도 만족', '비싸긴해도 만족', '비싸긴 해도 만족',
  '비싸지만 좋', '비싸도 좋', '비싸긴해도 좋', '비싸긴 해도 좋',
  '비싸지만 퀄리티', '비싸지만 품질', '비싸도 퀄리티', '비싸도 품질',
  '비싸지만 재구매', '비싸지만 계속', '비싸도 재구매', '비싸도 계속',
  '비싸긴 한데 그래도', '비싸긴한데 그래도',
  '가격은 있지만 재구매', '가격은 좀 있지만 재구매',
  '가격은 있지만 만족', '가격은 좀 있지만 만족',
];
export function hasPriceConcession(text) {
  if (!text) return false;
  return PRICE_CONCESSION_PATTERNS.some((p) => text.includes(p));
}
// "괜찮", "납득" 등 수용/타협 표현 — sentiment 를 mid 쪽으로 끌어올림
const ACCEPTANCE_PHRASES = [
  '괜찮', '납득', '이해되', '이해 되', '그래도 만족', '그래도 괜찮',
  '가격 생각하면', '가격 대비',
  '깔창 넣으면 괜찮', '입다 보면 괜찮',
  '교환할 정도는 아니', '교환할 정도까진 아니',
];
// 텍스트 안의 부정 표현 강도 분류
const MILD_NEGATIVE_PHRASES = [
  '조금', '살짝', '약간', '다소', '느껴졌', '느껴져', '느껴집니',
  '아쉬', '구겨', '구김',
];

// 텍스트 감성 signal 추출
export function analyzeTextSentiment(text) {
  const safe = safeStr(text);
  const clauses = splitClauses(safe);
  const reversalGlobal = hasNegationReversal(safe);

  let positiveScore = 0;
  let negativeScore = 0;
  let positiveCount = 0;
  let strongNegativeCount = 0;
  let mildNegativeCount = 0;
  let acceptanceCount = 0;
  // contrast 는 raw 텍스트 기준 — splitClauses 가 contrast marker(의 마지막 글자)를
  // 소비하기 때문에 절을 돌면서 다시 세면 0 이 된다.
  let contrastCount = 0;
  if (CONJUNCTIONS.some((c) => safe.includes(c))) contrastCount++;
  if (CONTRAST_MARKERS.some((m) => safe.includes(m))) contrastCount++;
  let hasSevereComplaint = false;
  let hasClearSatisfaction = false;
  let hasOnlyNegatedIssue = clauses.length > 0;

  for (const clause of clauses) {
    const reversal = hasNegationReversal(clause);

    // 절 단위 긍정 — clauseHasAnyPositive 는 명시적 긍정 어휘 검사
    const posInClause = clauseHasAnyPositive(clause);
    if (posInClause) {
      positiveCount++;
      positiveScore += 1;
    }
    if (CLEAR_SATISFACTION_PHRASES.some((p) => clause.includes(p))) {
      hasClearSatisfaction = true;
      positiveScore += 0.3;
    }
    if (ACCEPTANCE_PHRASES.some((p) => clause.includes(p))) {
      acceptanceCount++;
      positiveScore += 0.4;
    }

    // 부정: reversal 절은 부정 점수 가산하지 않음
    if (!reversal) {
      const hasNeg = clauseHasNegative(clause);
      if (hasNeg) {
        // 같은 절에 distinct NEG_TERMS 가 여러 개면 점수 가산 (1개 이상부터 1).
        // 예: "마감이 별로고 실밥이 많아요" 는 두 개 → 약 1.4 점.
        const negDistinct = Math.max(1, countDistinctNegatives(clause));
        const negFactor = 1 + 0.6 * (negDistinct - 1); // 1, 1.6, 2.2 …
        if (STRONG_COMPLAINT_PHRASES.some((p) => clause.includes(p))) {
          strongNegativeCount++;
          negativeScore += 1.4 * negFactor;
          hasSevereComplaint = true;
        } else if (MILD_NEGATIVE_PHRASES.some((p) => clause.includes(p))) {
          mildNegativeCount++;
          negativeScore += 0.4 * negFactor;
        } else {
          // 기본 부정 (강/약 사이)
          negativeScore += 0.8 * negFactor;
          mildNegativeCount++;
        }
        if (!posInClause) hasOnlyNegatedIssue = false;
      }
    }
  }

  // 강한 만족 표현이 전혀 없으면 hasOnlyNegatedIssue 도 false
  if (positiveCount === 0) hasOnlyNegatedIssue = false;
  // 전체 텍스트 차원에서 reversal 만 있고 다른 부정 신호 없으면 onlyNegatedIssue
  if (reversalGlobal && negativeScore === 0) hasOnlyNegatedIssue = true;

  // "크게 불만은 없", "신경 안 쓰여요" 같은 명시적 해소 표현이 있으면 acceptance 가산 + severe 해제
  if (hasComplaintResolution(safe)) {
    acceptanceCount++;
    positiveScore += 0.6;
    hasSevereComplaint = false;
  }

  return {
    positiveScore,
    negativeScore,
    strongNegativeCount,
    mildNegativeCount,
    positiveCount,
    acceptanceCount,
    contrastCount,
    hasSevereComplaint,
    hasClearSatisfaction,
    hasOnlyNegatedIssue,
  };
}

// 분석 배치 안에서 rating 컬럼이 신뢰할 만한지 검증.
// 다음 경우 false 를 반환해 sentiment 판정에서 rating 보조 신호를 끈다.
//   1) 유효 rating(1~5) 비율이 70% 미만
//   2) 한 값에 70% 이상 몰림 (예: 전체가 별점 2점)
//   3) 텍스트 감성과 rating 의 충돌 비율이 50% 이상 (큰 표본에서만 적용)
export function isRatingReliable(reviews = []) {
  const arr = Array.isArray(reviews) ? reviews : [];
  if (arr.length === 0) return false;
  const valid = arr.map((r) => normalizeRating(r?.rating)).filter((n) => n != null);
  if (valid.length === 0) return false;
  // 표본이 너무 작으면 의미 있는 분포 검사 불가 — 일단 신뢰하고 통과시킨다.
  // (작은 분석 batch / 개별 테스트 호환)
  if (arr.length < 10) return valid.length >= 1;
  if (valid.length < arr.length * 0.7) return false;
  const counts = valid.reduce((m, n) => { m[n] = (m[n] || 0) + 1; return m; }, {});
  const max = Math.max(...Object.values(counts));
  if (max / valid.length >= 0.7) return false;
  // 텍스트와 rating 의 모순 — 표본이 충분할 때만(>=20) 비율 검사.
  if (arr.length >= 20) {
    let conflicts = 0;
    let checked = 0;
    for (const r of arr) {
      const rating = normalizeRating(r?.rating);
      if (rating == null) continue;
      const sig = analyzeTextSentiment(`${safeStr(r.title)}. ${safeStr(r.content)}`);
      const textPositive = sig.positiveScore - sig.negativeScore >= 1.0 || sig.hasClearSatisfaction;
      const textNegative = sig.positiveScore - sig.negativeScore <= -1.0 || sig.hasSevereComplaint;
      if (textPositive && rating <= 2) conflicts++;
      else if (textNegative && rating >= 4) conflicts++;
      checked++;
    }
    if (checked >= 20 && conflicts / checked >= 0.5) return false;
  }
  return true;
}

// rating + textSignal 결합. 별점이 없거나 ratingReliable=false 면 text 만으로 판정.
// 텍스트가 명백히 긍정 + 명백한 개선 신호가 동시에 있으면 'mixed'.
export function combineRatingAndTextSentiment(rating, sig, opts = {}) {
  const ratingReliable = opts.ratingReliable !== false; // 기본 true (단일 리뷰 호출 호환)
  const usedRating = ratingReliable ? rating : null;

  // 헬퍼: 텍스트만으로 4-방향 판정. (positive | neutral | negative | mixed)
  const textOnly = () => {
    const diff = sig.positiveScore - sig.negativeScore;
    const strongPos = diff >= 1.0 || sig.hasClearSatisfaction;
    const strongNeg = diff <= -1.0 || sig.hasSevereComplaint;
    if (strongPos && strongNeg) return 'mixed';
    if (sig.hasSevereComplaint && !sig.hasClearSatisfaction) return 'negative';
    // 대조 구조 (X-는데 Y, X-지만 Y) + 양쪽 신호가 모두 있을 때:
    //   - 한쪽이 명백히 강하면 그 방향으로 (positive/negative).
    //   - 어느 쪽도 명백한 dominator 가 아니면 mixed.
    // 예: "딱입니다(강한 만족) + 살짝 작긴(약한 이슈)" → positive (개선 이슈는 따로 트랙)
    // 예: "적당(약한 만족) + 따갑(중간 이슈)" → mixed
    if (sig.contrastCount > 0 && sig.positiveScore > 0 && sig.negativeScore > 0) {
      if (strongPos && !strongNeg) return 'positive';
      if (strongNeg && !strongPos) return 'negative';
      return 'mixed';
    }
    if (diff >= 1.0) return 'positive';
    if (diff <= -1.0) return 'negative';
    // 기준선보다 완화된 임계 — 두 신호가 같은 방향으로 약간만 기울어도 분류.
    if (diff >= 0.6) return 'positive';
    if (diff <= -0.6) return 'negative';
    return 'neutral';
  };

  // 1) rating 사용 불가 — 텍스트만 사용
  if (usedRating == null) return textOnly();

  // 2 - pre) 별점이 2점이어도 본문이 강한 만족 + 강한 부정 0 + 명확한 긍정 점수
  //    가 있으면 텍스트가 이긴다. rating=1 은 더 강한 불만 신호라 이 override 대상이
  //    아니다. 예: rating=2 + "비싸긴해도 돈값을 함 / 거의 비긴에서만 사는데" → positive.
  if (rating === 2 && sig.strongNegativeCount === 0 && sig.hasClearSatisfaction && sig.positiveScore >= 1) {
    return 'positive';
  }

  // 2) Hard guard: 평점 4~5 + 강한 불만 없음 + 만족 표현 있음 → positive 보호
  if (rating >= 4 && sig.strongNegativeCount === 0 && sig.hasClearSatisfaction) {
    return 'positive';
  }
  // 2-1) 평점 4~5 + acceptance + 약한 이슈만 → positive 보호 (negative 금지)
  if (rating >= 4 && sig.strongNegativeCount === 0 && sig.acceptanceCount > 0) {
    return 'positive';
  }

  // 3) base score (별점)
  const baseByRating = { 1: -2.0, 2: -1.3, 3: 0, 4: 0.8, 5: 1.5 };
  let score = baseByRating[rating] ?? 0;
  score += sig.positiveScore - sig.negativeScore;
  if (sig.hasSevereComplaint) score -= 1.2;
  if (sig.hasClearSatisfaction) score += 0.5;
  if (sig.acceptanceCount > 0) score += 0.3;
  if (sig.mildNegativeCount > 0 && sig.strongNegativeCount === 0) score += 0.1;

  // 4) 평점별 하드 가드 (dirty data 보호)
  if (rating <= 2 && sig.hasSevereComplaint) return 'negative';
  if (rating === 1 && !sig.hasClearSatisfaction) return 'negative';
  // 평점 1~2 에서 텍스트가 압도적 긍정이면 neutral 까지만 완화
  if (rating <= 2 && score >= 0.6) return 'neutral';

  // 5) rating 3 는 neutral 기본을 강하게 — 약한 긍정/약한 부정으로는 안 흔들림.
  //    "X는 괜찮은데 Y가..." 같은 대조 구조 + 양쪽 신호가 모두 있으면 neutral 유지.
  if (rating === 3) {
    if (sig.hasSevereComplaint) return 'negative';
    // 대조 절 + 양쪽 신호: 명확한 만족 표현 없으면 neutral
    if (sig.contrastCount > 0 && sig.negativeScore > 0 && !sig.hasClearSatisfaction) {
      return 'neutral';
    }
    if (sig.hasClearSatisfaction && sig.strongNegativeCount === 0 && score >= 0.8) return 'positive';
    if (score >= 1.5) return 'positive';
    if (score <= -1.5) return 'negative';
    return 'neutral';
  }

  if (score >= 0.6) return 'positive';
  if (score <= -0.6) return 'negative';
  return 'neutral';
}

// 메인: rating + text 의 hybrid sentiment.
// opts.ratingReliable: 분석 배치 단위 rating 신뢰도 (기본 true — 단일 호출 호환).
export function detectSentiment(review, opts = {}) {
  const rating = normalizeRating(review.rating);
  const sig = analyzeTextSentiment(`${safeStr(review.title)}. ${safeStr(review.content)}`);
  return combineRatingAndTextSentiment(rating, sig, opts);
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
// opts.ratingReliable: 호출 측이 배치 단위로 판정한 rating 신뢰도. false 면 별점을
//   감성/이슈 보조 신호에서 무시한다.
export function classifyReview(review, opts = {}) {
  const sentiment = detectSentiment(review, opts);
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

  // 가격 양보 구조 감지 — "비싸긴해도 돈값" 류가 있으면 가격 issue 의 severity 를
  // low 로 강등하고 polarity 를 mixed/aspect 로 떨궈 차트에서 "가격 만족도 낮음" 으로
  // 표시되지 않게 한다. 실제 셀러 액션도 약하게.
  if (hasPriceConcession(text)) {
    for (const c of categories) {
      if (c.name === '가격/가성비') {
        c.severity = 'low';
        c.issuePolarity = 'mixed';
        c.isActionableIssue = true; // low severity issue 는 유지 (스펙 PART 2)
      }
    }
  }

  // 약한 긍정 보정 — "입기 좋을 거 같아요" 같은 표현이 있고 improvementIssue 도 있으면
  // sentiment 가 neutral 이라도 mixed 로 끌어올린다. 강한 negative 일 땐 건드리지 않음.
  let adjustedSentiment = sentiment;
  if (adjustedSentiment === 'neutral' && categories.length > 0 && hasWeakPositiveSignal(text)) {
    adjustedSentiment = 'mixed';
  }

  const ambiguous = categories.length === 0 && adjustedSentiment === 'negative';
  const { mentionedAspects, improvementIssues } = splitAspectAndIssue(categories);

  return {
    reviewId: review.id,
    productName: review.productName,
    rating: review.rating,
    ratingReliable: opts.ratingReliable !== false,
    sentiment: adjustedSentiment,
    ambiguous,
    categories,
    // 위 categories 를 두 축으로 분리 — 다운스트림에서 "반복 이슈 차트"는
    // improvementIssues 만 집계해야 한다.
    mentionedAspects,
    improvementIssues,
  };
}

// categories[] → { mentionedAspects, improvementIssues } 분리.
//   - improvementIssues: 실제 개선 신호가 있는 항목 (isActionableIssue=true & 카테고리 != '기타')
//   - mentionedAspects: 카테고리 언급만 있는 항목 (긍정 맥락 또는 부정 단서 부재).
//     ※ '기타' 는 둘 다에서 제외 (분석 의미 없음).
export function splitAspectAndIssue(categories = []) {
  const mentionedAspects = [];
  const improvementIssues = [];
  for (const cat of categories) {
    if (!cat || !cat.name || cat.name === '기타') continue;
    const isIssue = cat.isActionableIssue !== false &&
      (cat.issuePolarity === 'negative' || cat.issuePolarity === 'mixed');
    if (isIssue) {
      improvementIssues.push({
        category: cat.name,
        categoryLabel: cat.name,
        issueLabel: cat.issue || `${cat.name} 관련 의견`,
        severity: cat.severity || 'medium',
        evidence: cat.evidence || '',
      });
    } else {
      mentionedAspects.push({
        category: cat.name,
        categoryLabel: cat.name,
        sentiment: cat.issuePolarity === 'positive' ? 'positive'
          : cat.issuePolarity === 'mixed' ? 'mixed'
          : 'neutral',
      });
    }
  }
  return { mentionedAspects, improvementIssues };
}

// 전체 리뷰 분류 + 애매한 부정 리뷰만 LLM(또는 mock)에 위임.
// ratingReliable 미지정 시 입력 배치로 자동 판정 — 호출 측 부담을 줄임.
//
// opts.onProgress({ progress, step, processedReviews, totalReviews }) 가 주어지면
// 룰 분류 진행 + LLM ambiguous 호출 전/후로 progress 를 보고한다. opts.progressRange
// = [start, end] 로 25~45 같은 외부 구간을 지정 (runAnalysis 가 사용).
export async function classifyAll(reviews, aiClient, opts = {}) {
  const ratingReliable = opts.ratingReliable !== undefined
    ? Boolean(opts.ratingReliable)
    : isRatingReliable(reviews);
  const classifyOpts = { ratingReliable };
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const [pStart, pEnd] = Array.isArray(opts.progressRange) ? opts.progressRange : [25, 45];
  // 룰 기반 분류는 동기 빠른 연산 — 너무 자주 reporter 를 호출하지 않게 큰 batch 단위로만 보고.
  const batchSize = Math.max(50, Math.ceil(reviews.length / 8));
  const classifications = [];
  for (let i = 0; i < reviews.length; i++) {
    classifications.push(classifyReview(reviews[i], classifyOpts));
    if (onProgress && (i + 1 === reviews.length || (i + 1) % batchSize === 0)) {
      const ratio = (i + 1) / Math.max(1, reviews.length);
      // 룰 분류 단계는 외부 구간의 앞쪽 60% 만 차지 (LLM 호출 단계에 헤드룸을 남김).
      const progress = pStart + (pEnd - pStart) * ratio * 0.6;
      await onProgress({
        progress, step: 'classifying_reviews',
        processedReviews: i + 1, totalReviews: reviews.length,
      });
    }
  }
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));

  const ambiguous = classifications.filter((c) => c.ambiguous);
  if (ambiguous.length > 0 && aiClient) {
    // LLM bulk 호출 직전 progress — 사용자에게 "리뷰 맥락을 확인하고 있어요" 단계를 즉시 표시.
    // 이 호출 전에는 25% 가 멈춰 보이던 구간이 바로 이 지점.
    if (onProgress) {
      const progress = pStart + (pEnd - pStart) * 0.65;
      await onProgress({
        progress, step: 'classifying_ambiguous_pending',
        processedReviews: classifications.length, totalReviews: reviews.length,
      });
    }
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
    if (onProgress) {
      const progress = pStart + (pEnd - pStart) * 0.9;
      await onProgress({
        progress, step: 'classifying_ambiguous_done',
        processedReviews: classifications.length, totalReviews: reviews.length,
      });
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

  // LLM/기타 fallback 후 categories 가 바뀐 항목은 aspect/issue 분리도 다시 계산.
  for (const c of classifications) {
    const split = splitAspectAndIssue(c.categories);
    c.mentionedAspects = split.mentionedAspects;
    c.improvementIssues = split.improvementIssues;
    c.ratingReliable = ratingReliable;
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
