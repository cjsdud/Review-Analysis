// 파일 파싱 + 시트/헤더 자동 감지.
// XLSX 의 경우 여러 시트가 있을 수 있어 다음을 함께 처리한다.
//   - 모든 시트 메타(rowCount, columnCount, detectedHeaderRowIndex, score, reason) 계산
//   - 리뷰 데이터일 가능성이 높은 시트를 자동 추천(selectedSheetName)
//   - 각 시트별 상위 20행에서 헤더 행 자동 감지 (안내문/타이틀 행 회피)
//   - 모든 시트의 matrix/headers/rows 를 sheetParseResults 에 미리 계산해 응답에 포함
//     (프론트가 시트/헤더 행을 바꾸면 reparse API 가 저장된 matrix 로 재계산)
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

// 헤더 후보 어휘 (시트 점수 + 헤더 행 점수 공용)
const HEADER_CANDIDATE_NAMES = [
  '상품명', '제품명', '옵션', '옵션명', '옵션정보', '별점', '평점',
  '리뷰제목', '제목', '리뷰내용', '리뷰', '후기', '내용', '상품평',
  '작성일', '등록일', '리뷰작성일', '답글', '판매자답글', '댓글',
  '리뷰ID', '리뷰번호', '후기번호', '작성자', '아이디', '닉네임',
  'product_name', 'product', 'rating', 'review', 'comment', 'date',
  'title', 'writer', 'reply', 'review_id',
];

// 시트명에 들어가면 가산점 / 감점이 되는 키워드
const SHEET_NAME_POSITIVE = ['리뷰', '후기', '상품평', '데이터', 'review'];
const SHEET_NAME_NEGATIVE = ['readme', '요약', 'summary', '설명', 'guide', '가이드', 'help', '안내'];

// 데이터처럼 보이는 셀 (별점/날짜/긴 텍스트) — 헤더 행 다음 행 데이터 보너스
function looksLikeDataCell(s) {
  if (!s) return false;
  if (/^[1-5](\.\d)?$/.test(s)) return true; // 별점
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(s)) return true; // 날짜
  if (s.length > 20) return true; // 긴 텍스트(리뷰 본문)
  return false;
}

// 안내문/타이틀 패턴 (점수 감점)
const NOTE_RE = /(리뷰핏\s*샘플|아래\s*데이터는|예시\s*입니다|readme|^\s*안내|타이틀|^설명)/i;

function isHeaderCandidateText(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!v) return false;
  return HEADER_CANDIDATE_NAMES.some((c) => {
    const cl = c.toLowerCase();
    return v === cl || v.includes(cl) || cl.includes(v);
  });
}

// 상위 20행에서 헤더 행 후보를 점수화해 반환
// matrix: rows of cell arrays (raw values, 빈 행 포함될 수 있음)
function detectHeaderRow(matrix) {
  const cap = Math.min(matrix.length, 20);
  let best = { index: 0, score: -Infinity, headers: [], reason: '기본값' };
  for (let i = 0; i < cap; i++) {
    const row = matrix[i] || [];
    const nonEmpty = row.filter((c) => c != null && String(c).trim() !== '');
    if (nonEmpty.length === 0) continue;
    let score = 0;
    let matched = 0;
    for (const cell of nonEmpty) {
      if (isHeaderCandidateText(cell)) matched++;
    }
    score += matched * 10;
    if (nonEmpty.length >= 3) score += 5;
    if (nonEmpty.length >= 5) score += 3;
    // 한 셀에 긴 문장만 있는 행 → 안내문 가능성
    if (nonEmpty.length === 1 && String(nonEmpty[0]).length > 15) score -= 12;
    // 다음 행의 데이터 패턴 보너스
    const next = matrix[i + 1] || [];
    let dataLike = 0;
    for (const c of next) {
      if (looksLikeDataCell(String(c || '').trim())) dataLike++;
    }
    score += Math.min(dataLike * 3, 12);
    // 안내문/README 패턴 감점
    const joined = row.map((c) => String(c || '')).join(' ');
    if (NOTE_RE.test(joined)) score -= 18;
    // 매칭된 컬럼명 후보가 0이고, 데이터 패턴도 없으면 헤더로 보기 어려움
    if (matched === 0 && dataLike === 0) score -= 6;
    if (score > best.score) {
      const headers = nonEmpty.map((c) => String(c).trim());
      const reason = matched
        ? `컬럼명 ${matched}개 매칭`
        : dataLike
          ? '다음 행이 데이터 패턴'
          : '기본 추정';
      best = { index: i, score, headers, reason };
    }
  }
  // 모든 행이 점수 음수면 첫 비어있지 않은 행을 기본값으로 둠
  if (best.score === -Infinity) {
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i] || [];
      const nonEmpty = row.filter((c) => c != null && String(c).trim() !== '');
      if (nonEmpty.length) {
        best = { index: i, score: 0, headers: nonEmpty.map((c) => String(c).trim()), reason: '기본값' };
        break;
      }
    }
  }
  return best;
}

