// 키워드 추출 + 추이 집계 서비스.
// productAnalysis.service.js 에서 reviews + classifications 로 호출한다.
// 기존 구조는 건드리지 않고, 신규 필드만 추가한다.
//
// 출력:
//   - extractPositiveKeywords(reviews, classifications)  → product 단위 긍정 키워드 (대표 리뷰 포함)
//   - extractFrequentKeywords(reviews, classifications)  → product 단위 일반 키워드 + sentimentHint
//   - buildReviewTrends(reviews, classifications)        → 일별 시계열 집계
//
// 모두 텍스트 길이/매칭 기반 규칙 — LLM 호출 없음.

// ───── 1) 긍정 키워드 매핑 ─────
// 동의어/유사 표현을 묶기 위해 (라벨, 매칭 패턴) 형태로 정의.
// 키워드 라벨은 사용자에게 노출되는 자연어 표현.
const POSITIVE_KEYWORD_RULES = [
  { label: '핏 예쁨',         patterns: ['핏이 예쁘', '핏이 이쁘', '핏 예쁘', '핏 이쁘', '핏 예뻐', '핏 이뻐', '라인이 예쁘', '라인 예쁘', '맵시', '핏감 좋', '핏감이 좋'] },
  { label: '색감 좋음',       patterns: ['색감 좋', '색감이 좋', '색이 예쁘', '색이 이쁘', '색이 예뻐', '색 예쁘', '색 이쁘', '컬러 예쁘', '컬러 이쁘', '톤이 예쁘', '톤이 이쁘'] },
  { label: '재질 좋음',       patterns: ['재질이 좋', '재질 좋', '소재가 좋', '소재 좋', '원단이 좋', '원단 좋', '원단 탄탄', '원단이 탄탄'] },
  { label: '편함',            patterns: ['편해요', '편하고', '편합니', '편하게', '편안', '착용감 좋', '착용감이 좋', '입기 편', '입었을 때 편', '입으니 편'] },
  { label: '배송 빠름',       patterns: ['배송 빠르', '배송이 빠르', '배송도 빠르', '빠른 배송', '빨리 왔', '빨리 도착', '하루 만에', '바로 왔'] },
  { label: '가성비 좋음',     patterns: ['가성비 좋', '가성비가 좋', '가격 대비 좋', '가격대비 좋', '가격 대비 만족', '가격 생각하면', '이 가격에', '저렴한데'] },
  { label: '재구매 의사',     patterns: ['재구매', '또 사고 싶', '더 사고 싶', '다음에도', '또 구매', '추가로 사', '색상별로 더'] },
  { label: '만족',            patterns: ['만족합니', '만족해요', '만족스러', '대만족', '만족스러운 편', '충분히 만족'] },
  { label: '추천',            patterns: ['추천합니', '추천해요', '강추', '추천드려', '추천드립', '추천이에요'] },
  { label: '부드러움',         patterns: ['부드럽', '부드러워', '보들보들', '촉감 좋', '촉감이 좋'] },
  { label: '사이즈 잘 맞음',   patterns: ['사이즈 잘 맞', '사이즈 딱', '정사이즈', '딱 맞', '잘 맞아요', '잘 맞고', '잘 맞습니', '핏이 딱'] },
  { label: '포장 좋음',       patterns: ['포장 좋', '포장이 좋', '포장 깔끔', '포장이 깔끔', '포장도 좋', '포장도 깔끔', '꼼꼼한 포장'] },
  { label: '퀄리티 좋음',     patterns: ['퀄리티 좋', '퀄리티가 좋', '품질이 좋', '품질 좋', '퀄리티 대비', '품질 대비'] },
  { label: '디자인 예쁨',     patterns: ['디자인 예쁘', '디자인이 예쁘', '디자인 이쁘', '디자인이 이쁘', '디자인 좋', '디자인이 좋'] },
  { label: '두께감 좋음',     patterns: ['두께감 좋', '두께 적당', '두께가 적당', '도톰', '두툼해서 좋'] },
  { label: '비침 없음',       patterns: ['비침 없', '비침이 없', '비침 거의 없', '비침이 거의 없', '안 비침', '비치지 않'] },
  { label: '마감 좋음',       patterns: ['마감 좋', '마감이 좋', '마감 깔끔', '마감이 깔끔', '박음질 좋', '박음질이 좋', '꼼꼼하게', '실밥 없'] },
];

