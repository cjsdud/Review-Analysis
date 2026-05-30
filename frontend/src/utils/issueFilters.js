// 전체 발견 이슈 모달용 순수 로직 (JSX 없음 → node 에서 테스트 가능).
// - normalizeIssueCategory: 카테고리 이름 변형을 canonical 로 통일
// - isDisplayableIssue:    UI 에 실제로 표시될 이슈만 통과 (chip count 와 목록 일치 보장)
// - buildIssueFilters:     visibleIssues 기준 카테고리별 카드 수 + (별도) 리뷰 수 합계 계산
// - filterIssuesByCategory: 카드 list 를 normalize 한 카테고리로 필터
// - sortIssues:            이슈 리스트 정렬 (기본 '많이 나온 순')
//
// 카운트 규칙 (사용자 혼란 방지):
//   * chip 옆 숫자 = 해당 카테고리의 이슈 카드 개수 (issue 종류 수)
//   * 카드 내부 "N건" = 해당 이슈가 언급된 리뷰 수 (issue.count)
//   * categoryReviewCounts 는 리뷰 수 합계가 필요할 때만 별도로 쓰는 보조 metric

const SEV_RANK = { high: 3, medium: 2, low: 1 };

// 표준 카테고리명 (backend FASHION_CATEGORIES 와 동일해야 함)
const CANONICAL = [
  '사이즈', '핏/실루엣', '색상/화면 차이', '소재/두께', '마감/불량',
  '착용감', '세탁/내구성', '배송/포장', '가격/가성비', '기타',
];

// 변형 → canonical 매핑. backend 가 항상 canonical 을 내려주지만 LLM/사용자 수정으로
// 변형이 섞일 가능성에 대비한 안전망. chip/필터/카운트가 같은 키를 사용하도록 통일.
const CATEGORY_ALIAS = new Map([
  ['사이즈/핏', '사이즈'],
  ['핏/사이즈', '사이즈'],
  ['착용감/사이즈', '사이즈'],
  ['핏', '핏/실루엣'],
  ['실루엣', '핏/실루엣'],
  ['색상', '색상/화면 차이'],
  ['컬러', '색상/화면 차이'],
  ['화면 차이', '색상/화면 차이'],
  ['색상/화면차이', '색상/화면 차이'],
  ['색상 차이', '색상/화면 차이'],
  ['소재', '소재/두께'],
  ['두께', '소재/두께'],
  ['원단', '소재/두께'],
  ['재질', '소재/두께'],
  ['마감', '마감/불량'],
  ['불량', '마감/불량'],
  ['하자', '마감/불량'],
  ['배송', '배송/포장'],
  ['포장', '배송/포장'],
  ['택배', '배송/포장'],
  ['세탁', '세탁/내구성'],
  ['내구성', '세탁/내구성'],
  ['가격', '가격/가성비'],
  ['가성비', '가격/가성비'],
]);

export function normalizeIssueCategory(raw) {
  if (!raw) return '기타';
  const s = String(raw).trim();
  if (!s) return '기타';
  if (CANONICAL.includes(s)) return s;
  if (CATEGORY_ALIAS.has(s)) return CATEGORY_ALIAS.get(s);
  // 공백/슬래시 변형 normalize 후 재시도
  const compact = s.replace(/\s+/g, '');
  for (const [k, v] of CATEGORY_ALIAS) {
    if (k.replace(/\s+/g, '') === compact) return v;
  }
  return s; // 알 수 없는 카테고리는 그대로 (별도 그룹으로 표시)
}

// UI 에 실제로 표시되는 이슈만 통과. chip count 가 표시 목록과 일치하도록.
//  - issueLabel 없음 → 제외 (generic '~ 관련 의견' 같은 fallback)
//  - isActionableIssue === false → 제외 (개선 권고가 어려운 신호)
//  - count <= 0 → 제외
export function isDisplayableIssue(issue) {
  if (!issue) return false;
  if (!issue.issueLabel) return false;
  if (issue.isActionableIssue === false) return false;
  if (typeof issue.count === 'number' && issue.count <= 0) return false;
  return true;
}

// allIssues → 필터 목록. '전체' 가 항상 첫 번째.
// chip count = 해당 카테고리의 displayable 이슈 카드 개수.
// 옵션으로 categoryReviewCounts 도 함께 반환 (사용 측에서 필요하면 참조).
export function buildIssueFilters(allIssues = []) {
  const visible = allIssues.filter(isDisplayableIssue);

  const cardCounts = new Map();      // category → 이슈 카드 개수
  const reviewCounts = new Map();    // category → 리뷰 수 합계 (보조)
  for (const issue of visible) {
    const category = normalizeIssueCategory(issue.category);
    cardCounts.set(category, (cardCounts.get(category) || 0) + 1);
    const c = Number(issue.count);
    if (Number.isFinite(c) && c > 0) {
      reviewCounts.set(category, (reviewCounts.get(category) || 0) + c);
    }
  }

  const total = visible.length;
  const filters = [
    { label: '전체', value: '전체', count: total, reviewCount: total },
    ...[...cardCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([category, count]) => ({
        label: category,
        value: category,
        count,                                   // 이슈 카드 수 (chip 표시용)
        reviewCount: reviewCounts.get(category) || 0,
      })),
  ];
  return filters;
}

// 카테고리 라벨로 카드 필터 — chip 과 동일한 normalize 적용.
export function filterIssuesByCategory(allIssues = [], category = '전체') {
  const visible = allIssues.filter(isDisplayableIssue);
  if (!category || category === '전체') return visible;
  return visible.filter((i) => normalizeIssueCategory(i.category) === category);
}

// 정렬: 'count'(기본) | 'severity' | 'category' | 'recent'
// count → severity → ratio → issueLabel 가나다 순으로 tie-break.
export function sortIssues(list, sortBy = 'count') {
  const arr = [...list];
  if (sortBy === 'severity') {
    arr.sort(
      (a, b) =>
        (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) ||
        (b.count || 0) - (a.count || 0) ||
        (b.ratio || 0) - (a.ratio || 0),
    );
  } else if (sortBy === 'category') {
    arr.sort((a, b) => (a.category || '').localeCompare(b.category || '') || (b.count || 0) - (a.count || 0));
  } else if (sortBy === 'recent') {
    arr.sort(
      (a, b) =>
        String(b.latestCreatedAt || '').localeCompare(String(a.latestCreatedAt || '')) ||
        (b.count || 0) - (a.count || 0),
    );
  } else {
    arr.sort(
      (a, b) =>
        (b.count || 0) - (a.count || 0) ||
        (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) ||
        (b.ratio || 0) - (a.ratio || 0) ||
        (a.issueLabel || '').localeCompare(b.issueLabel || ''),
    );
  }
  return arr;
}
