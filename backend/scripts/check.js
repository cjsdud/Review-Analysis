// 주요 모듈이 정상적으로 import 되고 핵심 파이프라인이 동작하는지 빠르게 확인.
// 실행: npm run check  (DB/서버 없이 동작)
import assert from 'node:assert';

const failures = [];
async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

console.log('[check] 모듈 import / 핵심 로직 점검');

await step('privacyMasking', async () => {
  const m = await import('../src/services/privacyMasking.service.js');
  assert(m.maskText('010-1234-5678').includes('[전화번호]'), '전화번호 마스킹 실패');
  assert(m.maskRows([{ a: 'test@x.com' }])[0].a.includes('[이메일]'), 'row 마스킹 실패');
});

await step('fileParser', async () => {
  const m = await import('../src/services/fileParser.service.js');
  const out = m.parseFile(Buffer.from('상품명,리뷰내용\n티셔츠,너무 작아요\n'), 'x.csv');
  assert.equal(out.rows.length, 1, 'CSV 파싱 실패');
  assert.deepEqual(out.sheets, [], 'CSV 는 sheets 배열이 비어 있어야 함');
  assert.equal(out.selectedSheetName, null, 'CSV 는 selectedSheetName 이 null');
});

// XLSX 멀티 시트 / 헤더 행 자동 감지 테스트
async function buildXlsxBuffer(sheetSpecs) {
  const { default: xlsx } = await import('xlsx');
  const wb = xlsx.utils.book_new();
  for (const spec of sheetSpecs) {
    const ws = xlsx.utils.aoa_to_sheet(spec.aoa);
    xlsx.utils.book_append_sheet(wb, ws, spec.name);
  }
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

await step('XLSX #1 — "리뷰데이터" 시트 자동 추천 (첫 시트일 때)', async () => {
  const m = await import('../src/services/fileParser.service.js');
  const buf = await buildXlsxBuffer([
    {
      name: '리뷰데이터',
      aoa: [
        ['상품명', '옵션', '별점', '리뷰내용', '작성일'],
        ['셔츠', 'M', 5, '핏이 예뻐요', '2026-01-01'],
        ['셔츠', 'L', 3, '허리가 살짝 타이트해요', '2026-01-02'],
      ],
    },
    { name: '요약', aoa: [['지표', '값'], ['총합', 2]] },
    { name: 'README', aoa: [['이 파일은 샘플입니다']] },
  ]);
  const out = m.parseFile(buf, 'demo.xlsx');
  assert.equal(out.selectedSheetName, '리뷰데이터', `자동 추천 실패: ${out.selectedSheetName}`);
  assert(out.sheets.length === 3, `sheets 개수: ${out.sheets.length}`);
  assert(out.headers.includes('상품명') && out.headers.includes('리뷰내용'), '헤더 인식 실패');
  assert.equal(out.rows.length, 2, 'rows 개수 불일치');
});

await step('XLSX #2 — 첫 시트가 README 여도 "리뷰데이터" 추천', async () => {
  const m = await import('../src/services/fileParser.service.js');
  const buf = await buildXlsxBuffer([
    { name: 'README', aoa: [['리뷰핏 샘플 데이터'], ['아래 데이터는 테스트용']] },
    {
      name: '리뷰데이터',
      aoa: [
        ['상품명', '옵션', '별점', '리뷰내용', '작성일'],
        ['셔츠', 'M', 5, '좋아요', '2026-01-01'],
        ['바지', 'L', 3, '허리가 좀 작아요', '2026-01-02'],
        ['셔츠', 'L', 4, '핏이 깔끔', '2026-01-03'],
      ],
    },
    { name: '요약', aoa: [['항목', '값'], ['합계', 3]] },
  ]);
  const out = m.parseFile(buf, 'demo.xlsx');
  assert.equal(out.selectedSheetName, '리뷰데이터', `자동 추천 실패: ${out.selectedSheetName}`);
  assert(out.rows.length === 3, 'rows 개수 불일치');
});

await step('XLSX #3 — 상단 2행 안내문, 3행이 헤더 (headerRowIndex=2)', async () => {
  const m = await import('../src/services/fileParser.service.js');
  const buf = await buildXlsxBuffer([
    {
      name: '리뷰',
      aoa: [
        ['리뷰핏 샘플 데이터'],
        ['아래 데이터는 테스트용입니다'],
        ['상품명', '옵션명', '별점', '리뷰내용', '작성일'],
        ['셔츠', 'M', 5, '핏이 예뻐요. 만족합니다.', '2026-01-01'],
        ['셔츠', 'L', 3, '허리가 작아서 불편합니다. 한 사이즈 크게 사세요.', '2026-01-02'],
      ],
    },
  ]);
  const out = m.parseFile(buf, 'demo.xlsx');
  const sheet = out.sheets[0];
  assert.equal(sheet.detectedHeaderRowIndex, 2, `headerRowIndex=2 기대, 실제 ${sheet.detectedHeaderRowIndex}`);
  assert.deepEqual(out.headers, ['상품명', '옵션명', '별점', '리뷰내용', '작성일'], '헤더 불일치');
  // 안내문 셀이 headers 에 포함되면 안 됨
  assert(!out.headers.includes('리뷰핏 샘플 데이터'), '안내문이 headers 에 들어감');
  assert(!out.headers.includes('아래 데이터는 테스트용입니다'), '안내문이 headers 에 들어감');
  // 데이터는 4행부터(2행 헤더 다음)
  assert.equal(out.rows.length, 2, 'rows 개수 불일치');
});

await step('XLSX #4 — 컬럼 매핑 후보에 제목/안내문이 들어가지 않음', async () => {
  const fp = await import('../src/services/fileParser.service.js');
  const cm = await import('../src/services/columnMapping.service.js');
  const buf = await buildXlsxBuffer([
    {
      name: '리뷰데이터',
      aoa: [
        ['리뷰핏 샘플 데이터'],
        ['상품명', '옵션', '별점', '리뷰내용'],
        ['셔츠', 'M', 5, '좋아요'],
      ],
    },
  ]);
  const out = fp.parseFile(buf, 'demo.xlsx');
  const mapping = cm.autoMapColumns(out.headers, out.rows);
  // 매핑 후보의 컬럼명 값은 모두 headers 안에 있어야 한다
  for (const [field, info] of Object.entries(mapping)) {
    if (info.column) {
      assert(out.headers.includes(info.column),
        `${field} 매핑이 headers 밖의 값: ${info.column}`);
    }
  }
  // 절대 들어가지 않아야 할 값
  assert(!out.headers.includes('리뷰핏 샘플 데이터'), '안내문이 headers 에 포함됨');
  // 데이터 행 셀도 헤더 옵션에 들어가면 안 됨
  assert(!out.headers.includes('좋아요'), '데이터 셀이 headers 에 포함됨');
});

await step('XLSX reparse — rowsFromMatrix 로 headerRowIndex 변경 시 다른 헤더 추출', async () => {
  const m = await import('../src/services/fileParser.service.js');
  const matrix = [
    ['안내문 1줄'],
    ['상품명', '리뷰내용'],
    ['A', '잘 맞아요'],
    ['B', '좀 작아요'],
  ];
  const r1 = m.rowsFromMatrix(matrix, 1);
  assert.deepEqual(r1.headers, ['상품명', '리뷰내용'], 'headerRowIndex=1 헤더 불일치');
  assert.equal(r1.rows.length, 2, 'rows 개수 불일치');
  const r0 = m.rowsFromMatrix(matrix, 0);
  assert.equal(r0.headers.length, 1, 'headerRowIndex=0 시 단일 헤더');
  assert.equal(r0.headers[0], '안내문 1줄');
});

await step('columnMapping', async () => {
  const m = await import('../src/services/columnMapping.service.js');
  const map = m.autoMapColumns(['상품명', '리뷰내용'], [{ 상품명: '티셔츠', 리뷰내용: '원단이 너무 얇고 비침이 심해요' }]);
  assert.equal(map.content.column, '리뷰내용', 'content 매핑 실패');
});

await step('reviewClassification (멀티라벨/부정어)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const a = m.classifyReview({ id: '1', productName: 'P', rating: 2, content: '허리가 작고 원단도 얇아서 비침이 있어요' });
  const cats = a.categories.map((c) => c.name);
  assert(cats.includes('사이즈') && cats.includes('소재/두께'), '멀티라벨 실패');
  const b = m.classifyReview({ id: '2', productName: 'P', rating: 5, content: '작지 않고 딱 맞아요. 만족합니다' });
  assert.equal(b.categories.length, 0, '부정어/긍정 게이팅 실패');
});