// ───── 2) 일반(주제) 키워드 매핑 ─────
// 쇼핑몰 리뷰에서 자주 언급되는 상품 속성/카테고리 단어.
// 단순 substring 매칭 (조사/어미 포함되어도 잡힘).
// 너무 일반적인 단어("진짜","너무","구매","상품") 는 제외 (BLOCKED_WORDS).
const FREQUENT_KEYWORD_RULES = [
  { label: '사이즈',   patterns: ['사이즈', '치수', '한 치수', '한 사이즈'] },
  { label: '색상',     patterns: ['색상', '색감', '컬러', '톤'] },
  { label: '배송',     patterns: ['배송', '택배', '발송', '도착'] },
  { label: '포장',     patterns: ['포장', '박스', '상자'] },
  { label: '재질',     patterns: ['재질', '소재', '원단', '촉감'] },
  { label: '착용감',   patterns: ['착용감', '입었을 때', '입으니', '입을 때'] },
  { label: '가격',     patterns: ['가격', '가성비', '값', '돈'] },
  { label: '냄새',     patterns: ['냄새', '향', '향기'] },
  { label: '길이',     patterns: ['길이', '기장', '총장', '밑단'] },
  { label: '두께',     patterns: ['두께', '두께감', '두툼', '얇은', '얇아', '얇네'] },
  { label: '핏',       patterns: ['핏', '실루엣', '라인', '맵시'] },
  { label: '디자인',   patterns: ['디자인', '스타일'] },
  { label: '마감',     patterns: ['마감', '박음질', '봉제', '시접', '실밥'] },
  { label: '내구성',   patterns: ['내구', '튼튼', '오래', '변형', '늘어'] },
  { label: '세탁',     patterns: ['세탁', '드라이', '물빨래'] },
  { label: '비침',     patterns: ['비침', '비쳐', '비치'] },
  { label: '허리',     patterns: ['허리'] },
  { label: '어깨',     patterns: ['어깨'] },
  { label: '소매',     patterns: ['소매', '팔이', '팔길이', '팔 길이'] },
  { label: '재구매',   patterns: ['재구매', '또 사고', '더 사고', '다음에도'] },
];

// 키워드 평가에서 제외할 흔한 빈도 높은 보조어/의미 약한 단어
// (FREQUENT_KEYWORD_RULES 의 label 과 충돌하지 않도록 단어 단위로만 사용)
const BLOCKED_WORDS = new Set([
  '진짜', '너무', '완전', '정말', '그냥', '구매', '상품', '제품', '이번', '오늘',
  '아주', '많이', '조금', '약간', '살짝', '바로',
]);

// 한 텍스트에서 키워드 룰을 매칭. 한 룰이 잡히면 1 카운트(중복 매칭은 합산 X).
function matchRules(text, rules) {
  if (!text) return [];
  const t = String(text);
  const hits = [];
  for (const rule of rules) {
    if (rule.patterns.some((p) => t.includes(p))) hits.push(rule.label);
  }
  return hits;
}

// 한 텍스트가 BLOCKED_WORDS 만으로 구성되었는지 확인 (현재 미사용이지만 향후 확장 대비)
export function isBlockedOnly(text) {
  if (!text) return true;
  const tokens = String(text).split(/\s+/).filter(Boolean);
  return tokens.every((w) => BLOCKED_WORDS.has(w));
}

