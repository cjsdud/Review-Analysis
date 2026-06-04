// 다양한 형태의 날짜 문자열/값을 YYYY-MM-DD 로 정규화.
//
// 지원 형식 (실측 운영 데이터 + spec):
//   - 2026-05-30 / 2026.05.30 / 2026/05/30
//   - 2026-05-30 13:20:55  / 2026.05.30 13:20  / 2026/05/30T13:20:55
//   - 25.05.30  (yy.mm.dd → 2000년대로 가정)
//   - 2026년 5월 30일 / 2026년 05월 30일 / 2026 년 5 월 30 일
//   - 2026. 5. 30.
//   - 20260530 (YYYYMMDD)
//   - Excel 직렬 날짜(serial) — 숫자 또는 숫자 문자열, 1899-12-30 기준 1=1900-01-01, 60=1900-03-01(엑셀 1900윤년 버그 흡수).
//     너무 작거나 큰 숫자(예: 0, 200000) 는 거절.
//
// timezone 처리:
//   - new Date(s) 로 ISO 문자열을 파싱하면 브라우저/노드의 로컬 timezone 영향으로
//     "2026-05-30" 이 하루 밀려서 "2026-05-29" 로 보이는 케이스가 있다 (UTC 자정 - 9시간 = 전날).
//   - 본 모듈은 항상 YYYY-MM-DD 문자열을 직접 추출하거나, Date 객체에서 UTC 메서드로 추출해
//     timezone 영향이 없게 한다.

export function looksLikeDate(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  if (/^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(s)) return true;
  if (/^\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(s)) return true;
  if (/^\d{4}\d{2}\d{2}$/.test(s)) return true;
  if (/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/.test(s)) return true;
  // Excel serial — 양의 정수/소수가 합리적 범위면 날짜로 간주.
  const n = Number(s);
  if (Number.isFinite(n) && n >= 59 && n <= 100000) return true;
  return false;
}

// pad helper
function pad2(n) { return String(n).padStart(2, '0'); }

// 두 자리 연도 → 4자리. 00~69 는 2000~2069, 70~99 는 1970~1999 로 변환.
// 패션 이커머스 리뷰 데이터 기준 1900년대 데이터는 사실상 없으므로 단순 룰.
function expandTwoDigitYear(yy) {
  const n = Number(yy);
  if (n < 70) return 2000 + n;
  return 1900 + n;
}

// Excel 직렬 날짜 (1899-12-30 기준) → YYYY-MM-DD.
// Excel 의 1900윤년 버그(존재하지 않는 1900-02-29) 보정: serial >= 60 이면 -1.
function excelSerialToDate(serial) {
  const s = Number(serial);
  if (!Number.isFinite(s) || s < 1) return null;
  // 1899-12-30 기준 + 보정.
  const base = Date.UTC(1899, 11, 30);
  const days = s >= 60 ? Math.floor(s) - 1 : Math.floor(s);
  const ms = base + days * 86400 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// 유효성 검사 — y/m/d 가 실제로 존재하는 날짜인지.
function isValidYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function buildYmd(y, m, d) {
  if (!isValidYmd(y, m, d)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// 메인 정규화 — 모든 호출자가 사용. 입력 다양성을 흡수하고
// 유효하면 YYYY-MM-DD, 아니면 null 을 반환.
export function normalizeReviewDate(value) {
  if (value == null || value === '') return null;

  // 이미 Date 객체.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // 숫자만(공백/소수 포함) — Excel serial 가능성.
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    // YYYYMMDD 가 우선 (20260530 → 2026/05/30).
    if (/^\d{8}$/.test(raw)) {
      const y = Number(raw.slice(0, 4));
      const m = Number(raw.slice(4, 6));
      const d = Number(raw.slice(6, 8));
      const out = buildYmd(y, m, d);
      if (out) return out;
    }
    // Excel serial — 1900-01-01 부근 ~ 2100 안쪽 (대략 1 ~ 73050).
    if (n >= 59 && n <= 100000) {
      const out = excelSerialToDate(n);
      if (out) return out;
    }
    return null;
  }

  // 한글 YYYY년 M월 D일.
  let m = raw.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return buildYmd(Number(m[1]), Number(m[2]), Number(m[3]));

  // YYYY[.-/]M[.-/]D  (시간/추가 텍스트 무시)
  m = raw.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (m) return buildYmd(Number(m[1]), Number(m[2]), Number(m[3]));

  // YY[.-/]M[.-/]D  (25.05.30 → 2025-05-30)
  m = raw.match(/^(\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (m) {
    const y = expandTwoDigitYear(m[1]);
    return buildYmd(y, Number(m[2]), Number(m[3]));
  }

  // fallback: new Date — 영문 long form 등. UTC 메서드로 timezone 영향 없이 추출.
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    // 입력에 timezone 정보가 없으면 로컬 자정으로 해석되어 UTC 기준 전날이 될 수 있다.
    // 입력이 단순 'YYYY-MM-DD' 였다면 위에서 잡혔어야 하므로 여기 도달하면 시간 정보가 있다고 가정.
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  }
  return null;
}

// 하위 호환 — 기존 코드에서 parseDate 를 부르는 경우 (uploadParser) normalizeReviewDate 로 동일 처리.
// 반환값: 정규화된 YYYY-MM-DD 또는 undefined (parseDate 는 undefined 를 반환하던 컨벤션 유지).
export function parseDate(v) {
  const out = normalizeReviewDate(v);
  return out || undefined;
}