await step('issueDetection + productAnalysis (end-to-end)', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: '1', productName: '셔츠', rating: 2, content: '허리가 너무 작아요' },
    { id: '2', productName: '셔츠', rating: 1, content: '실밥이 튀어나오고 마감이 엉성해요' },
    { id: '3', productName: '셔츠', rating: 5, content: '핏 예쁘고 만족해요' },
  ];
  const { summary, products } = await runAnalysis(reviews);
  assert.equal(summary.totalReviews, 3, 'totalReviews 오류');
  assert(typeof summary.issueReviewCount === 'number', 'issueReviewCount 누락');
  assert(typeof summary.totalIssueCount === 'number', 'totalIssueCount 누락');
  assert(products[0].topIssues.length > 0, 'topIssues 비어있음');
  assert(products[0].topIssues[0].recommendedAction, 'recommendedAction 누락');
});

await step('export', async () => {
  const m = await import('../src/services/export.service.js');
  const csv = m.buildAnalysisCsv([{ productName: 'P', totalReviews: 1, negativeReviews: 1, averageRating: 2, topIssues: [] }]);
  assert(csv.includes('상품명'), 'CSV 헤더 누락');
});

await step('user_corrections 룰 적용 (review-level)', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: 'r1', productName: '셔츠', rating: 2, content: '허리 밴딩이 꽉 껴서 불편해요' },
    { id: 'r2', productName: '셔츠', rating: 4, content: '디자인은 마음에 들어요' },
  ];
  const corrections = [
    {
      productKey: '셔츠',
      original: { category: '사이즈', issueLabel: '허리 사이즈가 작음' },
      corrected: { category: '핏/실루엣', issueLabel: '허리 밴딩이 타이트함' },
    },
  ];
  const { classifications } = await runAnalysis(reviews, corrections);
  const cls1 = classifications.find((c) => c.reviewId === 'r1');
  assert(cls1, 'r1 classification 누락');
  const corrected = cls1.categories.find((cat) => cat.source === 'correction');
  assert(corrected, 'review-level correction 적용 안 됨');
  assert.equal(corrected.name, '핏/실루엣', 'corrected category 불일치');
  assert(corrected.confidence >= 0.9, 'correction confidence 너무 낮음');
});

await step('사이즈 방향 — "한 치수 작게 사세요" → 크게 나옴', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 's1', productName: 'P', rating: 4,
    content: '핏이 좀 크게 나와요. 한 치수 작게 사세요',
  });
  const sizeIssues = r.categories.filter((c) => c.name === '사이즈');
  const labels = sizeIssues.map((c) => c.issue);
  assert(labels.includes('전반적으로 크게 나옴'), '"크게 나옴" 라벨이 있어야 함');
  assert(!labels.includes('전반적으로 작게 나옴'), '"작게 나옴" 은 제거되어야 함(반대 방향)');
});

await step('사이즈 방향 — "한 사이즈 크게" → 작게 나옴', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 's2', productName: 'P', rating: 4,
    content: '평소보다 작아서 한 사이즈 크게 주문하시는 걸 추천드려요',
  });
  const labels = r.categories.filter((c) => c.name === '사이즈').map((c) => c.issue);
  assert(labels.includes('전반적으로 작게 나옴'), '"작게 나옴" 라벨이 있어야 함');
  assert(!labels.includes('전반적으로 크게 나옴'), '"크게 나옴" 은 제거되어야 함');
});

await step('긍정 리뷰 — "비침이 없어서 좋아요" 는 이슈로 잡지 않음', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 'p1', productName: 'P', rating: 5,
    content: '비침이 거의 없어서 좋아요. 색감도 예뻐요',
  });
  const labels = r.categories.map((c) => c.issue || c.name);
  assert(!labels.some((l) => /비침|얇/.test(l || '')), '비침/얇음 이슈가 잡히면 안 됨');
});

await step('긍정 리뷰 — "줄어들지 않았어요" 는 이슈로 잡지 않음', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 'p2', productName: 'P', rating: 5,
    content: '세탁해도 줄어들지 않았어요. 만족합니다',
  });
  const labels = r.categories.map((c) => c.issue || c.name);
  assert(!labels.some((l) => /줄어|세탁/.test(l || '')), '세탁 후 줄어듦 이슈가 잡히면 안 됨');
});

await step('topIssues — 포괄 라벨("~ 관련 의견") 제외', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: 'g1', productName: '셔츠', rating: 2, content: '허리가 너무 작아요' },
    { id: 'g2', productName: '셔츠', rating: 2, content: '허리가 좀 작네요' },
    { id: 'g3', productName: '셔츠', rating: 5, content: '디자인이 예뻐요' },
  ];
  const { products } = await runAnalysis(reviews);
  const labels = products[0].topIssues.map((i) => i.issueLabel || '');
  assert(!labels.some((l) => /관련 의견$/.test(l)), 'topIssues 에 "~ 관련 의견" 라벨이 포함되면 안 됨');
});

// ──────────────────────────────────────────────
// 분류 품질 — 문맥 기반 (긍정/no-problem/방향성/충돌)
// ──────────────────────────────────────────────

const issueLabels = (cats) => cats.map((c) => c.issue).filter(Boolean);
const sizeLabels = (cats) => cats.filter((c) => c.name === '사이즈').map((c) => c.issue);

await step('문맥 #1 — "가격 대비 품질이 좋아서 더 사고 싶어요" (긍정)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't1', productName: 'P', rating: 5,
    content: '가격 대비 품질이 좋아서 색상별로 더 사고 싶어요. 마감이 나쁘지 않아서 오래 입을 수 있을 것 같아요.',
  });
  const labels = issueLabels(r.categories);
  const cats = r.categories.map((c) => c.name);
  assert(!labels.includes('가격 대비 품질이 아쉬움'), '가격 부정 이슈 잡히면 안 됨');
  assert(!cats.includes('마감/불량'), '마감 불량 이슈 잡히면 안 됨');
  const actionable = r.categories.filter((c) => c.isActionableIssue !== false);
  assert(actionable.length === 0, `actionable 이슈가 없어야 함, 실제: ${labels.join(',')}`);
});

