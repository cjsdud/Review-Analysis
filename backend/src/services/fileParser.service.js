import { parse } from 'csv-parse/sync';
import xlsx from 'xlsx';

// 업로드된 버퍼를 { headers: string[], rows: object[] } 로 파싱
export function parseFile(buffer, originalName) {
  const lower = (originalName || '').toLowerCase();
  if (lower.endsWith('.csv')) return parseCsv(buffer);
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return parseXlsx(buffer);
  // 확장자 불명 → CSV 시도
  return parseCsv(buffer);
}

function parseCsv(buffer) {
  let text = buffer.toString('utf-8');
  // BOM 제거
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  });
  const headers = records.length ? Object.keys(records[0]) : [];
  return { headers, rows: records };
}

function parseXlsx(buffer) {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}
