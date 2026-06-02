// sample_reviews_fashion.csv → sample_reviews_fashion.xlsx 변환
// 실행: npm run seed:xlsx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleDir = path.join(__dirname, '../../sample-data');
const csvPath = path.join(sampleDir, 'sample_reviews_fashion.csv');
const xlsxPath = path.join(sampleDir, 'sample_reviews_fashion.xlsx');

let text = fs.readFileSync(csvPath, 'utf-8');
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });

// 멀티 시트 구조 — 리뷰 데이터 시트를 자동 추천하는지 검증할 수 있도록 의도적으로 README 시트도 포함.
// 앱은 시트 순서에 의존하지 않고 시트명/컬럼명/데이터 패턴으로 점수를 매겨 자동 추천한다.
const wb = new ExcelJS.Workbook();

// 1) 메인 리뷰 데이터 시트
const reviewHeaders = rows.length ? Object.keys(rows[0]) : [];
const wsReviews = wb.addWorksheet('리뷰데이터');
wsReviews.addRow(reviewHeaders);
for (const r of rows) wsReviews.addRow(reviewHeaders.map((h) => r[h] ?? ''));

// 2) 오분류 테스트케이스 — 작은 표(소수 행)
const misclassHeaders = ['사례', '리뷰내용', '기대결과'];
const misclassRows = [
  ['긍정', '가격 대비 품질이 좋아서 색상별로 더 사고 싶어요.', 'actionable 없음'],
  ['대조', '기장은 괜찮은데 어깨가 조금 크게 느껴져요.', '어깨가 큼만'],
  ['방향성', '품이 커서 한 치수 작게 사세요.', '전반적으로 크게 나옴'],
];
const wsMis = wb.addWorksheet('오분류_테스트케이스');
wsMis.addRow(misclassHeaders);
for (const r of misclassRows) wsMis.addRow(r);

// 3) 요약 — 매우 적은 행
const wsSummary = wb.addWorksheet('요약');
wsSummary.addRow(['지표', '값']);
wsSummary.addRow(['총 리뷰 수', rows.length]);
wsSummary.addRow(['주요 상품군', '의류·신발·가방']);

// 4) README — 안내문 시트 (헤더 자동 감지가 이 시트를 회피해야 함)
const wsReadme = wb.addWorksheet('README');
wsReadme.addRow(['리뷰핏 샘플 데이터']);
wsReadme.addRow(['아래 데이터는 테스트용입니다. 실제 셀러 데이터가 아닙니다.']);
wsReadme.addRow(['시트 구성: 리뷰데이터 / 오분류_테스트케이스 / 요약 / README']);

await wb.xlsx.writeFile(xlsxPath);

console.log(`생성 완료: ${xlsxPath} (시트 4개 · 리뷰 ${rows.length}행)`);