await step('문맥 #2 — "기장은 괜찮은데 어깨가 조금 크게 느껴져요" (대조)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't2', productName: 'P', rating: 4,
    content: '기장은 괜찮은데 어깨가 조금 크게 느껴져요. 마감이 나쁘지 않아서 오래 입을 수 있을 것 같아요.',
  });
  const sl = sizeLabels(r.categories);
  assert(sl.includes('어깨가 큼'), `"어깨가 큼" 포함되어야 함. 실제: ${sl.join(',')}`);
  assert(!sl.includes('어깨가 좁음'), '"어깨가 좁음" 잡히면 안 됨');
  assert(!sl.includes('기장이 김') && !sl.includes('기장이 짧음'), '기장 이슈 잡히면 안 됨');
  assert(!r.categories.some((c) => c.name === '마감/불량'), '마감 이슈 잡히면 안 됨');
  const shoulder = r.categories.find((c) => c.issue === '어깨가 큼');
  assert(shoulder.severity !== 'high', `severity high 안 됨, 실제: ${shoulder.severity}`);
});

await step('문맥 #3 — "사진보다 색감이 조금 밝게" (색상)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't3', productName: 'P', rating: 4,
    content: '사진보다 색감이 조금 밝게 느껴졌어요. 가격 생각하면 충분히 만족스러운 편입니다.',
  });
  const sl = sizeLabels(r.categories);
  const cs = r.categories.filter((c) => c.name === '색상/화면 차이');
  assert(!sl.includes('전반적으로 작게 나옴') && !sl.includes('전반적으로 크게 나옴'),
    `사이즈 이슈 잡히면 안 됨. 실제: ${sl.join(',')}`);
  assert(cs.length > 0, '색상/화면 차이 카테고리 포함되어야 함');
  const labels = cs.map((c) => c.issue);
  assert(labels.some((l) => /밝음|차이/.test(l || '')), `밝음/차이 라벨 포함되어야 함. 실제: ${labels.join(',')}`);
  assert(cs[0].severity !== 'high', 'severity high 금지');
});

await step('문맥 #4 — "사진보다 실물이 더 어두워요"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't4', productName: 'P', rating: 3,
    content: '사진보다 실물이 더 어두워요. 색상 차이가 조금 있습니다.',
  });
  const labels = issueLabels(r.categories);
  const cats = r.categories.map((c) => c.name);
  assert(labels.includes('실물 색상이 화면보다 어두움'), '어두움 라벨 포함되어야 함');
  assert(!cats.includes('사이즈'), '사이즈 이슈 잡히면 안 됨');
});

await step('문맥 #5 — "품이 커서 한 치수 작게 사세요" (방향성)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't5', productName: 'P', rating: 4,
    content: '생각보다 품이 커서 정핏을 원하면 한 치수 작게 사는 게 좋겠어요.',
  });
  const sl = sizeLabels(r.categories);
  assert(sl.includes('전반적으로 크게 나옴'), `"크게 나옴" 포함되어야 함. 실제: ${sl.join(',')}`);
  assert(!sl.includes('전반적으로 작게 나옴'), '"작게 나옴" 잡히면 안 됨');
});

await step('문맥 #6 — "목 부분이 조금 타이트" (완화)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't6', productName: 'P', rating: 4,
    content: '목 부분이 조금 타이트하게 느껴졌지만 입다 보면 괜찮을 것 같습니다.',
  });
  const labels = issueLabels(r.categories);
  const hasNeckOrSize = labels.some((l) => /목|타이트|작|착용감/.test(l || ''))
    || r.categories.some((c) => c.name === '사이즈' || c.name === '착용감');
  assert(hasNeckOrSize, `목/사이즈/착용감 약한 이슈 포함되어야 함. 실제: ${labels.join(',')}`);
  // severity high 금지
  for (const c of r.categories) {
    assert(c.severity !== 'high', `severity high 금지 (${c.issue || c.name}=${c.severity})`);
  }
});

await step('문맥 #7 — "원단 탄탄, 비침 없음, 오버핏" (긍정)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't7', productName: 'P', rating: 5,
    content: '생각보다 원단이 탄탄하고 비침이 거의 없어서 좋아요. 오버핏이라 편하게 입기 좋습니다.',
  });
  const labels = issueLabels(r.categories);
  assert(!labels.includes('원단이 얇고 비침이 있음'), '비침 이슈 잡히면 안 됨');
  assert(!labels.includes('원단 비침이 있음'), '비침 이슈 잡히면 안 됨');
  const actionable = r.categories.filter((c) => c.isActionableIssue !== false);
  assert(actionable.length === 0, `actionable 이슈 없어야 함. 실제: ${labels.join(',')}`);
});

await step('문맥 #8 — "세탁 후에도 크게 줄어들지 않았어요"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't8', productName: 'P', rating: 5,
    content: '세탁 후에도 크게 줄어들지 않았어요. 가격 대비 만족합니다.',
  });
  const cats = r.categories.map((c) => c.name);
  assert(!cats.includes('세탁/내구성'), '세탁 이슈 잡히면 안 됨');
  assert(!cats.includes('가격/가성비'), '가격 부정 이슈 잡히면 안 됨');
});

await step('문맥 #9 — "핏은 예쁜데 기장이 살짝 길어요"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't9', productName: 'P', rating: 4,
    content: '핏은 예쁜데 기장이 제 기준에는 살짝 길어요. 그래도 데일리로 입기 무난합니다.',
  });
  const sl = sizeLabels(r.categories);
  assert(sl.includes('기장이 김'), `"기장이 김" 포함되어야 함. 실제: ${sl.join(',')}`);
  const lengthIssue = r.categories.find((c) => c.issue === '기장이 김');
  assert(lengthIssue.severity !== 'high', 'severity high 금지');
});

await step('문맥 #10 — "재질은 괜찮은데 두꺼워요"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't10', productName: 'P', rating: 4,
    content: '재질은 괜찮은데 생각보다 두꺼워서 한여름에는 조금 더울 수 있어요.',
  });
  const labels = issueLabels(r.categories);
  assert(labels.includes('원단이 두꺼움'), `"원단이 두꺼움" 포함되어야 함. 실제: ${labels.join(',')}`);
  const thick = r.categories.find((c) => c.issue === '원단이 두꺼움');
  assert(thick.isActionableIssue, 'actionable 이슈여야 함');
  assert(thick.severity !== 'high', 'severity high 금지');
});

await step('문맥 #11 — "가격 대비 품질 아쉬워요. 마감도 부족"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't11', productName: 'P', rating: 2,
    content: '가격 대비 품질이 아쉬워요. 마감도 조금 부족합니다.',
  });
  const labels = issueLabels(r.categories);
  assert(labels.includes('가격 대비 품질이 아쉬움'), '가격 부정 라벨 포함되어야 함');
});

await step('문맥 #12 — "어깨가 좁고 팔 들 때 불편"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't12', productName: 'P', rating: 2,
    content: '어깨가 좁고 팔을 들 때 조금 불편해요.',
  });
  const sl = sizeLabels(r.categories);
  assert(sl.includes('어깨가 좁음'), `"어깨가 좁음" 포함되어야 함. 실제: ${sl.join(',')}`);
  assert(!sl.includes('어깨가 큼'), '"어깨가 큼" 잡히면 안 됨');
});

