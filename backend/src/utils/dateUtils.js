// 다양한 형태의 날짜 문자열을 ISO(YYYY-MM-DD)로 정규화

export function looksLikeDate(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  return /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(s) || /^\d{4}\d{2}\d{2}$/.test(s);
}

export function parseDate(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;

  // YYYYMMDD
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // YYYY[.-/]M[.-/]D
  m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    return `${m[1]}-${mm}-${dd}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return undefined;
}