// 시트별 점수 계산 (자동 추천용)
function scoreSheet(sheetName, headers, rowCount, columnCount) {
  let score = 0;
  const reasons = [];
  const lower = (sheetName || '').toLowerCase();
  for (const pos of SHEET_NAME_POSITIVE) {
    if (sheetName?.includes(pos) || lower.includes(pos.toLowerCase())) {
      score += 18;
      reasons.push(`시트명에 '${pos}'`);
      break;
    }
  }
  for (const neg of SHEET_NAME_NEGATIVE) {
    if (lower.includes(neg.toLowerCase())) {
      score -= 25;
      reasons.push(`시트명에 '${neg}'`);
      break;
    }
  }
  let headerMatched = 0;
  for (const h of headers || []) {
    if (isHeaderCandidateText(h)) headerMatched++;
  }
  score += headerMatched * 6;
  if (headerMatched > 0) reasons.push(`헤더 매칭 ${headerMatched}개`);
  if (rowCount >= 10) {
    score += Math.min(Math.floor(rowCount / 10), 12);
    reasons.push(`${rowCount}행`);
  } else if (rowCount > 0) {
    score += 1;
  }
  if (columnCount >= 3) score += 5;
  else if (columnCount <= 2) {
    score -= 12;
    reasons.push('컬럼 부족');
  }
  return { score: Math.round(score), reason: reasons.join(', ') || '추정' };
}

// exceljs 셀의 표시 문자열을 안전하게 추출.
// - 날짜는 YYYY-MM-DD HH:mm:ss 형태로 포맷 (xlsx 의 raw:false 와 유사한 결과 유지)
// - 수식 셀은 결과값(result) 우선, 없으면 수식 텍스트
// - 하이퍼링크 객체는 text 우선
// - rich text 는 각 조각 텍스트 결합
function cellToString(cell) {
  if (cell == null) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  if (v instanceof Date) {
    // 시간이 자정이면 날짜만, 아니면 날짜+시간
    const hasTime = v.getUTCHours() !== 0 || v.getUTCMinutes() !== 0 || v.getUTCSeconds() !== 0;
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    if (!hasTime) return `${y}-${m}-${d}`;
    const hh = String(v.getUTCHours()).padStart(2, '0');
    const mm = String(v.getUTCMinutes()).padStart(2, '0');
    const ss = String(v.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text || '').join('');
    }
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.formula != null) return String(v.formula);
    if (v.hyperlink) return String(v.hyperlink);
    if (v.error) return String(v.error);
  }
  // 마지막 안전망 — exceljs 의 .text 게터(있을 때)
  if (typeof cell.text === 'string') return cell.text;
  return '';
}

// 시트의 모든 셀을 (가능한) 문자열로 추출한 matrix 반환
// 완전히 빈 행은 제거(xlsx 의 blankrows:false 동일).
function readMatrix(sheet) {
  const matrix = [];
  // actualRowCount / rowCount 대신 eachRow 로 사용된 행만 순회 후 빈 행 제거
  const lastRow = sheet.actualRowCount || sheet.rowCount || 0;
  const lastCol = sheet.actualColumnCount || sheet.columnCount || 0;
  for (let r = 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const arr = [];
    let hasVal = false;
    for (let c = 1; c <= lastCol; c++) {
      const s = cellToString(row.getCell(c));
      if (s !== '') hasVal = true;
      arr.push(s);
    }
    if (hasVal) matrix.push(arr);
  }
  return matrix;
}