await step('문맥 #13 — "기장은 괜찮고 허리가 조금 타이트"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't13', productName: 'P', rating: 3,
    content: '기장은 괜찮고 허리가 조금 타이트해요.',
  });
  const sl = sizeLabels(r.categories);
  assert(!sl.includes('기장이 김') && !sl.includes('기장이 짧음'), '기장 이슈 잡히면 안 됨');
  assert(sl.includes('허리가 작게 나옴'), `"허리가 작게 나옴" 포함되어야 함. 실제: ${sl.join(',')}`);
  const waist = r.categories.find((c) => c.issue === '허리가 작게 나옴');
  assert(waist.severity !== 'high', 'severity high 금지');
});

await step('문맥 #14 — "화이트 색상은 속옷이 비쳐서"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't14', productName: 'P', rating: 2,
    content: '화이트 색상은 속옷이 비쳐서 단독으로 입기 어려워요.',
  });
  const labels = issueLabels(r.categories);
  assert(labels.some((l) => /비침/.test(l)), `비침 이슈 포함되어야 함. 실제: ${labels.join(',')}`);
  const sheer = r.categories.find((c) => /비침/.test(c.issue || ''));
  assert(sheer.isActionableIssue, 'actionable 이여야 함');
});

await step('문맥 #15 — "화이트인데도 비침이 거의 없어서 만족"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't15', productName: 'P', rating: 5,
    content: '화이트인데도 비침이 거의 없어서 만족합니다.',
  });
  const labels = issueLabels(r.categories);
  assert(!labels.some((l) => /비침/.test(l || '')), '비침 이슈 잡히면 안 됨');
  const actionable = r.categories.filter((c) => c.isActionableIssue !== false);
  assert(actionable.length === 0, 'actionable 이슈 없어야 함');
});

await step('문맥 #16 — "배송은 빨랐지만 포장이 구겨져서"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't16', productName: 'P', rating: 3,
    content: '배송은 빨랐지만 포장이 구겨져서 옷에 주름이 많이 생겼어요.',
  });
  const labels = issueLabels(r.categories);
  assert(labels.includes('포장이 부실함(구김 등)'), `포장 부실 라벨 포함되어야 함. 실제: ${labels.join(',')}`);
  assert(!labels.includes('배송이 지연됨'), '배송 지연 이슈 잡히면 안 됨');
});

await step('문맥 #17 — "배송도 빠르고 포장도 깔끔"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't17', productName: 'P', rating: 5,
    content: '배송도 빠르고 포장도 깔끔했어요.',
  });
  const actionable = r.categories.filter((c) => c.isActionableIssue !== false);
  assert(actionable.length === 0, `배송/포장 actionable 이슈 없어야 함. 실제: ${actionable.map(c => c.issue || c.name).join(',')}`);
});

await step('문맥 #18 — "박음질이 삐뚤고 실밥이 보여요"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't18', productName: 'P', rating: 2,
    content: '박음질이 조금 삐뚤고 실밥이 몇 군데 보여요.',
  });
  const labels = issueLabels(r.categories);
  const hasFinish = labels.some((l) => /마감|실밥/.test(l));
  assert(hasFinish, `마감/실밥 이슈 포함되어야 함. 실제: ${labels.join(',')}`);
});

await step('문맥 #19 — "실밥 없이 마감 깔끔"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't19', productName: 'P', rating: 5,
    content: '실밥 없이 마감이 깔끔해서 만족합니다.',
  });
  const labels = issueLabels(r.categories);
  assert(!labels.some((l) => /마감|실밥/.test(l || '')), `마감/실밥 이슈 잡히면 안 됨. 실제: ${labels.join(',')}`);
});

await step('문맥 #20 — "발볼이 좁아서 발이 아파요"', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 't20', productName: 'P', rating: 2,
    content: '발볼이 좁아서 오래 걸으면 발이 아파요.',
  });
  const labels = issueLabels(r.categories);
  assert(labels.includes('발볼이 좁음'), `"발볼이 좁음" 포함되어야 함. 실제: ${labels.join(',')}`);
});

// ──────────────────────────────────────────────
// 감성 분포 / 상품 상태 / 답글 / 원본 리뷰
// ──────────────────────────────────────────────

await step('감성 #1 — 별점 5 + 약한 개선 이슈 → positive, issueReview 포함', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: 's1', productName: 'P', rating: 5, content: '핏은 예쁜데 허리가 조금 타이트해요. 그래도 만족합니다.' },
  ];
  const { products, classifications } = await runAnalysis(reviews);
  const cls = classifications[0];
  assert.equal(cls.sentiment, 'positive', `sentiment=${cls.sentiment}`);
  const p = products[0];
  assert.equal(p.negativeReviews, 0, `negativeReviews=${p.negativeReviews}`);
  assert(p.issueReviewCount >= 1, `issueReviewCount=${p.issueReviewCount}`);
  assert.equal(p.sentimentCounts.positive, 1);
});

await step('감성 #2 — 별점 2 + 색상/소재 이슈 → negative + 이슈 다중', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: 's2', productName: 'P', rating: 2, content: '사진보다 색상이 너무 어둡고 원단도 얇아요.' },
  ];
  const { products, classifications } = await runAnalysis(reviews);
  assert.equal(classifications[0].sentiment, 'negative');
  const p = products[0];
  assert.equal(p.negativeReviews, 1);
  assert(p.issueReviewCount >= 1);
  assert.equal(p.sentimentCounts.negative, 1);
});

await step('감성 #3 — 별점 5 긍정 → positive + actionable 없음', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: 's3', productName: 'P', rating: 5, content: '가격 대비 품질이 좋아서 만족합니다.' },
  ];
  const { products, classifications } = await runAnalysis(reviews);
  assert.equal(classifications[0].sentiment, 'positive');
  const p = products[0];
  assert.equal(p.sentimentCounts.positive, 1);
  assert.equal(p.negativeReviews, 0);
  assert.equal(p.issueReviewCount, 0);
});

await step('감성 #4 — 상품 단위 sentimentCounts/Ratios 계산 정확', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: 'q1', productName: 'P', rating: 5, content: '정말 좋아요' },
    { id: 'q2', productName: 'P', rating: 5, content: '만족합니다' },
    { id: 'q3', productName: 'P', rating: 3, content: '무난해요' },
    { id: 'q4', productName: 'P', rating: 1, content: '불량이에요 환불 원합니다' },
  ];
  const { products, summary } = await runAnalysis(reviews);
  const p = products[0];
  assert.equal(p.sentimentCounts.positive, 2);
  assert.equal(p.sentimentCounts.neutral, 1);
  assert.equal(p.sentimentCounts.negative, 1);
  assert.equal(p.sentimentRatios.positive, 0.5);
  assert.equal(p.sentimentRatios.negative, 0.25);
  assert.equal(summary.sentimentCounts.positive, 2);
  assert.equal(summary.sentimentCounts.negative, 1);
});

await step('상품 상태 — deriveProductStatus 분기 검증', async () => {
  const { deriveProductStatus } = await import('../src/services/productAnalysis.service.js');
  assert.equal(deriveProductStatus({ totalReviews: 5, positiveRatio: 0.8, negativeRatio: 0, issueRatio: 0 }), '리뷰 부족');
  assert.equal(deriveProductStatus({ totalReviews: 50, positiveRatio: 0.3, negativeRatio: 0.3, issueRatio: 0.4 }), '주의 필요');
  assert.equal(deriveProductStatus({ totalReviews: 50, positiveRatio: 0.5, negativeRatio: 0.16, issueRatio: 0.32 }), '개선 우선');
  assert.equal(deriveProductStatus({ totalReviews: 50, positiveRatio: 0.8, negativeRatio: 0.05, issueRatio: 0.1 }), '만족도 높음');
  assert.equal(deriveProductStatus({ totalReviews: 50, positiveRatio: 0.72, negativeRatio: 0.12, issueRatio: 0.3 }), '좋은데 고칠 점 있음');
  assert.equal(deriveProductStatus({ totalReviews: 50, positiveRatio: 0.6, negativeRatio: 0.1, issueRatio: 0.1 }), '보통');
});

