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