// matrix + headerRowIndex 로 headers, rows(object[]) 를 만든다.
// - 빈 헤더 셀은 `컬럼 1`, `컬럼 2` 형태의 자동 라벨로 채운다.
// - 중복 헤더는 `상품명`, `상품명 (2)`, `상품명 (3)` 형태로 구분.
//   (이전에는 첫 번째 헤더만 유지하고 나머지 컬럼 데이터를 버려서
//    셀러가 매핑 화면에서 컬럼을 못 고르는 일이 있었다.)
export function rowsFromMatrix(matrix, headerRowIndex) {
  if (!Array.isArray(matrix) || matrix.length === 0) return { headers: [], rows: [] };
  const idx = Math.max(0, Math.min(headerRowIndex || 0, matrix.length - 1));
  const headerRow = matrix[idx] || [];
  const rawHeaders = headerRow.map((c) => (c != null ? String(c).trim() : ''));

  // 1) 빈 헤더 셀 → '컬럼 N' fallback (N 은 1-based 열 인덱스)
  // 2) 중복 헤더 → 같은 이름이 두 번째 이상 나오면 ' (2)', ' (3)' suffix
  const seen = new Map(); // 원본 라벨 → 등장 횟수
  const uniqueHeaders = rawHeaders.map((h, i) => {
    let label = h;
    if (!label) label = `컬럼 ${i + 1}`;
    const count = (seen.get(label) || 0) + 1;
    seen.set(label, count);
    return count === 1 ? label : `${label} (${count})`;
  });

  // headers (UI 노출용) = 모든 컬럼 (빈 열도 라벨 채워짐 — 사용자가 직접 선택할 수 있게).
  // 매핑 후보용 행 데이터도 uniqueHeaders 키로 만든다.
  const rows = [];
  for (let i = idx + 1; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const obj = {};
    let hasVal = false;
    for (let j = 0; j < uniqueHeaders.length; j++) {
      const h = uniqueHeaders[j];
      const v = row[j] != null ? String(row[j]) : '';
      obj[h] = v;
      if (v !== '') hasVal = true;
    }
    if (hasVal) rows.push(obj);
  }
  return { headers: uniqueHeaders, rows };
}

// 단일 시트 파싱 → 메타 + matrix + headers + rows
function parseSheet(sheet, sheetName) {
  const matrix = readMatrix(sheet);
  if (!matrix.length) {
    return {
      sheetName,
      matrix: [],
      detectedHeaderRowIndex: 0,
      headers: [],
      rows: [],
      rowCount: 0,
      columnCount: 0,
      score: -50,
      reason: '빈 시트',
    };
  }
  const detected = detectHeaderRow(matrix);
  const { headers, rows } = rowsFromMatrix(matrix, detected.index);
  const columnCount = headers.length;
  const rowCount = rows.length;
  const sc = scoreSheet(sheetName, headers, rowCount, columnCount);
  return {
    sheetName,
    matrix,
    detectedHeaderRowIndex: detected.index,
    headers,
    rows,
    rowCount,
    columnCount,
    score: sc.score,
    reason: sc.reason,
  };
}

// 업로드된 버퍼를 파싱해 다음을 반환:
//   {
//     headers, rows,                        // 선택 시트의 결과
//     sheets: SheetMeta[],                  // 모든 시트 메타(rowCount/columnCount/score/reason 등)
//     selectedSheetName: string|null,
//     selectedHeaderRowIndex: number,       // 0-based
//     sheetParseResults: {                  // 시트별 사전 계산 (reparse 용)
//       [sheetName]: { headers, rows, matrix, detectedHeaderRowIndex }
//     }
//   }
export async function parseFile(buffer, originalName) {
  const lower = (originalName || '').toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return parseXlsxLike(buffer);
  return parseCsvLike(buffer);
}

function parseCsvLike(buffer) {
  let text = buffer.toString('utf-8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  });
  const headers = records.length ? Object.keys(records[0]) : [];
  return {
    headers,
    rows: records,
    sheets: [],
    selectedSheetName: null,
    selectedHeaderRowIndex: 0,
    sheetParseResults: {},
  };
}

async function parseXlsxLike(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // 워크북 순서 유지 (exceljs 는 worksheets 가 정의 순서대로 정렬됨)
  const worksheets = wb.worksheets || [];
  const sheetNames = worksheets.map((ws) => ws.name);
  const parsedPerSheet = worksheets.map((ws) => parseSheet(ws, ws.name));

  const sheets = parsedPerSheet.map((p) => ({
    sheetName: p.sheetName,
    rowCount: p.rowCount,
    columnCount: p.columnCount,
    detectedHeaderRowIndex: p.detectedHeaderRowIndex,
    headerCandidates: p.headers,
    score: p.score,
    reason: p.reason,
  }));

  // 점수 가장 높은 시트 선택 (동점이면 원래 시트 순서 유지)
  let selectedIdx = 0;
  for (let i = 1; i < sheets.length; i++) {
    if (sheets[i].score > sheets[selectedIdx].score) selectedIdx = i;
  }
  const selected = parsedPerSheet[selectedIdx] || parsedPerSheet[0];
  const sheetParseResults = Object.fromEntries(
    parsedPerSheet.map((p) => [
      p.sheetName,
      {
        headers: p.headers,
        rows: p.rows,
        matrix: p.matrix,
        detectedHeaderRowIndex: p.detectedHeaderRowIndex,
      },
    ]),
  );

  return {
    headers: selected?.headers || [],
    rows: selected?.rows || [],
    sheets,
    selectedSheetName: selected?.sheetName || sheetNames[0] || null,
    selectedHeaderRowIndex: selected?.detectedHeaderRowIndex || 0,
    sheetParseResults,
  };
}