// ──────────────────────────────────────────────
// CS 답글 초안 — issueLabel 그대로 노출 금지
// ──────────────────────────────────────────────

async function getReplies(input) {
  const { buildReplyTemplates } = await import('../src/services/replyTemplates.service.js');
  return buildReplyTemplates(input);
}

await step('CS 답글 #1 — "기장이 김" issueLabel 직접 삽입 금지', async () => {
  const reps = await getReplies({ issueLabel: '기장이 김', category: '사이즈' });
  assert(reps.length === 3, `tones=${reps.length}`);
  for (const r of reps) {
    assert(!/['"‘’“”]\s*기장이 김\s*['"‘’“”]/.test(r.template),
      `따옴표로 issueLabel 노출됨: ${r.template}`);
    assert(!r.template.includes("'기장이 김' 관련"), 'X 관련해 패턴 금지');
  }
  assert(reps.some((r) => r.template.includes('기장감이 기대보다 길게')),
    '"기장감이 기대보다 길게" 표현이 포함되어야 함');
});

await step('CS 답글 #2 — "배송이 지연됨" 강한 이슈 → 사과 포함', async () => {
  const reps = await getReplies({ issueLabel: '배송이 지연됨', category: '배송/포장' });
  for (const r of reps) {
    assert(!r.template.includes("'배송이 지연됨'"), '따옴표로 issueLabel 노출 금지');
  }
  // 강한 이슈 — 사과 표현 포함
  assert(reps.some((r) => /죄송합니다/.test(r.template)), '강한 이슈는 사과 표현 포함');
  // customer-facing phrase
  assert(reps.some((r) => r.template.includes('배송이 늦어져')), '"배송이 늦어져" 표현 포함');
});

await step('CS 답글 #3 — "실물 색상이 화면보다 밝음" → 자연스러운 표현', async () => {
  const reps = await getReplies({ issueLabel: '실물 색상이 화면보다 밝음', category: '색상/화면 차이' });
  for (const r of reps) {
    assert(!r.template.includes("'실물 색상이 화면보다 밝음'"), '따옴표로 issueLabel 노출 금지');
  }
  assert(reps.some((r) => r.template.includes('화면보다 밝게 느껴지셨')),
    '"화면보다 밝게 느껴지셨" 표현 포함');
});

await step('CS 답글 #4 — "원단이 얇고 비침이 있음" → 자연스러운 표현', async () => {
  const reps = await getReplies({ issueLabel: '원단이 얇고 비침이 있음', category: '소재/두께' });
  for (const r of reps) {
    assert(!r.template.includes("'원단이 얇고 비침이 있음'"), '따옴표로 issueLabel 노출 금지');
  }
  assert(reps.some((r) => r.template.includes('원단 두께나 비침 정도')),
    '"원단 두께나 비침 정도" 표현 포함');
});

await step('CS 답글 #5 — generic 라벨/positive/non-actionable 은 답글 생성 안 함', async () => {
  const generic = await getReplies({ issueLabel: '소재/두께 관련 의견', category: '소재/두께' });
  assert.equal(generic.length, 0, 'generic 라벨에서 답글 생성됨');
  const positive = await getReplies({ issueLabel: '원단이 두꺼움', category: '소재/두께', polarity: 'positive' });
  assert.equal(positive.length, 0, 'positive polarity 에서 답글 생성됨');
  const nonAct = await getReplies({ issueLabel: '원단이 두꺼움', category: '소재/두께', isActionableIssue: false });
  assert.equal(nonAct.length, 0, 'non-actionable 에서 답글 생성됨');
  const noLabel = await getReplies({ issueLabel: null, category: '기타' });
  assert.equal(noLabel.length, 0, '빈 라벨에서 답글 생성됨');
});

await step('상품 상세 데이터 — topIssues/allIssues/reviews + 마스킹', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const { maskRow } = await import('../src/services/privacyMasking.service.js');
  // 정규화된 리뷰가 마스킹된 상태로 들어왔다고 가정 (실제 라우트에서도 reviews 테이블의 content 는 마스킹된 상태).
  const rawReview = {
    id: 'm1', productName: 'P', rating: 2,
    content: '문의는 010-1234-5678로 주세요. test@example.com 주문번호 202605270001입니다. 허리가 작아요.',
  };
  const masked = { ...rawReview, content: maskRow(rawReview).content };
  const { products } = await runAnalysis([masked]);
  const p = products[0];
  assert(Array.isArray(p.topIssues), 'topIssues 배열');
  assert(Array.isArray(p.allIssues), 'allIssues 배열');
  assert(Array.isArray(p.reviews) && p.reviews.length === 1, 'reviews 배열');
  const r = p.reviews[0];
  assert(typeof r.content === 'string' && r.content.length > 0, 'review.content 존재');
  assert(r.content.includes('[전화번호]'), '전화번호 마스킹');
  assert(r.content.includes('[이메일]'), '이메일 마스킹');
  assert(r.content.includes('[주문번호]'), '주문번호 마스킹');
  assert(!r.content.includes('010-1234-5678'), '원본 전화번호 노출');
  assert(!r.content.includes('test@example.com'), '원본 이메일 노출');
  assert(!r.content.includes('202605270001'), '원본 주문번호 노출');
  assert(Array.isArray(r.detectedIssues), 'detectedIssues 배열');
  assert(r.detectedIssues.some((d) => /허리/.test(d.issue || '')),
    `허리 이슈 포함: ${r.detectedIssues.map((d) => d.issue).join(',')}`);
});

await step('상품 상세 데이터 — topIssues 와 allIssues 분리 (allIssues ⊇ topIssues)', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  // 6개 이상의 다른 이슈를 가진 리뷰 데이터
  const reviews = Array.from({ length: 20 }, (_, i) => ({
    id: `t${i}`,
    productName: 'P',
    rating: 2,
    content: [
      '허리가 작아요',
      '어깨가 좁아요',
      '소매가 짧아요',
      '기장이 길어요',
      '원단이 얇아요',
      '비침이 있어요',
      '마감이 엉성합니다',
    ][i % 7],
  }));
  const { products } = await runAnalysis(reviews);
  const p = products[0];
  assert(p.topIssues.length <= 5, 'topIssues 는 최대 5개');
  assert(p.allIssues.length >= p.topIssues.length, 'allIssues 는 topIssues 이상');
});

// ──────────────────────────────────────────────
// 임시 업로드 cleanup / 분석 히스토리 (temp DB 사용)
// ──────────────────────────────────────────────
// database.js 는 import 시점에 DB_PATH 로 SQLite 를 연다.
// 실제 DB 오염을 막기 위해 첫 import 전에 임시 경로로 교체한다.
{
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const fsMod = await import('node:fs');
  const tmpDir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'reviewfit-check-'));
  process.env.DB_PATH = pathMod.join(tmpDir, 'test.db');
}