// 대표 리뷰 1~3개 선별 — content 길이 적당하고 매칭 텍스트가 포함된 리뷰 우선.
function pickEvidence(reviews, matchPatterns, max = 3) {
  const ok = reviews
    .filter((r) => r.content && matchPatterns.some((p) => r.content.includes(p)))
    .sort((a, b) => {
      // 30~120자 사이 길이 가산점, 별점 높은 순(긍정), createdAt 최신 순
      const lenScoreA = a.content.length >= 30 && a.content.length <= 200 ? 2 : 0;
      const lenScoreB = b.content.length >= 30 && b.content.length <= 200 ? 2 : 0;
      if (lenScoreB !== lenScoreA) return lenScoreB - lenScoreA;
      const ra = a.rating ?? 0;
      const rb = b.rating ?? 0;
      if (rb !== ra) return rb - ra;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  return ok.slice(0, max).map((r) => ({
    reviewId: r.id || r.reviewId || null,
    content: r.content.length > 160 ? r.content.slice(0, 160) + '…' : r.content,
    rating: r.rating ?? null,
    date: r.createdAt || null,
  }));
}

// ───── 긍정 키워드 추출 ─────
// 긍정으로 분류된 리뷰(또는 별점 4~5)에서만 매칭.
// 입력: reviews(ReviewNormalized[]), classifications(ReviewClassification[])
// 출력: [{ keyword, count, ratio, evidenceReviews }] (count desc)
export function extractPositiveKeywords(reviews, classifications) {
  const clsById = new Map((classifications || []).map((c) => [c.reviewId, c]));
  const total = reviews.length || 1;
  const tallies = new Map(); // label → { count, reviews: [r…] }
  for (const r of reviews) {
    const c = clsById.get(r.id);
    const isPositiveReview =
      c?.sentiment === 'positive' || (typeof r.rating === 'number' && r.rating >= 4);
    if (!isPositiveReview) continue;
    const text = `${r.title || ''} ${r.content || ''}`;
    for (const label of matchRules(text, POSITIVE_KEYWORD_RULES)) {
      const entry = tallies.get(label) || { count: 0, reviews: [] };
      entry.count++;
      entry.reviews.push(r);
      tallies.set(label, entry);
    }
  }
  const result = [];
  for (const rule of POSITIVE_KEYWORD_RULES) {
    const e = tallies.get(rule.label);
    if (!e || e.count === 0) continue;
    result.push({
      keyword: rule.label,
      count: e.count,
      ratio: Number((e.count / total).toFixed(3)),
      evidenceReviews: pickEvidence(e.reviews, rule.patterns, 3),
    });
  }
  return result.sort((a, b) => b.count - a.count);
}

// ───── 일반(주제) 키워드 추출 ─────
// 모든 리뷰 대상 매칭. 각 키워드의 sentimentHint 는 매칭된 리뷰들의 sentiment 분포로 결정.
//   positive >= 0.6  → 'positive'
//   negative >= 0.4  → 'negative'
//   둘 다 >= 0.3     → 'mixed'
//   else             → 'neutral'
function deriveSentimentHint(reviews, clsById) {
  let pos = 0, neg = 0, neu = 0;
  for (const r of reviews) {
    const s = clsById.get(r.id)?.sentiment || 'neutral';
    if (s === 'positive') pos++;
    else if (s === 'negative') neg++;
    else neu++;
  }
  const n = pos + neg + neu || 1;
  const pr = pos / n;
  const nr = neg / n;
  if (pr >= 0.6) return 'positive';
  if (nr >= 0.4) return 'negative';
  if (pr >= 0.3 && nr >= 0.3) return 'mixed';
  return 'neutral';
}

export function extractFrequentKeywords(reviews, classifications) {
  const clsById = new Map((classifications || []).map((c) => [c.reviewId, c]));
  const total = reviews.length || 1;
  const tallies = new Map();
  for (const r of reviews) {
    const text = `${r.title || ''} ${r.content || ''}`;
    for (const label of matchRules(text, FREQUENT_KEYWORD_RULES)) {
      const entry = tallies.get(label) || { count: 0, reviews: [] };
      entry.count++;
      entry.reviews.push(r);
      tallies.set(label, entry);
    }
  }
  const result = [];
  for (const rule of FREQUENT_KEYWORD_RULES) {
    const e = tallies.get(rule.label);
    if (!e || e.count === 0) continue;
    const sentimentHint = deriveSentimentHint(e.reviews, clsById);
    result.push({
      keyword: rule.label,
      count: e.count,
      ratio: Number((e.count / total).toFixed(3)),
      sentimentHint,
      evidenceReviews: pickEvidence(e.reviews, rule.patterns, 2),
    });
  }
  return result.sort((a, b) => b.count - a.count);
}

// ───── 일별 리뷰 추이 ─────
// 입력 리뷰의 createdAt 을 YYYY-MM-DD 로 정규화(YYYY.MM.DD 도 지원).
// 파싱 실패하거나 빈 값이면 해당 리뷰는 추이에서 제외(전체 분석은 영향 없음).
function normalizeDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  // 흔한 4가지 패턴: 2026-04-02 / 2026.04.02 / 2026/04/02 / 2026-04-02T12:34:56
  const m = str.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return null;
  const [, y, mm, dd] = m;
  const yi = Number(y);
  const mi = Number(mm);
  const di = Number(dd);
  if (yi < 2000 || yi > 2100 || mi < 1 || mi > 12 || di < 1 || di > 31) return null;
  return `${y}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}`;
}

// 의미 있는 actionable 이슈가 1개 이상 있는지 — productAnalysis 의 meaningfulCategories 와 동일 정의
function hasMeaningfulIssue(classification) {
  return (classification?.categories || []).some(
    (cat) => cat.name && cat.name !== '기타' && cat.isActionableIssue !== false,
  );
}

// 입력: reviews + classifications
// 출력: [{ date, reviewCount, positiveCount, neutralCount, negativeCount, issueReviewCount, averageRating }]
//        오름차순 (date asc). 날짜 없는 리뷰는 제외.
export function buildReviewTrends(reviews, classifications) {
  const clsById = new Map((classifications || []).map((c) => [c.reviewId, c]));
  const buckets = new Map(); // date → { reviews:[], cls:[], ratings:[] }
  for (const r of reviews) {
    const d = normalizeDate(r.createdAt);
    if (!d) continue;
    const b = buckets.get(d) || { reviews: 0, pos: 0, neu: 0, neg: 0, issue: 0, ratings: [] };
    b.reviews++;
    const c = clsById.get(r.id);
    const s = c?.sentiment || 'neutral';
    if (s === 'positive') b.pos++;
    else if (s === 'negative') b.neg++;
    else b.neu++;
    if (hasMeaningfulIssue(c)) b.issue++;
    if (typeof r.rating === 'number') b.ratings.push(r.rating);
    buckets.set(d, b);
  }
  const series = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      reviewCount: b.reviews,
      positiveCount: b.pos,
      neutralCount: b.neu,
      negativeCount: b.neg,
      issueReviewCount: b.issue,
      averageRating: b.ratings.length
        ? Number((b.ratings.reduce((s, n) => s + n, 0) / b.ratings.length).toFixed(2))
        : null,
    }));
  return series;
}
