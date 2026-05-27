// 텍스트 정규화/비교 유틸

export function normalizeKey(s) {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_\-/.()[\]]/g, '')
    .trim();
}

export function isLongText(v) {
  return typeof v === 'string' && v.trim().length >= 15;
}

export function safeStr(v) {
  if (v == null) return '';
  return String(v).trim();
}

// 매우 단순한 한국어 문장 토큰화 (이슈 클러스터링용)
export function tokenize(text) {
  return safeStr(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

// 두 텍스트의 단순 자카드 유사도
export function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
