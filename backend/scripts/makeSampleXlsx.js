// sample_reviews_fashion.csv → sample_reviews_fashion.xlsx 변환
// 실행: npm run seed:xlsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import xlsx from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleDir = path.join(__dirname, '../../sample-data');
const csvPath = path.join(sampleDir, 'sample_reviews_fashion.csv');
const xlsxPath = path.join(sampleDir, 'sample_reviews_fashion.xlsx');

let text = fs.readFileSync(csvPath, 'utf-8');
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });

const ws = xlsx.utils.json_to_sheet(rows);
const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, '리뷰');
xlsx.writeFile(wb, xlsxPath);

console.log(`생성 완료: ${xlsxPath} (${rows.length} rows)`);
