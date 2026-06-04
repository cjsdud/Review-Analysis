// 사이즈 방향 / 약한 긍정 / 카테고리 정규화 — rule + LLM 결과 양쪽이 공유하는 작은 헬퍼.
// rule classification 단계에서 이미 BUY_UP/BUY_DOWN 토큰으로 라벨 방향이 잡혀 있지만,
// LLM 이 recommendedActions 를 자유롭게 만들 때 반대 방향 문장이 새는 것을 막기 위한
// 마지막 guard 역할.

// 사이즈 방향 — 사용자가 "어떻게 가야 했는가" 를 표현했는지로 판단.
//   upsize:   "너무 딱 맞다 / 작다 / 타이트 / 크게 갈 걸 / 한 치수 크게 / 사이즈 업"
//   downsize: "너무 크다 / 헐렁 / 작게 갈 걸 / 한 치수 작게 / 사이즈 다운"
export function detectSizeDirection(text) {
  const raw = String(text || '');
  const normalized = raw.replace(/\s+/g, '');
  const upsize = [
    /너무딱맞/, /너무\s*딱\s*맞/,
    /타이트/, /작네요/, /작아요/, /작은데/, /낑/, /꽉\s*끼/, /꽉\s*껴/,
    /크게.*갈\s*걸/, /크게.*살\s*걸/, /크게.*시킬\s*걸/, /크게.*샀어야/, /크게.*갔어야/,
    /한\s*치수\s*크/, /한\s*사이즈\s*크/, /사이즈\s*업/,
    /\d\s*사이즈\s*갈\s*걸/, /\d\s*사이즈\s*살\s*걸/,
    /여유.*큰\s*사이즈/,
  ];
  const downsize = [
    /너무\s*크/, /헐렁/, /벙벙/, /넉넉/,
    /품이\s*크/, /허리가\s*크/,
    /작게.*갈\s*걸/, /작게.*살\s*걸/, /작게.*시킬\s*걸/, /작게.*샀어야/, /작게.*갔어야/,
    /한\s*치수\s*작/, /한\s*사이즈\s*작/, /사이즈\s*다운/,
  ];
  // raw + normalized 둘 다 검사 — 공백 변형 흡수.
  for (const p of upsize)   { if (p.test(raw) || p.test(normalized)) return 'upsize'; }
  for (const p of downsize) { if (p.test(raw) || p.test(normalized)) return 'downsize'; }
  return 'unknown';
}

// 약한 긍정 — "입기 좋을 것 같아요 / 무난 / 나쁘지 않" 처럼 적극적인 만족은 아니지만
// neutral 보다는 한 단계 위. improvementIssue 가 있으면 neutral → mixed 로 끌어올리는 데 사용.
export function hasWeakPositiveSignal(text) {
  if (!text) return false;
  return /(입기\s*좋|좋을\s*것\s*같|좋을거같|괜찮을\s*것\s*같|괜찮을거같|무난|나쁘지\s*않)/.test(String(text));
}

// LLM 이나 rule 이 만든 recommendedActions 의 방향을 최종 검증.
//   upsize 방향 리뷰 → "다운/작게/한 치수 작" 문장 제거 + 올바른 upsize 문장 추가.
//   downsize 방향 리뷰 → "업/크게/한 치수 크" 문장 제거 + 올바른 downsize 문장 추가.
//   unknown → dedupe 만.
export function sanitizeSizeRecommendationActions({ actions, text }) {
  const arr = (Array.isArray(actions) ? actions : []).filter(Boolean).map((s) => String(s));
  const direction = detectSizeDirection(text);
  let next = arr;
  if (direction === 'upsize') {
    // upsize 리뷰 — 작게/다운 방향 문장 모두 제거.
    next = arr.filter((a) => !/(한\s*치수\s*작|한\s*치수만\s*작|한\s*치수\s*다운|작게\s*선택|작게\s*추천|작게\s*사세요|사이즈\s*다운|다운\s*추천|"\s*다운\s*"|다운\s*가이드)/.test(a));
    next.push('여유 있는 핏을 원하는 고객에게는 한 치수 크게 선택하도록 사이즈 가이드를 보강하세요.');
  } else if (direction === 'downsize') {
    // downsize 리뷰 — 크게/업 방향 문장 모두 제거.
    next = arr.filter((a) => !/(한\s*치수\s*크|한\s*치수만\s*크|한\s*치수\s*업|크게\s*선택|크게\s*추천|크게\s*사세요|사이즈\s*업|업\s*추천|"\s*업\s*"|업\s*가이드)/.test(a));
    next.push('정핏을 원하는 고객에게는 한 치수 작게 선택할 수 있도록 사이즈 가이드를 보강하세요.');
  }
  // dedupe — 공백/구두점 정규화 후 비교.
  const seen = new Set();
  const out = [];
  for (const a of next) {
    const key = a.replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// mentionedAspects / improvementIssues 의 category 키를 영어 슬러그로 통일.
// 표시는 categoryLabel 한국어 그대로. 내부 집계/필터에는 영어 키 사용.
const CATEGORY_KEY_MAP = {
  // 한글 (rule 기반 결과) → 영어
  '가격/가성비': 'price',
  '가격': 'price',
  '가성비': 'price',
  '사이즈': 'size_fit',
  '핏/실루엣': 'size_fit',
  '색상/화면 차이': 'color',
  '소재/두께': 'material',
  '마감/불량': 'quality',
  '착용감': 'comfort',
  '세탁/내구성': 'durability',
  '배송/포장': 'delivery',
  '기타': 'other',
};
const CATEGORY_LABEL_MAP = {
  price: '가격/가성비',
  size_fit: '사이즈/핏',
  color: '색상/화면 차이',
  material: '소재/두께',
  quality: '마감/불량',
  comfort: '착용감',
  durability: '세탁/내구성',
  delivery: '배송/포장',
  other: '기타',
};
export function normalizeCategoryKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'other';
  if (CATEGORY_LABEL_MAP[raw]) return raw; // 이미 영어 슬러그
  return CATEGORY_KEY_MAP[raw] || raw.toLowerCase().replace(/[^a-z_]/g, '') || 'other';
}
export function categoryLabelFor(key) {
  return CATEGORY_LABEL_MAP[normalizeCategoryKey(key)] || String(key);
}
