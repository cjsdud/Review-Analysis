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