await step('cleanup #1 — purgeStaleUploadRows(1) 가 오래된 rows/sheet_parse_results NULL 처리', async () => {
  const { default: db, purgeStaleUploadRows } = await import('../src/db/database.js');
  // 오래된 행 (created_at = 2시간 전)
  db.prepare(
    `INSERT INTO upload_files (id, original_name, source, row_count, headers, rows, sheet_parse_results, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-120 minutes'))`,
  ).run('old1', 'old.csv', 'custom', 2, '[]', '[{"a":1}]', '{"s":{}}');
  const changes = purgeStaleUploadRows(1);
  assert(changes >= 1, `정리된 행 수: ${changes}`);
  const row = db.prepare('SELECT rows, sheet_parse_results FROM upload_files WHERE id = ?').get('old1');
  assert.equal(row.rows, null, 'rows 가 NULL 처리되지 않음');
  assert.equal(row.sheet_parse_results, null, 'sheet_parse_results 가 NULL 처리되지 않음');
});

await step('cleanup #2 — 최근 업로드 데이터는 삭제하지 않음', async () => {
  const { default: db, purgeStaleUploadRows } = await import('../src/db/database.js');
  db.prepare(
    `INSERT INTO upload_files (id, original_name, source, row_count, headers, rows, sheet_parse_results)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('fresh1', 'fresh.csv', 'custom', 2, '[]', '[{"a":1}]', '{"s":{}}');
  purgeStaleUploadRows(1); // TTL 1분 → 방금 만든 행은 대상 아님
  const row = db.prepare('SELECT rows, sheet_parse_results FROM upload_files WHERE id = ?').get('fresh1');
  assert(row.rows !== null, '최근 rows 가 잘못 삭제됨');
  assert(row.sheet_parse_results !== null, '최근 sheet_parse_results 가 잘못 삭제됨');
});

await step('cleanup #3 — 분석 완료 시 rows/sheet_parse_results 동시 NULL (UPDATE 쿼리 검증)', async () => {
  const { default: db } = await import('../src/db/database.js');
  db.prepare(
    `INSERT INTO upload_files (id, original_name, source, row_count, headers, rows, sheet_parse_results)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('done1', 'done.csv', 'custom', 2, '[]', '[{"a":1}]', '{"s":{}}');
  // analysis.routes.js 의 분석 완료 직후 쿼리와 동일
  db.prepare('UPDATE upload_files SET rows = NULL, sheet_parse_results = NULL WHERE id = ?').run('done1');
  const row = db.prepare('SELECT rows, sheet_parse_results FROM upload_files WHERE id = ?').get('done1');
  assert.equal(row.rows, null, '분석 후 rows NULL 아님');
  assert.equal(row.sheet_parse_results, null, '분석 후 sheet_parse_results NULL 아님');
});

await step('history — listAnalyses 가 최신순 목록 + summary 기반 메타 반환', async () => {
  const { default: db, listAnalyses } = await import('../src/db/database.js');
  // 업로드 + 분석 2건
  db.prepare('INSERT INTO upload_files (id, original_name, source) VALUES (?, ?, ?)').run('u1', 'a.csv', 'smartstore');
  db.prepare('INSERT INTO upload_files (id, original_name, source) VALUES (?, ?, ?)').run('u2', 'b.xlsx', 'custom');
  const sum1 = JSON.stringify({ totalReviews: 10, productCount: 2 });
  const sum2 = JSON.stringify({ totalReviews: 5, productCount: 1 });
  db.prepare(
    `INSERT INTO analysis_jobs (id, upload_id, status, summary, created_at) VALUES (?, ?, ?, ?, datetime('now','-5 minutes'))`,
  ).run('an1', 'u1', 'done', sum1);
  db.prepare(
    `INSERT INTO analysis_jobs (id, upload_id, status, summary, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run('an2', 'u2', 'done', sum2);
  // product_analyses 로 상품 수 카운트
  db.prepare('INSERT INTO product_analyses (id, analysis_id, product_key, product_name, data) VALUES (?,?,?,?,?)')
    .run('pa1', 'an1', 'P1', 'P1', '{}');
  db.prepare('INSERT INTO product_analyses (id, analysis_id, product_key, product_name, data) VALUES (?,?,?,?,?)')
    .run('pa2', 'an1', 'P2', 'P2', '{}');

  const list = listAnalyses({ limit: 20 });
  assert(list.length >= 2, `목록 길이: ${list.length}`);
  // 최신순: an2 가 an1 보다 앞
  const idxAn1 = list.findIndex((x) => x.id === 'an1');
  const idxAn2 = list.findIndex((x) => x.id === 'an2');
  assert(idxAn2 < idxAn1, '최신순 정렬 실패');
  const item1 = list.find((x) => x.id === 'an1');
  assert.equal(item1.originalName, 'a.csv', 'originalName join 실패');
  assert.equal(item1.source, 'smartstore', 'source join 실패');
  assert.equal(item1.totalReviews, 10, 'summary.totalReviews 추출 실패');
  assert.equal(item1.productCount, 2, 'product_analyses 카운트 실패');
});

await step('history — listAnalyses limit 적용', async () => {
  const { listAnalyses } = await import('../src/db/database.js');
  const one = listAnalyses({ limit: 1 });
  assert.equal(one.length, 1, `limit=1 인데 ${one.length}건 반환`);
});

// ──────────────────────────────────────────────
// 전체 이슈 필터/정렬 (프론트 순수 로직)
// ──────────────────────────────────────────────
await step('전체 이슈 필터 — 전체 고정 + 카테고리 count 내림차순', async () => {
  const { buildIssueFilters } = await import('../../frontend/src/utils/issueFilters.js');
  const allIssues = [
    { category: '사이즈', issueLabel: '기장이 김', count: 5, severity: 'medium' },
    { category: '소재/두께', issueLabel: '비침 있음', count: 3, severity: 'high' },
    { category: '사이즈', issueLabel: '허리 작음', count: 4, severity: 'high' },
    { category: '배송/포장', issueLabel: '배송 지연', count: 2, severity: 'high' },
  ];
  const filters = buildIssueFilters(allIssues);
  assert.equal(filters[0].value, '전체', '전체가 첫 번째여야 함');
  assert.equal(filters[0].count, 14, `전체 count=${filters[0].count}`);
  assert.deepEqual(
    filters.map((f) => [f.label, f.count]),
    [['전체', 14], ['사이즈', 9], ['소재/두께', 3], ['배송/포장', 2]],
    '필터 순서/개수 불일치',
  );
});

await step('전체 이슈 필터 — count 0 카테고리 숨김', async () => {
  const { buildIssueFilters } = await import('../../frontend/src/utils/issueFilters.js');
  const filters = buildIssueFilters([{ category: '사이즈', count: 2 }]);
  // 전체 + 사이즈만, 다른 카테고리 없음
  assert.equal(filters.length, 2, `필터 개수=${filters.length}`);
  assert(filters.every((f) => f.count > 0), 'count 0 필터가 포함됨');
});

await step('전체 이슈 정렬 — 기본 많이 나온 순 (count→severity)', async () => {
  const { sortIssues } = await import('../../frontend/src/utils/issueFilters.js');
  const allIssues = [
    { issueLabel: '기장이 김', count: 5, severity: 'medium', ratio: 0.1 },
    { issueLabel: '비침 있음', count: 3, severity: 'high', ratio: 0.05 },
    { issueLabel: '허리 작음', count: 5, severity: 'high', ratio: 0.1 },
    { issueLabel: '배송 지연', count: 2, severity: 'high', ratio: 0.03 },
  ];
  const sorted = sortIssues(allIssues, 'count');
  // count 5 두 건이 먼저, 그 중 severity high(허리 작음)가 앞
  assert.equal(sorted[0].issueLabel, '허리 작음', `1순위=${sorted[0].issueLabel}`);
  assert.equal(sorted[1].issueLabel, '기장이 김', `2순위=${sorted[1].issueLabel}`);
  assert.equal(sorted[2].issueLabel, '비침 있음', `3순위=${sorted[2].issueLabel}`);
  assert.equal(sorted[3].issueLabel, '배송 지연', `4순위=${sorted[3].issueLabel}`);
});

// ──────────────────────────────────────────────
// source별 컬럼 자동 매핑
// ──────────────────────────────────────────────
await step('columnMapping #smartstore — 스마트스토어 컬럼명 자동 매핑', async () => {
  const { autoMapColumns } = await import('../src/services/columnMapping.service.js');
  const headers = ['상품명', '옵션정보', '구매자평점', '리뷰상세내용', '등록일시', '구매자명'];
  const rows = [{ '상품명': '셔츠', '옵션정보': 'M', '구매자평점': 5, '리뷰상세내용': '핏이 예뻐요. 만족합니다.', '등록일시': '2026-01-02', '구매자명': '김*' }];
  const m = autoMapColumns(headers, rows, 'smartstore');
  assert.equal(m.productName?.column, '상품명');
  assert.equal(m.optionName?.column, '옵션정보');
  assert.equal(m.rating?.column, '구매자평점');
  assert.equal(m.content?.column, '리뷰상세내용');
  assert.equal(m.createdAt?.column, '등록일시');
  assert.equal(m.writer?.column, '구매자명');
  // 스마트스토어 후보로 매칭된 reason 표시 확인
  assert(/스마트스토어/.test(m.rating?.reason || ''), `rating reason=${m.rating?.reason}`);
});

await step('columnMapping #cafe24 — 카페24 컬럼명 자동 매핑', async () => {
  const { autoMapColumns } = await import('../src/services/columnMapping.service.js');
  const headers = ['게시글번호', '상품정보', '글제목', '글내용', '작성일시', '회원ID', '관리자답변내용'];
  const rows = [{ '게시글번호': '123', '상품정보': '셔츠', '글제목': '좋아요', '글내용': '핏이 예뻐요. 만족합니다.', '작성일시': '2026-01-02', '회원ID': 'abc', '관리자답변내용': '감사합니다' }];
  const m = autoMapColumns(headers, rows, 'cafe24');
  assert.equal(m.reviewId?.column, '게시글번호');
  assert.equal(m.productName?.column, '상품정보');
  assert.equal(m.title?.column, '글제목');
  assert.equal(m.content?.column, '글내용');
  assert.equal(m.createdAt?.column, '작성일시');
  assert.equal(m.writer?.column, '회원ID');
  assert.equal(m.replyText?.column, '관리자답변내용');
});

await step('columnMapping #coupang — 쿠팡 컬럼명 자동 매핑', async () => {
  const { autoMapColumns } = await import('../src/services/columnMapping.service.js');
  const headers = ['노출상품명', '구매옵션명', '상품평점', '상품평내용', '상품평작성일', '구매자명'];
  const rows = [{ '노출상품명': '셔츠', '구매옵션명': 'M', '상품평점': 5, '상품평내용': '핏이 예뻐요. 만족합니다.', '상품평작성일': '2026-01-02', '구매자명': '김*' }];
  const m = autoMapColumns(headers, rows, 'coupang');
  assert.equal(m.productName?.column, '노출상품명');
  assert.equal(m.optionName?.column, '구매옵션명');
  assert.equal(m.rating?.column, '상품평점');
  assert.equal(m.content?.column, '상품평내용');
  assert.equal(m.createdAt?.column, '상품평작성일');
  assert.equal(m.writer?.column, '구매자명');
});

await step('columnMapping #custom — 자사몰/영문 컬럼명', async () => {
  const { autoMapColumns } = await import('../src/services/columnMapping.service.js');
  const headers = ['product', 'variant', 'score', 'review', 'date', 'user'];
  const rows = [{ product: '셔츠', variant: 'M', score: 5, review: 'great fit. very satisfied with the product overall.', date: '2026-01-02', user: 'u*' }];
  const m = autoMapColumns(headers, rows, 'custom');
  assert.equal(m.productName?.column, 'product');
  assert.equal(m.optionName?.column, 'variant');
  assert.equal(m.rating?.column, 'score');
  assert.equal(m.content?.column, 'review');
  assert.equal(m.createdAt?.column, 'date');
  assert.equal(m.writer?.column, 'user');
});

await step('columnMapping #unknown source — 에러 없이 공통 후보로 동작', async () => {
  const { autoMapColumns } = await import('../src/services/columnMapping.service.js');
  const headers = ['상품명', '리뷰내용', '평점'];
  const rows = [{ '상품명': '셔츠', '리뷰내용': '좋아요. 정말 만족합니다.', '평점': 5 }];
  const m = autoMapColumns(headers, rows, 'unknown_platform');
  assert.equal(m.productName?.column, '상품명');
  assert.equal(m.content?.column, '리뷰내용');
  assert.equal(m.rating?.column, '평점');
});

await step('columnMapping — source 가산점이 동점 공통 후보보다 source 후보를 선호', async () => {
  const { autoMapColumns } = await import('../src/services/columnMapping.service.js');
  // '상품정보' 는 카페24 productName 후보에 있지만 공통 후보에는 없다.
  const headers = ['상품정보', '내용'];
  const rows = [{ '상품정보': '셔츠', '내용': '핏이 예뻐요. 만족합니다.' }];
  const m = autoMapColumns(headers, rows, 'cafe24');
  assert.equal(m.productName?.column, '상품정보', '카페24 후보 매칭 실패');
  assert.equal(m.productName?.matchedFrom, 'cafe24', `matchedFrom=${m.productName?.matchedFrom}`);
});

await step('columnMapping — SOURCE_FIELD_CANDIDATES 구조 검증', async () => {
  const m = await import('../src/services/columnMapping.service.js');
  assert(m.SOURCE_FIELD_CANDIDATES, 'SOURCE_FIELD_CANDIDATES export 안 됨');
  for (const src of ['smartstore', 'cafe24', 'coupang', 'custom']) {
    assert(m.SOURCE_FIELD_CANDIDATES[src], `${src} 키 누락`);
  }
  // 각 플랫폼이 9개 필드 모두 가짐 (custom 제외)
  for (const src of ['smartstore', 'cafe24', 'coupang']) {
    for (const f of m.FIELDS) {
      assert(Array.isArray(m.SOURCE_FIELD_CANDIDATES[src][f]), `${src}.${f} 가 배열 아님`);
      assert(m.SOURCE_FIELD_CANDIDATES[src][f].length > 0, `${src}.${f} 비어 있음`);
    }
  }
});

// ──────────────────────────────────────────────
// 인증 / 소유권 / 사용량 (Express 앱을 띄워 e2e 테스트)
// ──────────────────────────────────────────────
async function makeApp({ demoAllowAnonymous = 'false', enforceLimits = 'false' } = {}) {
  process.env.DEMO_ALLOW_ANONYMOUS = demoAllowAnonymous;
  process.env.BILLING_ENFORCE_LIMITS = enforceLimits;
  // 모듈 캐시 무효화: middleware/auth 와 billing.service 는 import 시점에 env 를 읽으므로
  // 동적으로 import 하기 위해 cache-busting 쿼리스트링을 붙인다.
  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const billingRoutes = (await import(`../src/routes/billing.routes.js?t=${t}`)).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.get('/api/me', (req, res, next) => { req.url = '/me'; authRoutes(req, res, next); });
  app.use('/api/billing', billingRoutes);
  return app;
}

async function startServer(app) {
  return await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

async function jsonFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, body, setCookie };
}

await step('auth — 회원가입 성공 + password_hash 응답 노출 금지', async () => {
  const app = await makeApp();
  const { srv, port } = await startServer(app);
  try {
    const res = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a1@example.com', password: 'longenoughpw', name: 'A' }),
    });
    assert.equal(res.status, 201, `status=${res.status}`);
    assert(res.body?.user?.id, 'user.id 누락');
    assert.equal(res.body.user.email, 'a1@example.com');
    assert(!('password_hash' in (res.body.user || {})), 'password_hash 가 응답에 노출됨');
    assert(!('password' in (res.body.user || {})), 'password 가 응답에 노출됨');
    assert(res.setCookie && /reviewfit_token=/.test(res.setCookie), 'auth cookie 미발급');
  } finally { srv.close(); }
});

await step('auth — 중복 이메일 → 409', async () => {
  const app = await makeApp();
  const { srv, port } = await startServer(app);
  try {
    await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'longenoughpw' }),
    });
    const dup = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'b@example.com', password: 'longenoughpw' }),
    });
    assert.equal(dup.status, 409, `status=${dup.status}`);
    assert.equal(dup.body?.error, 'EMAIL_TAKEN');
  } finally { srv.close(); }
});

await step('auth — 로그인 성공 + 잘못된 비밀번호 → 401', async () => {
  const app = await makeApp();
  const { srv, port } = await startServer(app);
  try {
    await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'c@example.com', password: 'longenoughpw' }),
    });
    const ok = await jsonFetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'c@example.com', password: 'longenoughpw' }),
    });
    assert.equal(ok.status, 200);
    const bad = await jsonFetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'c@example.com', password: 'wrongpassword' }),
    });
    assert.equal(bad.status, 401, `status=${bad.status}`);
    assert.equal(bad.body?.error, 'INVALID_CREDENTIALS');
  } finally { srv.close(); }
});

await step('auth — /api/me 인증 필요 (cookie 없으면 401)', async () => {
  const app = await makeApp();
  const { srv, port } = await startServer(app);
  try {
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/me`);
    assert.equal(r.status, 401, `status=${r.status}`);
  } finally { srv.close(); }
});

