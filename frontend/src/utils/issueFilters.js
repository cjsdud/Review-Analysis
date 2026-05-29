// 전체 발견 이슈 모달용 순수 로직 (JSX 없음 → node 에서 테스트 가능).
// - buildIssueFilters: '전체' 고정 + 카테고리별 발견 건수 내림차순, count 0 숨김
// - sortIssues: 이슈 리스트 정렬 (기본 '많이 나온 순')

const SEV_RANK = { high: 3, medium: 2, low: 1 };

// allIssues → 필터 목록. '전체' 가 항상 첫 번째.
// 각 카테고리 count 는 해당 카테고리 이슈들의 count 합계.
export function buildIssueFilters(allIssues = []) {
  const categoryCounts = allIssues.reduce((acc, issue) => {
    const category = issue.category || '기타';
    // count 가 없으면 1건으로 fallback. TODO: 모든 이슈에 count 가 보장되면 fallback 제거.
    acc[category] = (acc[category] || 0) + (issue.count || 1);
    return acc;
  }, {});
  const totalIssueCount = Object.values(categoryCounts).reduce((sum, n) => sum + n, 0);
  return [
    { label: '전체', value: '전체', count: totalIssueCount },
    ...Object.entries(categoryCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([category, count]) => ({ label: category, value: category, count })),
  ];
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
    // 최신 리뷰 포함 순 — latestCreatedAt 메타가 있을 때만 의미. 없으면 count 순.
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