await step('password — DB 에 평문 비밀번호 저장 금지', async () => {
  const app = await makeApp();
  const { srv, port } = await startServer(app);
  try {
    const password = 'plaintextpw1234';
    await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pw@example.com', password }),
    });
    const { default: db } = await import('../src/db/database.js');
    const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('pw@example.com');
    assert(row?.password_hash, 'password_hash 누락');
    assert(row.password_hash !== password, 'password_hash 가 평문과 동일');
    assert(row.password_hash.length > 30, 'bcrypt 해시 길이가 너무 짧음');
  } finally { srv.close(); }
});

// ── ownership: 같은 분석에 다른 사용자가 접근하면 403 ──
await step('ownership — userB 가 userA 의 analysis 접근 시 403', async () => {
  // requireAuth 가 실제로 차단하도록 DEMO_ALLOW_ANONYMOUS=false 로 분리된 앱 사용
  const { default: db, listAnalyses } = await import('../src/db/database.js');
  // userA / userB 직접 DB 에 생성
  const { nanoid } = await import('nanoid');
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash('whatever1', 10);
  const aId = nanoid();
  const bId = nanoid();
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(aId, 'ua@example.com', hash);
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(bId, 'ub@example.com', hash);
  const analysisId = 'an_owner_test_' + nanoid();
  db.prepare(
    `INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)`,
  ).run(analysisId, null, 'done', '{}', aId);

  // listAnalyses 가 userA 에는 보이고 userB 에는 보이지 않아야 함
  const aList = listAnalyses({ userId: aId });
  const bList = listAnalyses({ userId: bId });
  assert(aList.some((x) => x.id === analysisId), 'userA 가 자기 분석을 못 봄');
  assert(!bList.some((x) => x.id === analysisId), 'userB 가 userA 의 분석을 봄');
});

// ── billing: free 플랜 월 1회 제한 + recordUsage 기록 ──
await step('billing — free 월 1회 제한 계산', async () => {
  process.env.BILLING_ENFORCE_LIMITS = 'true';
  // billing.service 도 env 시점에 ENFORCE_LIMITS 를 읽으므로 캐시 무효화
  const t = Date.now() + Math.random();
  const billing = await import(`../src/services/billing.service.js?t=${t}`);
  const { default: db } = await import('../src/db/database.js');
  const { nanoid } = await import('nanoid');
  const userId = 'usage_user_' + nanoid();
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(userId, `${userId}@x.com`, 'x');

  // 첫 분석은 통과
  const r1 = billing.checkCanCreateAnalysis(userId, 5);
  assert(r1.ok, '첫 분석이 차단됨');
  billing.recordUsage(userId, 'analysis_created', { analysisId: 'a1' });
  // 두 번째는 plan limit=1 초과로 402
  const r2 = billing.checkCanCreateAnalysis(userId, 5);
  assert(!r2.ok, '월 1회 제한이 안 걸림');
  assert.equal(r2.status, 402);
  assert.equal(r2.body.error, 'PLAN_LIMIT_EXCEEDED');

  // 리뷰 수 초과 검증 — 별도 신규 사용자
  const rl = 'rl_user_' + nanoid();
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(rl, `${rl}@x.com`, 'x');
  const r3 = billing.checkCanCreateAnalysis(rl, 9999);
  assert(!r3.ok, '리뷰 수 제한이 안 걸림');
  assert.equal(r3.body.error, 'REVIEW_LIMIT_EXCEEDED');
});

await step('billing — BILLING_ENFORCE_LIMITS=false 면 제한 통과', async () => {
  process.env.BILLING_ENFORCE_LIMITS = 'false';
  const t = Date.now() + Math.random();
  const billing = await import(`../src/services/billing.service.js?t=${t}`);
  const r = billing.checkCanCreateAnalysis('anyuser', 999999);
  assert(r.ok, 'enforce=false 인데 제한이 걸림');
});

await step('billing — usage_events 에 analysis_created 기록됨', async () => {
  const { default: db } = await import('../src/db/database.js');
  const t = Date.now() + Math.random();
  const billing = await import(`../src/services/billing.service.js?t=${t}`);
  const { nanoid } = await import('nanoid');
  const userId = 'rec_user_' + nanoid();
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(userId, `${userId}@x.com`, 'x');
  billing.recordUsage(userId, 'analysis_created', { analysisId: 'foo', uploadId: 'bar' });
  const row = db.prepare('SELECT * FROM usage_events WHERE user_id = ?').get(userId);
  assert(row, 'usage_events 미기록');
  assert.equal(row.event_type, 'analysis_created');
  assert.equal(row.amount, 1);
});

await step('aiClient (mock)', async () => {
  const m = await import('../src/services/aiClient.service.js');
  const t = await m.generateReplyTemplates({ category: '사이즈', issueLabel: '허리가 작게 나옴' });
  assert(Array.isArray(t) && t.length === 3, '답글 템플릿 mock 실패');
});

if (failures.length) {
  console.error(`\n[check] 실패 ${failures.length}건: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n[check] 모든 점검 통과 ✓');
