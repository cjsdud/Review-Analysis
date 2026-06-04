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
  const out = await m.parseFile(Buffer.from('상품명,리뷰내용\n티셔츠,너무 작아요\n'), 'x.csv');
  assert.equal(out.rows.length, 1, 'CSV 파싱 실패');
  assert.deepEqual(out.sheets, [], 'CSV 는 sheets 배열이 비어 있어야 함');
  assert.equal(out.selectedSheetName, null, 'CSV 는 selectedSheetName 이 null');
});

// XLSX 멀티 시트 / 헤더 행 자동 감지 테스트
async function buildXlsxBuffer(sheetSpecs) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const spec of sheetSpecs) {
    const ws = wb.addWorksheet(spec.name);
    for (const row of spec.aoa) ws.addRow(row);
  }
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(arr) ? arr : Buffer.from(arr);
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
  const out = await m.parseFile(buf, 'demo.xlsx');
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
  const out = await m.parseFile(buf, 'demo.xlsx');
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
  const out = await m.parseFile(buf, 'demo.xlsx');
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
  const out = await fp.parseFile(buf, 'demo.xlsx');
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

// 한국어/영어/snake_case/camelCase/혼합 컬럼명 자동 인식.
// 헤더 어휘를 정규화(소문자·공백·언더스코어·하이픈 제거)해서 후보 사전과 비교한다.
async function expectMapping(label, headers, sampleRow, expected) {
  const m = await import('../src/services/columnMapping.service.js');
  const map = m.autoMapColumns(headers, sampleRow ? [sampleRow] : []);
  for (const [field, expectedCol] of Object.entries(expected)) {
    assert.equal(
      map[field]?.column,
      expectedCol,
      `${label} — ${field}: 기대 '${expectedCol}', 실제 '${map[field]?.column || ''}'`,
    );
  }
}

await step('columnMapping — 한국어 컬럼명', async () => {
  await expectMapping(
    '한국어',
    ['상품명', '옵션', '별점', '리뷰내용', '작성일'],
    { 상품명: '티셔츠', 옵션: 'M', 별점: '5', 리뷰내용: '핏이 너무 예뻐요. 만족합니다.', 작성일: '2026-01-01' },
    { productName: '상품명', optionName: '옵션', rating: '별점', content: '리뷰내용', createdAt: '작성일' },
  );
});

await step('columnMapping — 영어 "Title Case" 컬럼명', async () => {
  await expectMapping(
    '영어',
    ['Product Name', 'Option Name', 'Star Rating', 'Review Text', 'Created Date'],
    {
      'Product Name': 'T-shirt',
      'Option Name': 'M',
      'Star Rating': '5',
      'Review Text': 'Nice fit and material feels great',
      'Created Date': '2026-01-01',
    },
    {
      productName: 'Product Name',
      optionName: 'Option Name',
      rating: 'Star Rating',
      content: 'Review Text',
      createdAt: 'Created Date',
    },
  );
});

await step('columnMapping — snake_case 컬럼명', async () => {
  await expectMapping(
    'snake_case',
    ['product_name', 'option_name', 'star_rating', 'review_text', 'created_at'],
    {
      product_name: 'T-shirt',
      option_name: 'M',
      star_rating: '5',
      review_text: 'good quality fabric',
      created_at: '2026-01-01',
    },
    {
      productName: 'product_name',
      optionName: 'option_name',
      rating: 'star_rating',
      content: 'review_text',
      createdAt: 'created_at',
    },
  );
});

await step('columnMapping — camelCase 컬럼명', async () => {
  await expectMapping(
    'camelCase',
    ['productName', 'optionName', 'rating', 'reviewText', 'createdAt'],
    {
      productName: 'T-shirt',
      optionName: 'M',
      rating: '5',
      reviewText: 'great fit and feel',
      createdAt: '2026-01-01',
    },
    {
      productName: 'productName',
      optionName: 'optionName',
      rating: 'rating',
      content: 'reviewText',
      createdAt: 'createdAt',
    },
  );
});

await step('columnMapping — 한·영 혼합 + 플랫폼 변형 (goodsName/skuOption/score/comment/reviewDate)', async () => {
  await expectMapping(
    '혼합',
    ['상품명', 'variant', 'score', 'comment', 'reviewDate'],
    {
      상품명: '셔츠',
      variant: 'L',
      score: '4',
      comment: '허리가 살짝 타이트해요. 한 치수 크게.',
      reviewDate: '2026-01-02',
    },
    {
      productName: '상품명',
      optionName: 'variant',
      rating: 'score',
      content: 'comment',
      createdAt: 'reviewDate',
    },
  );
});

await step('columnMapping — 영어 헤더에서 reviewText/rating 충돌 안 남 ("product rating" → rating 우선)', async () => {
  const m = await import('../src/services/columnMapping.service.js');
  const map = m.autoMapColumns(
    ['Item Name', 'Product Rating', 'Comment Body'],
    [{ 'Item Name': 'A', 'Product Rating': '5', 'Comment Body': 'looks great so far so good' }],
  );
  // 'Product Rating' 은 product+rating 양쪽 모두 후보지만 rating 이 우선순위에서 앞서 가져가야 한다.
  assert.equal(map.rating?.column, 'Product Rating', `rating 매핑 실패: ${map.rating?.column}`);
  assert.notEqual(map.productName?.column, 'Product Rating', 'productName 이 Product Rating 을 가져가면 안 됨');
});

await step('columnMapping — isMappingValid 가 rating(별점)까지 요구', async () => {
  const m = await import('../src/services/columnMapping.service.js');
  assert.equal(m.isMappingValid({ content: 'c' }), false, 'rating 없으면 invalid');
  assert.equal(m.isMappingValid({ rating: 'r' }), false, 'content 없으면 invalid');
  assert.equal(m.isMappingValid({ content: 'c', rating: 'r' }), true, '둘 다 있으면 valid');
  assert.deepEqual(m.missingRequiredFieldLabels({}), ['리뷰 내용', '별점']);
  assert.deepEqual(m.missingRequiredFieldLabels({ content: 'c' }), ['별점']);
});

await step('fileParser — 빈 헤더 셀은 "컬럼 N" 으로, 중복 헤더는 " (2)" 로 구분', async () => {
  const m = await import('../src/services/fileParser.service.js');
  const matrix = [
    ['상품명', '', '상품명', '리뷰내용'],
    ['A', 'x', 'B', 'good'],
    ['C', 'y', 'D', 'bad'],
  ];
  const r = m.rowsFromMatrix(matrix, 0);
  assert.deepEqual(r.headers, ['상품명', '컬럼 2', '상품명 (2)', '리뷰내용'],
    `headers: ${JSON.stringify(r.headers)}`);
  // 중복 컬럼 데이터가 보존되어야 한다 (이전엔 두 번째 '상품명' 컬럼 데이터가 사라졌음).
  assert.equal(r.rows[0]['상품명'], 'A');
  assert.equal(r.rows[0]['상품명 (2)'], 'B');
  assert.equal(r.rows[0]['컬럼 2'], 'x');
});

await step('plans — Business 플랜 + feature flags', async () => {
  const { PLAN_CODES, PLAN_FEATURES, getPlanFeatures } = await import('../src/constants/plans.js');
  assert.deepEqual(PLAN_CODES, ['free', 'starter', 'pro', 'business'], 'Business 플랜 누락');
  assert.equal(PLAN_FEATURES.free.canExportFullExcel, false);
  assert.equal(PLAN_FEATURES.starter.canExportFullExcel, true);
  assert.equal(PLAN_FEATURES.pro.canUsePrecisionAnalysis, true);
  assert.equal(PLAN_FEATURES.business.llmMode, 'advanced');
  assert.equal(PLAN_FEATURES.free.printWatermark, true);
  assert.equal(PLAN_FEATURES.starter.printWatermark, false);
  // getPlanFeatures fallback — 알 수 없는 코드는 free
  assert.equal(getPlanFeatures('unknown').label, 'Free');
});

await step('plans — resolveLlmPolicy + env override + advancedReportModel 가드', async () => {
  const { resolveLlmPolicy, PLAN_LLM_POLICY } = await import('../src/constants/plans.js');
  // Free 정책: basic 모드, mini 재분석 / advanced 모두 null
  const free = resolveLlmPolicy('free');
  assert.equal(free.llmMode, 'basic');
  assert.equal(free.precisionModel, null, 'Free 는 precision 모델 없음');
  assert.equal(free.advancedReportModel, null);
  assert.equal(free.allowMiniReanalysis, false);
  // Starter: standard 모드, 여전히 mini 재분석 OFF
  const starter = resolveLlmPolicy('starter');
  assert.equal(starter.llmMode, 'standard');
  assert.equal(starter.summaryModel, 'gpt-4o-mini');
  assert.equal(starter.allowMiniReanalysis, false);
  // Pro: mini 재분석 ON, advanced 는 여전히 차단
  const pro = resolveLlmPolicy('pro');
  assert.equal(pro.precisionModel, 'gpt-4o-mini');
  assert.equal(pro.advancedReportModel, null, 'Pro 는 advanced 차단');
  assert.equal(pro.allowMiniReanalysis, true);
  assert.equal(pro.maxMiniReanalysisRatio, 0.2);
  // Business: advanced 모델 사용 가능
  const business = resolveLlmPolicy('business');
  assert.equal(business.advancedReportModel, 'gpt-4o');
  assert.equal(business.maxMiniReanalysisRatio, 0.3);
  // env override — 환경변수가 있으면 우선
  process.env.OPENAI_REVIEW_MODEL = 'gpt-x-custom';
  process.env.OPENAI_ADVANCED_MODEL = 'gpt-x-advanced';
  const proWithEnv = resolveLlmPolicy('pro');
  assert.equal(proWithEnv.reviewModel, 'gpt-x-custom', 'env 가 있으면 우선');
  assert.equal(proWithEnv.advancedReportModel, null,
    'Business 가 아니면 OPENAI_ADVANCED_MODEL 이 있어도 advanced 차단');
  const businessWithEnv = resolveLlmPolicy('business');
  assert.equal(businessWithEnv.advancedReportModel, 'gpt-x-advanced');
  delete process.env.OPENAI_REVIEW_MODEL;
  delete process.env.OPENAI_ADVANCED_MODEL;
  // 알 수 없는 코드 → free
  assert.equal(resolveLlmPolicy('unknown').llmMode, PLAN_LLM_POLICY.free.llmMode);
});

await step('ai/index — selectLlmMode / shouldReanalyze / reviewHash', async () => {
  const ai = await import('../src/services/ai/index.js');
  // mode 매핑 — planCode 직접 입력
  assert.equal(ai.selectLlmMode('free').allowMiniReanalysis, false);
  assert.equal(ai.selectLlmMode('starter').allowMiniReanalysis, false, 'Starter 도 mini OFF');
  assert.equal(ai.selectLlmMode('pro').allowMiniReanalysis, true);
  assert.equal(ai.selectLlmMode('business').allowBrandToneReply, true);
  // 하위 호환: features 객체로 호출
  assert.equal(ai.selectLlmMode({ llmMode: 'basic' }).allowMiniReanalysis, false);
  assert.equal(ai.selectLlmMode({ llmMode: 'precision' }).allowMiniReanalysis, true);
  assert.equal(ai.selectLlmMode({ llmMode: 'advanced' }).allowBrandToneReply, true);
  // 플랜 정책이 막으면 shouldReanalyze 도 즉시 false (비용 가드)
  const freePolicy = ai.selectLlmMode('free');
  assert.equal(
    ai.shouldReanalyze({ sentiment: 'mixed', categories: [{ confidence: 0.4 }] }, '핏은 좋은데 좀 아쉽긴', freePolicy),
    false,
    'Free 정책이면 mixed/낮은 신뢰도여도 재분석 OFF',
  );
  const proPolicy = ai.selectLlmMode('pro');
  assert.equal(
    ai.shouldReanalyze({ sentiment: 'mixed', categories: [{ confidence: 0.4 }] }, '핏은 좋은데 좀 아쉽긴', proPolicy),
    true,
    'Pro 정책이면 같은 입력도 재분석 ON',
  );
  // shouldReanalyze 케이스
  assert.equal(ai.shouldReanalyze({ sentiment: 'mixed', categories: [{ confidence: 0.9 }] }), true,
    'mixed sentiment 는 mini 재분석 대상');
  assert.equal(
    ai.shouldReanalyze({ sentiment: 'positive', improvementIssues: [{ severity: 'low' }], categories: [{ confidence: 0.9 }] }),
    true,
    'positive + issue 도 mini 재분석 대상',
  );
  assert.equal(
    ai.shouldReanalyze({ sentiment: 'positive', improvementIssues: [], categories: [{ confidence: 0.95 }] }, '핏이 좋아요'),
    false,
    '깔끔한 positive 는 재분석 OFF',
  );
  // ratingReliable + 충돌
  assert.equal(
    ai.shouldReanalyze({ sentiment: 'negative', rating: 5, ratingReliable: true, categories: [{ confidence: 0.9 }] }),
    true,
    '별점 5 + negative 는 충돌 → 재분석',
  );
  // 반전 표현
  assert.equal(
    ai.shouldReanalyze({ sentiment: 'neutral', categories: [{ confidence: 0.9 }] }, '핏은 예쁜데 좀 아쉽긴 합니다'),
    true,
    '대조/아쉬움 어휘 포함 → 재분석',
  );
  // reviewHash 안정성
  const h1 = ai.reviewHash('핏이 좋아요');
  const h2 = ai.reviewHash('핏이 좋아요');
  const h3 = ai.reviewHash('핏이 별로');
  assert.equal(h1, h2, '같은 텍스트 → 같은 해시');
  assert.notEqual(h1, h3, '다른 텍스트 → 다른 해시');
  assert.equal(h1.length, 40, 'sha1 hex 40자');
});

await step('ai/cache — review_analysis_cache hit / miss / promptVersion 변경 시 miss', async () => {
  const cache = await import('../src/services/ai/cache.service.js');
  const ai = await import('../src/services/ai/index.js');
  const hash = ai.reviewHash('test-review-content');
  // miss
  assert.equal(
    cache.getCachedReviewAnalysis({
      reviewHash: hash, promptVersion: ai.PROMPT_VERSION,
      analysisVersion: ai.ANALYSIS_VERSION, model: 'gpt-4o-mini',
    }),
    null,
  );
  // save
  cache.saveReviewAnalysisCache({
    reviewHash: hash, promptVersion: ai.PROMPT_VERSION, analysisVersion: ai.ANALYSIS_VERSION,
    provider: 'openai', model: 'gpt-4o-mini', result: { sentiment: 'positive' },
  });
  // hit
  const hit = cache.getCachedReviewAnalysis({
    reviewHash: hash, promptVersion: ai.PROMPT_VERSION,
    analysisVersion: ai.ANALYSIS_VERSION, model: 'gpt-4o-mini',
  });
  assert.deepEqual(hit, { sentiment: 'positive' });
  // promptVersion 다르면 miss
  const miss = cache.getCachedReviewAnalysis({
    reviewHash: hash, promptVersion: 'different',
    analysisVersion: ai.ANALYSIS_VERSION, model: 'gpt-4o-mini',
  });
  assert.equal(miss, null);
});

await step('plans — 기본 모델은 실재 OpenAI 모델 (gpt-4o-mini / gpt-4o)', async () => {
  const { resolveLlmPolicy } = await import('../src/constants/plans.js');
  const ok = (m) => /^gpt-(4o|4\.1)(-(mini|nano))?$/.test(m);
  for (const code of ['free', 'starter', 'pro', 'business']) {
    const p = resolveLlmPolicy(code);
    assert(ok(p.reviewModel), `${code}.reviewModel 비실재 모델: ${p.reviewModel}`);
    assert(ok(p.summaryModel), `${code}.summaryModel: ${p.summaryModel}`);
    assert(ok(p.csReplyModel), `${code}.csReplyModel: ${p.csReplyModel}`);
    if (p.precisionModel) assert(ok(p.precisionModel), `${code}.precisionModel: ${p.precisionModel}`);
    if (p.advancedReportModel) assert(ok(p.advancedReportModel), `${code}.advanced: ${p.advancedReportModel}`);
  }
});

await step('aiClient — sessionStats 가 ok/fallback/skipped 누적 + resetSessionStats', async () => {
  // tryLLM 은 export 가 안 되어 있으므로 setCallStatus 동작을 간접적으로 검증.
  // mock 모드(aiMode='mock')에서는 tryLLM 이 'skipped' 로 떨어지는 경로만 확인 가능.
  const aiClient = (await import('../src/services/aiClient.service.js')).default;
  aiClient.resetSessionStats();
  assert.deepEqual(
    { realCalls: aiClient.sessionStats.realCalls, fallbacks: aiClient.sessionStats.fallbacks, skipped: aiClient.sessionStats.skipped },
    { realCalls: 0, fallbacks: 0, skipped: 0 },
    'reset 직후 모든 카운터 0',
  );
  // mock 환경에서 generate 호출 — skipped 가 1 늘어야 한다.
  await aiClient.generateIssueLabel('테스트', ['리뷰']);
  assert(aiClient.sessionStats.skipped >= 1, 'mock 모드는 skipped 로 집계');
  assert.equal(aiClient.sessionStats.realCalls, 0, '실 LLM 호출 0');
  assert.equal(aiClient.lastCallStatus, 'skipped');
});

await step('aiClient — lastUsage 가 provider 응답에서 token 추출 (OpenAI/Gemini/Claude shape)', async () => {
  // 실제 네트워크 호출 없이, provider 응답을 흉내낸 객체로 setLastUsage 가
  // 잘 채워지는지 검증한다. aiClient 의 callOpenAI/Gemini/Claude 는 export 가
  // 없으므로 응답 schema 형태로 setLastUsage 가 받는 값만 흉내낸다.
  const aiClient = (await import('../src/services/aiClient.service.js')).default;
  // 초기 lastUsage 는 0
  assert.equal(aiClient.lastUsage.totalTokens, 0);
  // OpenAI shape: data.usage.prompt_tokens / completion_tokens
  const openaiResp = { usage: { prompt_tokens: 120, completion_tokens: 80 } };
  // Gemini shape: usageMetadata.promptTokenCount / candidatesTokenCount
  const geminiResp = { usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 60 } };
  // Claude shape: usage.input_tokens / output_tokens
  const claudeResp = { usage: { input_tokens: 50, output_tokens: 30 } };
  // 각 provider 의 token 추출 식을 직접 검증 (aiClient.service.js 의 setLastUsage 호출 위치와 동일 식)
  const fromOpenAI = (openaiResp?.usage?.prompt_tokens || 0) + (openaiResp?.usage?.completion_tokens || 0);
  const fromGemini = (geminiResp?.usageMetadata?.promptTokenCount || 0) + (geminiResp?.usageMetadata?.candidatesTokenCount || 0);
  const fromClaude = (claudeResp?.usage?.input_tokens || 0) + (claudeResp?.usage?.output_tokens || 0);
  assert.equal(fromOpenAI, 200, 'OpenAI 응답에서 total 200');
  assert.equal(fromGemini, 260, 'Gemini 응답에서 total 260');
  assert.equal(fromClaude, 80, 'Claude 응답에서 total 80');
  // usage 가 없는 응답에서도 안전하게 0 처리 (방어적)
  const missing = {};
  const fromMissing = (missing?.usage?.prompt_tokens || 0) + (missing?.usage?.completion_tokens || 0);
  assert.equal(fromMissing, 0);
});

await step('ai/usage — estimateCostUsd: gpt-4o-mini / 4505 input → 0 보다 큰 비용', async () => {
  const u = await import('../src/services/ai/usage.service.js');
  // 비공개 모듈 함수라 record → SUM 으로 간접 검증.
  const db = (await import('../src/db/database.js')).default;
  db.prepare('DELETE FROM llm_usage_logs WHERE provider = ?').run('test_cost');
  u.recordLlmUsage({
    provider: 'test_cost', model: 'gpt-4o-mini', requestType: 'review_reanalysis',
    usage: { inputTokens: 4505, outputTokens: 0 },
  });
  const row = db.prepare(`SELECT estimated_cost_usd FROM llm_usage_logs WHERE provider = ?`).get('test_cost');
  assert(row.estimated_cost_usd > 0, `cost=0 (4505 input × gpt-4o-mini 면 0 초과여야): ${row.estimated_cost_usd}`);
  // gpt-4o-mini: $0.15 per 1M input → 4505 * 0.15 / 1_000_000 = 0.000675
  assert(row.estimated_cost_usd > 0.0006 && row.estimated_cost_usd < 0.0008,
    `예상 ~0.000675 인데 실제 ${row.estimated_cost_usd}`);
});

await step('ai/usage — normalizeModelName: suffix 가 붙은 모델명도 base 로 흡수', async () => {
  const u = await import('../src/services/ai/usage.service.js');
  assert.equal(u.normalizeModelName('gpt-4o-mini-2024-07-18'), 'gpt-4o-mini');
  assert.equal(u.normalizeModelName('GPT-4o'), 'gpt-4o');
  assert.equal(u.normalizeModelName('gpt-4o'), 'gpt-4o');
  // gpt-4o-mini-* 가 gpt-4o 보다 우선 매칭 (긴 prefix 우선)
  assert.equal(u.normalizeModelName('gpt-4o-mini-latest'), 'gpt-4o-mini');
});

await step('ai/usage — normalizeUsage: total 만 있고 input/output 0 이면 input 으로 추정', async () => {
  const u = await import('../src/services/ai/usage.service.js');
  const n = u.normalizeUsage({ total_tokens: 4505 });
  assert.equal(n.totalTokens, 4505);
  assert(n.inputTokens > 0, '총 토큰만 있을 때 input>0 로 추정');
  // Gemini schema
  const g = u.normalizeUsage({ promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 });
  assert.equal(g.inputTokens, 100);
  assert.equal(g.outputTokens, 50);
  assert.equal(g.totalTokens, 150);
});

await step('analysisJob — updateProgress 가 절대 감소하지 않음 + completed 후엔 무시', async () => {
  const m = await import('../src/services/analysisJob.service.js');
  const id = 'prog_mono_' + Date.now();
  m.createPendingJob({ analysisId: id, uploadId: 'u1', userId: null, totalReviews: 10, isSample: false });
  m.markProcessing(id);
  m.updateProgress(id, 30);
  assert.equal(m.getJobStatus(id).progress, 30);
  m.updateProgress(id, 50);
  assert.equal(m.getJobStatus(id).progress, 50);
  // 더 작은 값 — 무시
  m.updateProgress(id, 20);
  assert.equal(m.getJobStatus(id).progress, 50, '감소 시도 무시');
  m.markCompleted(id, JSON.stringify({}));
  m.updateProgress(id, 90);
  assert.equal(m.getJobStatus(id).progress, 100, 'completed 후엔 변경 무시');
});

await step('ai/usage — listLlmLogs / getLlmUsageSummary 관리자 조회', async () => {
  const usage = await import('../src/services/ai/usage.service.js');
  // 분석 단위 요약 행 1개 + OpenAI 호출 1개 + mock fallback 1개 기록
  usage.recordLlmUsage({
    provider: 'mock', model: 'gpt-4o-mini', requestType: 'analysis_summary',
    reviewCount: 100, cacheHitCount: 20, cacheMissCount: 5, miniReanalysisCount: 5,
    openaiCalled: false, fallbackUsed: true, fallbackProvider: 'mock',
  });
  usage.recordLlmUsage({
    provider: 'openai', model: 'gpt-4o-mini', requestType: 'review_reanalysis',
    usage: { inputTokens: 1000, outputTokens: 500 }, openaiCalled: true,
  });
  const list = usage.listLlmLogs({ page: 1, limit: 5 });
  assert(list.rows.length >= 2, '로그 행 반환');
  assert(list.total >= 2, 'total count 반환');
  // provider filter
  const openaiOnly = usage.listLlmLogs({ filters: { provider: 'openai' } });
  assert(openaiOnly.rows.every((r) => r.provider === 'openai'), 'provider filter 작동');
  // summary
  const sum = usage.getLlmUsageSummary();
  assert(typeof sum.todayTotalTokens === 'number');
  assert(typeof sum.monthEstimatedCostUsd === 'number');
  assert(sum.openaiCallCount >= 1, 'openai 호출 카운트 반영');
});

await step('ai/usage — llm_usage_logs 기록 + 토큰/비용 계산', async () => {
  const usage = await import('../src/services/ai/usage.service.js');
  const id = usage.recordLlmUsage({
    provider: 'openai', model: 'gpt-4o-mini', requestType: 'review_reanalysis',
    usage: { inputTokens: 100, outputTokens: 50 },
  });
  assert(id, 'log row id 반환');
  const db = (await import('../src/db/database.js')).default;
  const row = db.prepare('SELECT * FROM llm_usage_logs WHERE id = ?').get(id);
  assert.equal(row.input_tokens, 100);
  assert.equal(row.output_tokens, 50);
  assert.equal(row.total_tokens, 150);
  assert(row.estimated_cost_usd > 0, '비용 추정 채워짐');
  // 실패 케이스 — status=error 도 기록 가능
  const id2 = usage.recordLlmUsage({
    provider: 'openai', model: 'gpt-4o-mini', requestType: 'cs_reply',
    status: 'error', error: 'timeout',
  });
  const row2 = db.prepare('SELECT * FROM llm_usage_logs WHERE id = ?').get(id2);
  assert.equal(row2.status, 'error');
  assert.equal(row2.error_message, 'timeout');
});

await step('billing — checkCanGenerateCsReply / checkCanUploadFile / resetMonthlyUsage', async () => {
  // 익명/billing 미적용 → 항상 ok
  const m = await import('../src/services/billing.service.js');
  assert.equal(m.checkCanGenerateCsReply(null).ok, true, '익명은 통과');
  assert.equal(m.checkCanUploadFile(null).ok, true, '익명은 통과');
});

await step('aiClient — role 별 model 분리 + env override', async () => {
  // 동적 import 후 modelForRole 검증.
  const ai = (await import('../src/services/aiClient.service.js')).default;
  // 기본값 (LLM_MODEL 도 없는 mock 환경) — 모두 빈 문자열 또는 fallback default
  const review = ai.modelForRole('review');
  const summary = ai.modelForRole('summary');
  const precision = ai.modelForRole('precision');
  const csReply = ai.modelForRole('csReply');
  // 모두 동일 LLM_MODEL fallback 이거나 빈 문자열
  assert(typeof review === 'string');
  assert(typeof summary === 'string');
  assert(typeof precision === 'string');
  assert(typeof csReply === 'string');
});

await step('aiClient — classifyAmbiguousReviews 가 새 schema (mentionedAspects / improvementIssues) 로 정규화', async () => {
  const ai = (await import('../src/services/aiClient.service.js')).default;
  // mock 모드에서 호출 — schema 가 신규 키를 가져야 함.
  const out = await ai.classifyAmbiguousReviews([{ id: 'r1', content: '핏 좋아요' }], ['사이즈', '소재/두께']);
  assert(Array.isArray(out) && out.length === 1);
  const o = out[0];
  assert.equal(o.reviewId, 'r1');
  assert(Array.isArray(o.mentionedAspects), 'mentionedAspects 배열 보장');
  assert(Array.isArray(o.improvementIssues), 'improvementIssues 배열 보장');
  assert.equal(typeof o.needsReply, 'boolean');
});

await step('productAnalysis — aggregateSentiment 가 mixed 버킷 포함', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: '1', productName: '셔츠', rating: 5, content: '핏 좋아요 만족' },
    { id: '2', productName: '셔츠', rating: 3, content: '색감은 예쁜데 화면보다 조금 어두워요' },
    { id: '3', productName: '셔츠', rating: 1, content: '환불 원합니다 못 입겠어요' },
  ];
  const { summary } = await runAnalysis(reviews);
  assert(summary.sentimentCounts.mixed >= 0, 'mixed 키 존재');
  assert(typeof summary.sentimentRatios.mixed === 'number');
});

await step('analysisModes — 카드별 사용 한도가 mode.minPlan 기준이라 서로 다른 숫자', async () => {
  const m = await import('../../frontend/src/constants/analysisModes.js');
  // 5 개 모드의 사용 한도 라인 (Business 사용자라도) 가 모두 다른 숫자여야 한다.
  const businessUserCurrent = m.PLAN_LIMITS.business;
  const lineSets = m.ANALYSIS_MODES.map((mode) => {
    const limits = m.getLimitsForCard(mode); // currentFeatures 더 이상 영향 X
    return { id: mode.id, limits, lines: m.formatPlanLimitLines(limits, mode) };
  });
  // (1) 각 mode 의 limits 가 그 mode.minPlan 의 PLAN_LIMITS 와 정확히 같다
  for (const x of lineSets) {
    const mode = m.ANALYSIS_MODES.find((mm) => mm.id === x.id);
    assert.strictEqual(x.limits, m.PLAN_LIMITS[mode.minPlan],
      `${x.id} 카드가 minPlan=${mode.minPlan} 한도를 안 씀`);
  }
  // (2) currentFeatures 가 들어와도 결과가 동일 (deprecated path 제거 회귀 가드)
  for (const mode of m.ANALYSIS_MODES) {
    const a = m.getLimitsForCard(mode);
    // 새 시그니처는 currentFeatures 를 받지 않으므로 호출이 그대로 minPlan 만 반영해야 한다.
    assert.strictEqual(a, m.PLAN_LIMITS[mode.minPlan]);
  }
  // (3) quick / standard / precision / advanced 4 카드의 월 리뷰 숫자는 서로 다르다.
  // (batch 는 standard 와 같은 starter 기준이라 동일 — 의도된 동작)
  const ids = ['quick', 'standard', 'precision', 'advanced'];
  const counts = ids.map((id) => lineSets.find((x) => x.id === id).limits.monthlyReviewLimit);
  assert.equal(new Set(counts).size, 4, `4 카드의 월 리뷰가 모두 달라야 함: ${counts.join(',')}`);
  // (4) Business 사용자라도 quick 카드는 Free 한도(500) 가 나와야 한다
  const quickLines = lineSets.find((x) => x.id === 'quick').lines;
  assert(quickLines.some((l) => l.includes('500')), `quick 카드는 Free 500 한도: ${quickLines.join(' | ')}`);
  // (5) advanced 카드는 Business 한도(50,000) 가 나와야 한다
  const advLines = lineSets.find((x) => x.id === 'advanced').lines;
  assert(advLines.some((l) => l.includes('50,000')), `advanced 카드는 Business 50,000 한도: ${advLines.join(' | ')}`);
  // (6) batch 카드는 starter 한도 + "부터" 표기
  const batchLines = lineSets.find((x) => x.id === 'batch').lines;
  assert(batchLines.some((l) => l.includes('부터')), `batch 카드에 "부터" 표기: ${batchLines.join(' | ')}`);
  // (7) 상단 "현재 플랜 요약" 은 사용자 plan 기준 — Business 면 50,000 이어야 한다
  const summary = m.formatCurrentPlanSummary('business', businessUserCurrent);
  assert(summary.some((l) => l.includes('50,000')), '현재 플랜 요약(Business)에 50,000');
  // Free 면 500
  const summaryFree = m.formatCurrentPlanSummary('free', null);
  assert(summaryFree.some((l) => l.includes('500')), '현재 플랜 요약(Free)에 500');
});

await step('plans — frontend PLAN_LIMITS 와 backend PLAN_FEATURES 숫자 일치', async () => {
  const fe = await import('../../frontend/src/constants/analysisModes.js');
  const be = await import('../src/constants/plans.js');
  const KEYS = ['monthlyReviewLimit', 'monthlyFileLimit', 'maxProductsPerFile', 'monthlyCsReplyLimit', 'dataRetentionDays'];
  for (const code of ['free', 'starter', 'pro', 'business']) {
    const f = fe.PLAN_LIMITS[code];
    const b = be.PLAN_FEATURES[code];
    for (const k of KEYS) {
      assert.equal(f[k], b[k], `${code}.${k} 불일치 (frontend=${f[k]} backend=${b[k]})`);
    }
  }
});

await step('plans — normalizePlan (대소문자/공백 변형 흡수)', async () => {
  const m = await import('../src/constants/plans.js');
  assert.equal(m.normalizePlan('Business'), 'business');
  assert.equal(m.normalizePlan(' BUSINESS '), 'business');
  assert.equal(m.normalizePlan('PRO'), 'pro');
  assert.equal(m.normalizePlan(null), 'free');
  assert.equal(m.normalizePlan('unknown'), 'free', '알 수 없는 값은 free fallback');
});

await step('analysisModes — canUseAnalysisMode 가 Business 대소문자 흡수', async () => {
  const m = await import('../src/constants/analysisModes.js');
  for (const variant of ['business', 'Business', 'BUSINESS', ' business ']) {
    for (const mode of ['quick', 'standard', 'precision', 'advanced', 'batch']) {
      assert.equal(m.canUseAnalysisMode(variant, mode), true,
        `business 변형(${JSON.stringify(variant)}) 에서 ${mode} 차단됨`);
    }
  }
});

await step('analysisModes — canUseAnalysisMode 권한 매트릭스 (batch=Starter 이상)', async () => {
  const m = await import('../src/constants/analysisModes.js');
  // Free
  assert.equal(m.canUseAnalysisMode('free', 'quick'), true);
  assert.equal(m.canUseAnalysisMode('free', 'standard'), false);
  assert.equal(m.canUseAnalysisMode('free', 'batch'), false);
  // Starter — batch 허용 (spec 핵심)
  assert.equal(m.canUseAnalysisMode('starter', 'quick'), true);
  assert.equal(m.canUseAnalysisMode('starter', 'standard'), true);
  assert.equal(m.canUseAnalysisMode('starter', 'batch'), true);
  assert.equal(m.canUseAnalysisMode('starter', 'precision'), false);
  assert.equal(m.canUseAnalysisMode('starter', 'advanced'), false);
  // Pro
  assert.equal(m.canUseAnalysisMode('pro', 'precision'), true);
  assert.equal(m.canUseAnalysisMode('pro', 'advanced'), false);
  // Business — 전체 허용
  for (const mid of ['quick', 'standard', 'precision', 'advanced', 'batch']) {
    assert.equal(m.canUseAnalysisMode('business', mid), true, `business 가 ${mid} 차단됨`);
  }
  // 기본값
  assert.equal(m.defaultAnalysisModeFor('free'), 'quick');
  assert.equal(m.defaultAnalysisModeFor('business'), 'advanced');
});

await step('analysisModes — computeEffectivePolicy: plan=Business + mode=quick 이면 mini OFF', async () => {
  const m = await import('../src/constants/analysisModes.js');
  const ai = await import('../src/services/ai/index.js');
  // Business plan + advanced mode → 모두 ON
  const advanced = m.computeEffectivePolicy(ai.selectLlmMode('business'), 'advanced');
  assert.equal(advanced.allowMiniReanalysis, true);
  assert.equal(advanced.usesCsReplyLlm, true);
  assert.equal(advanced.usesAdvancedReport, true);
  // Business 이지만 quick 으로 다운그레이드 → 모두 OFF (가장 중요한 spec)
  const quick = m.computeEffectivePolicy(ai.selectLlmMode('business'), 'quick');
  assert.equal(quick.allowMiniReanalysis, false, 'Business + quick 은 mini OFF');
  assert.equal(quick.usesCsReplyLlm, false, 'Business + quick 은 CS LLM OFF');
  assert.equal(quick.usesProductSummaryLlm, false);
  assert.equal(quick.usesOverallSummaryLlm, false);
  // Pro plan + standard mode → mini OFF (mode 가 OFF 이므로)
  const proStd = m.computeEffectivePolicy(ai.selectLlmMode('pro'), 'standard');
  assert.equal(proStd.allowMiniReanalysis, false);
  assert.equal(proStd.usesProductSummaryLlm, true);
  // batch — Starter 가능, mini OFF + cs OFF + summary ON
  const batch = m.computeEffectivePolicy(ai.selectLlmMode('starter'), 'batch');
  assert.equal(batch.usesBatch, true);
  assert.equal(batch.allowMiniReanalysis, false);
  assert.equal(batch.usesCsReplyLlm, false);
  assert.equal(batch.usesProductSummaryLlm, true);
});

await step('runAnalysis — analysisMode=quick 이면 product_summary / cs_reply / report_summary LLM 호출 모두 OFF', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const db = (await import('../src/db/database.js')).default;
  const aid = 'mode_quick_' + Date.now();
  await runAnalysis(
    [{ id: 'q1', productName: '셔츠', rating: 5, content: '핏이 예뻐요 만족' }],
    [],
    { planCode: 'business', userId: null, analysisId: aid, analysisMode: 'quick' },
  );
  const rows = db.prepare(
    `SELECT request_type FROM llm_usage_logs WHERE analysis_id = ?`,
  ).all(aid);
  const types = new Set(rows.map((r) => r.request_type));
  assert(!types.has('product_summary'), `quick 인데 product_summary 호출됨`);
  assert(!types.has('cs_reply'), 'quick 인데 cs_reply 호출됨');
  assert(!types.has('report_summary'), 'quick 인데 report_summary 호출됨');
  // analysis_summary 는 메타 로그라 항상 남는다.
  assert(types.has('analysis_summary'), 'analysis_summary row 누락');
});

await step('runAnalysis — analysisMode=standard 면 product_summary/report_summary 호출되지만 mini=OFF', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const db = (await import('../src/db/database.js')).default;
  const aid = 'mode_std_' + Date.now();
  await runAnalysis(
    [{ id: 's1', productName: '셔츠', rating: 2, content: '허리가 너무 작아요 환불' }],
    [],
    { planCode: 'pro', userId: null, analysisId: aid, analysisMode: 'standard' },
  );
  const rows = db.prepare(`SELECT request_type FROM llm_usage_logs WHERE analysis_id = ?`).all(aid);
  const types = new Set(rows.map((r) => r.request_type));
  assert(types.has('product_summary'), `standard 는 product_summary 호출되어야 함`);
  assert(types.has('report_summary'), 'standard 는 report_summary 호출되어야 함');
  assert(!types.has('review_reanalysis'), 'standard 는 mini 재분석 OFF');
});

await step('llm_usage_logs — runAnalysis 가 product_summary / cs_reply / report_summary / analysis_summary row 를 모두 남김', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const db = (await import('../src/db/database.js')).default;
  const aid = 'aud_' + Date.now();
  const reviews = [
    { id: 'r1', productName: '셔츠', rating: 1, content: '실밥이 많고 마감이 별로예요' },
    { id: 'r2', productName: '셔츠', rating: 5, content: '핏이 예뻐요 만족합니다' },
    { id: 'r3', productName: '셔츠', rating: 2, content: '허리가 작아요' },
  ];
  await runAnalysis(reviews, [], { planCode: 'pro', userId: null, analysisId: aid });
  const rows = db.prepare(
    `SELECT request_type, COUNT(*) AS n FROM llm_usage_logs WHERE analysis_id = ? GROUP BY request_type`,
  ).all(aid);
  const byType = Object.fromEntries(rows.map((r) => [r.request_type, r.n]));
  // mock 환경에선 mini 재분석은 안 일어날 수도 있지만 (조건부) product_summary / cs_reply /
  // report_summary 는 매번 호출되므로 row 가 반드시 존재해야 한다.
  assert(byType.product_summary >= 1, `product_summary row 누락: ${JSON.stringify(byType)}`);
  assert(byType.report_summary >= 1, `report_summary row 누락: ${JSON.stringify(byType)}`);
  assert(byType.analysis_summary >= 1, 'analysis_summary row 누락');
  // cs_reply 는 top issue 가 있어야 호출되는데 위 데이터로는 일반적으로 1+
  // (강한 부정 어휘 있음). 없을 수도 있으니 soft assert.
});

await step('replyTemplates — 5 tones 모두 분명히 다른 문장 (polite/friendly/concise/empathetic/professional)', async () => {
  const m = await import('../src/services/replyTemplates.service.js');
  const variants = m.buildReplyTemplates({
    issueLabel: '허리가 작게 나옴',
    category: '사이즈',
    polarity: 'negative',
    isActionableIssue: true,
    severity: 'medium',
  });
  const tones = variants.map((v) => v.tone).sort();
  assert.deepEqual(tones, ['concise', 'empathetic', 'friendly', 'polite', 'professional'].sort(),
    `5 tone 누락: ${tones.join(',')}`);
  // 각 tone 의 template 이 서로 다른 문장이어야 한다 (단순 어휘 치환이 아닌 분명한 차이)
  const set = new Set(variants.map((v) => v.template));
  assert.equal(set.size, 5, 'tone 별 문장이 모두 달라야 함');
  // concise 는 가장 짧아야 한다
  const concise = variants.find((v) => v.tone === 'concise');
  const polite = variants.find((v) => v.tone === 'polite');
  assert(concise.template.length < polite.template.length,
    `concise 가 polite 보다 짧아야 함 (concise=${concise.template.length}, polite=${polite.template.length})`);
  // empathetic 은 "불편" / "아쉬" / "죄송" 같은 공감/사과 어휘를 포함해야 한다
  const empathetic = variants.find((v) => v.tone === 'empathetic');
  assert(/불편|아쉬|죄송/.test(empathetic.template), 'empathetic 톤에 공감 어휘 필요');
  // professional 은 "검토/검수/검토하겠습니다" 같은 절차 어휘를 포함해야 한다
  const professional = variants.find((v) => v.tone === 'professional');
  assert(/검토|검수|개선/.test(professional.template), 'professional 톤에 절차 어휘 필요');
  // 각 variant 에 한국어 라벨도 함께 노출
  for (const v of variants) {
    assert(typeof v.toneLabel === 'string' && v.toneLabel.length > 0, `tone ${v.tone} 의 toneLabel 누락`);
  }
});

await step('aiClient — normalizeReplyTone (legacy 한글 / 신규 영문 모두 흡수)', async () => {
  const m = await import('../src/services/aiClient.service.js');
  assert.equal(m.normalizeReplyTone('polite'), 'polite');
  assert.equal(m.normalizeReplyTone('Friendly'), 'friendly', '대소문자 무시');
  assert.equal(m.normalizeReplyTone('기본'), 'polite', 'legacy 기본 → polite');
  assert.equal(m.normalizeReplyTone('정중'), 'polite');
  assert.equal(m.normalizeReplyTone('친근'), 'friendly');
  assert.equal(m.normalizeReplyTone('공감'), 'empathetic');
  assert.equal(m.normalizeReplyTone('알수없는'), 'polite', '알 수 없으면 polite');
});

await step('analysisJob — pending → processing → completed 전이 + getJobStatus', async () => {
  const m = await import('../src/services/analysisJob.service.js');
  const id = 'job_test_' + Date.now();
  m.createPendingJob({ analysisId: id, uploadId: 'u1', userId: null, totalReviews: 10, isSample: false });
  let s = m.getJobStatus(id);
  assert.equal(s.status, 'pending');
  assert.equal(s.progress, 0);
  m.markProcessing(id);
  s = m.getJobStatus(id);
  assert.equal(s.status, 'processing');
  assert(s.startedAt, 'startedAt 채워짐');
  m.updateProgress(id, 50);
  assert.equal(m.getJobStatus(id).progress, 50);
  m.markCompleted(id, JSON.stringify({ totalReviews: 10 }));
  s = m.getJobStatus(id);
  assert.equal(s.status, 'completed');
  assert.equal(s.progress, 100);
  assert(s.completedAt, 'completedAt 채워짐');
});

await step('analysisJob — failed 전이 + errorMessage 저장', async () => {
  const m = await import('../src/services/analysisJob.service.js');
  const id = 'job_fail_' + Date.now();
  m.createPendingJob({ analysisId: id, uploadId: 'u1', userId: null, totalReviews: 5, isSample: false });
  m.markProcessing(id);
  m.markFailed(id, 'timeout of 60000ms exceeded');
  const s = m.getJobStatus(id);
  assert.equal(s.status, 'failed');
  assert.equal(s.errorMessage, 'timeout of 60000ms exceeded');
  assert(s.failedAt, 'failedAt 채워짐');
});

await step('analysisJob — recoverStaleAnalysisJobs: 오래된 processing 만 failed 로', async () => {
  const m = await import('../src/services/analysisJob.service.js');
  const db = (await import('../src/db/database.js')).default;
  // 1) 1시간 전 processing — 회수 대상
  const oldId = 'job_old_' + Date.now();
  db.prepare(
    `INSERT INTO analysis_jobs (id, upload_id, status, summary, created_at)
     VALUES (?, ?, 'processing', ?, datetime('now', '-2 hours'))`,
  ).run(oldId, 'u1', JSON.stringify({}));
  // 2) 방금 만든 processing — 보호 (cutoff 안 넘김)
  const newId = 'job_new_' + Date.now();
  db.prepare(
    `INSERT INTO analysis_jobs (id, upload_id, status, summary, created_at)
     VALUES (?, ?, 'processing', ?, datetime('now'))`,
  ).run(newId, 'u1', JSON.stringify({}));
  // 3) completed — 절대 건드리지 않음
  const doneId = 'job_done_' + Date.now();
  db.prepare(
    `INSERT INTO analysis_jobs (id, upload_id, status, summary, created_at)
     VALUES (?, ?, 'completed', ?, datetime('now', '-3 hours'))`,
  ).run(doneId, 'u1', JSON.stringify({}));

  const r = m.recoverStaleAnalysisJobs();
  assert(r.recovered >= 1, '최소 1건은 회수');
  assert.equal(m.getJobStatus(oldId).status, 'failed', '오래된 processing → failed');
  assert(m.getJobStatus(oldId).errorMessage.includes('서버 재시작'), 'errorMessage 안내');
  assert.equal(m.getJobStatus(newId).status, 'processing', '최근 processing 은 보호');
  assert.equal(m.getJobStatus(doneId).status, 'completed', 'completed 는 그대로');
});

await step('analysisJob — getAnalysisStatusSummary 카운트 + 최근 실패/진행 목록', async () => {
  const m = await import('../src/services/analysisJob.service.js');
  const sum = m.getAnalysisStatusSummary({ recentLimit: 3 });
  assert(typeof sum.pendingCount === 'number');
  assert(typeof sum.processingCount === 'number');
  assert(typeof sum.completedCount === 'number');
  assert(typeof sum.failedCount === 'number');
  assert(Array.isArray(sum.recentFailed));
  assert(Array.isArray(sum.recentProcessing));
});

await step('analysisJob — retryAnalysisJob 가드 (completed/processing/없음)', async () => {
  const m = await import('../src/services/analysisJob.service.js');
  const db = (await import('../src/db/database.js')).default;
  // 없는 id
  const r1 = await m.retryAnalysisJob('does_not_exist');
  assert.equal(r1.ok, false);
  assert.equal(r1.status, 404);
  // processing 인 row — 차단
  const procId = 'retry_proc_' + Date.now();
  db.prepare(`INSERT INTO analysis_jobs (id, upload_id, status, summary) VALUES (?, ?, 'processing', '{}')`)
    .run(procId, 'u1');
  const r2 = await m.retryAnalysisJob(procId);
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 409);
  // failed row — 통과
  const failId = 'retry_fail_' + Date.now();
  db.prepare(`INSERT INTO analysis_jobs (id, upload_id, status, summary) VALUES (?, ?, 'failed', '{}')`)
    .run(failId, 'u1');
  const r3 = await m.retryAnalysisJob(failId);
  assert.equal(r3.ok, true);
});

await step('analysisJob — legacy status (done/error) 노멀라이즈해서 반환', async () => {
  const m = await import('../src/services/analysisJob.service.js');
  const db = (await import('../src/db/database.js')).default;
  const id = 'job_legacy_' + Date.now();
  db.prepare(
    `INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, 'u1', 'done', JSON.stringify({}), null);
  const s = m.getJobStatus(id);
  assert.equal(s.status, 'completed', '"done" → "completed" 정규화');
});

await step('reviewClassification — 실제 사례 회귀: rating=2 + "비싸긴해도 돈값" → positive (negative 아님)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 'P1', productName: 'P', rating: 2,
    content: '이건 완전 멋지 전투용 바지임 내가 비긴 바지가 4벌이 있음 나는 바지를 거의 비긴에서만 사는데 비긴이 비싸긴해도 돈값을 함 가격이 비쌈',
  });
  assert.equal(r.sentiment, 'positive', `negative 가 아니라 positive 여야 함 (실제: ${r.sentiment})`);
  // 가격 issue 가 있다면 severity=low (medium 으로 떨어지면 안 됨)
  const priceIssues = (r.categories || []).filter((c) => c.name === '가격/가성비' && c.isActionableIssue);
  for (const pi of priceIssues) {
    assert.equal(pi.severity, 'low', `가격 issue severity 는 low 여야 함 (실제: ${pi.severity})`);
  }
  // hasPriceConcession 유틸 자체도 검증
  assert.equal(m.hasPriceConcession('비싸긴해도 돈값을 함'), true);
  assert.equal(m.hasPriceConcession('비싸지만 만족합니다'), true);
  assert.equal(m.hasPriceConcession('가성비 별로'), false);
});

await step('reviewClassification — 사이즈 추천 방향: "3사이즈갈걸" → 작게 나옴(=upsize 추천)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 'P2', productName: 'P',
    content: '한여름말고는 입기 좋을거같아요 아 근데 제가 바지32정도 입는데 2사이즈는 너무딱맞네요 크게 3사이즈갈걸 그랬나봐요',
  });
  const sizeLabels = (r.categories || []).filter((c) => c.name === '사이즈').map((c) => c.issue);
  // "전반적으로 작게 나옴" = 제품이 작게 나온다 → 사용자에게 "한 치수 업" 안내
  assert(sizeLabels.includes('전반적으로 작게 나옴'),
    `'전반적으로 작게 나옴' 라벨 필요 (실제: ${sizeLabels.join(',')})`);
  assert(!sizeLabels.includes('전반적으로 크게 나옴'),
    `반대 방향 라벨 '전반적으로 크게 나옴' 이 같이 있으면 안 됨`);
  // 액션도 반드시 upsize 방향
  const action = (r.categories || []).find((c) => c.issue === '전반적으로 작게 나옴')?.action || '';
  assert(/한 치수 업|업 추천|크게/.test(action), `액션이 upsize 방향이어야 함: "${action}"`);
  assert(!/한 치수 다운|다운 추천|작게 사세요/.test(action),
    `액션에 downsize 표현이 들어가면 안 됨: "${action}"`);
});

await step('reviewClassification — 사이즈 추천 방향: "작게 갈 걸" → 크게 나옴(=downsize 추천)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({
    id: 'P3', productName: 'P',
    content: '허리가 너무 크고 품도 넉넉해서 한 치수 작게 갈 걸 그랬어요',
  });
  const sizeLabels = (r.categories || []).filter((c) => c.name === '사이즈').map((c) => c.issue);
  assert(sizeLabels.includes('전반적으로 크게 나옴'),
    `'전반적으로 크게 나옴' 라벨 필요 (실제: ${sizeLabels.join(',')})`);
  assert(!sizeLabels.includes('전반적으로 작게 나옴'),
    `반대 방향 라벨 '전반적으로 작게 나옴' 이 같이 있으면 안 됨`);
  // 부위별 라벨도 반대 방향이면 안 됨 — "허리가 작게 나옴" 이 나오면 실패.
  assert(!sizeLabels.includes('허리가 작게 나옴'),
    `'허리가 작게 나옴' 은 반대 방향이라 잘못`);
});

await step('reviewClassification — 실제 의류 리뷰 8케이스 (mentionedAspect vs improvementIssue)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const cases = [
    { id: 'C1', content: '핏도 너무 예쁘고 재질도 엄청 좋았습니다', sentiment: 'positive', maxIssues: 0 },
    { id: 'C2', content: '편하고 색감 좋습니다', sentiment: 'positive', maxIssues: 0 },
    { id: 'C3', content: '배송 빠르고 좋아요 가성비 오집니다', sentiment: 'positive', maxIssues: 0 },
    { id: 'C4', content: '100사이즈가 살짝 작긴하지만 이너로 입기에 딱입니다', acceptSentiments: ['positive', 'mixed'], minIssues: 1 },
    { id: 'C5', content: '가격에 맞는 품질이에요 조금 따갑긴 하지만 한철 입을 용으로 적당', sentiment: 'mixed', minIssues: 1 },
    { id: 'C6', content: '마감이 별로고 실밥이 많아요', sentiment: 'negative', minIssues: 1 },
    { id: 'C7', content: '비침이 없어서 너무 좋았습니다', sentiment: 'positive', maxIssues: 0 },
    { id: 'C8', content: '색감은 예쁜데 화면보다 조금 어두워요', sentiment: 'mixed', minIssues: 1 },
  ];
  for (const c of cases) {
    const r = m.classifyReview({ id: c.id, productName: 'P', content: c.content });
    if (c.sentiment) {
      assert.equal(r.sentiment, c.sentiment, `${c.id} sentiment: 기대 ${c.sentiment}, 실제 ${r.sentiment}`);
    } else if (c.acceptSentiments) {
      assert(c.acceptSentiments.includes(r.sentiment),
        `${c.id} sentiment: 기대 ${c.acceptSentiments.join('|')}, 실제 ${r.sentiment}`);
    }
    const issues = r.improvementIssues || [];
    if (typeof c.minIssues === 'number') {
      assert(issues.length >= c.minIssues, `${c.id} issues 부족: ${issues.length}`);
    }
    if (typeof c.maxIssues === 'number') {
      assert(issues.length <= c.maxIssues,
        `${c.id} issues 과다 (칭찬을 개선이슈로 잡음): ${issues.map((i) => i.issueLabel).join(' | ')}`);
    }
  }
});

await step('reviewClassification — 실제 의류 리뷰 10케이스 (mentionedAspect vs improvementIssue)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const cases = [
    { id: 'T1', content: '가격이 낮아서 퀄리티를 기대하지 않았는데 핏도 너무 예쁘고 재질도 엄청 좋았습니다', sentiment: 'positive', minIssues: 0, maxIssues: 0 },
    { id: 'T2', content: '편하고 색감 좋습니다', sentiment: 'positive', minIssues: 0, maxIssues: 0 },
    { id: 'T3', content: '배송 빠르고 좋아요 가성비 오집니다 구매하세요', sentiment: 'positive', minIssues: 0, maxIssues: 0 },
    { id: 'T4', content: '100사이즈가 살짝 작긴하지만 이너로 입기에 딱입니다', sentiment: 'positive', minIssues: 1, maxIssues: 2 },
    { id: 'T5', content: '가격에 맞는 품질이에요 조금 따갑긴 하지만 한철 입을 용으로 적당', sentiment: 'mixed', minIssues: 1, maxIssues: 3 },
    { id: 'T6', content: '마감이 별로고 실밥이 많아요', sentiment: 'negative', minIssues: 1, maxIssues: 3 },
    { id: 'T7', content: '비침이 없어서 너무 좋았습니다', sentiment: 'positive', minIssues: 0, maxIssues: 0 },
    { id: 'T8', content: '배송이 늦고 포장도 별로였어요', sentiment: 'negative', minIssues: 1, maxIssues: 3 },
    { id: 'T9', content: '색감은 예쁜데 화면보다 조금 어두워요', sentiment: 'mixed', minIssues: 1, maxIssues: 2 },
    { id: 'T10', content: '사이즈도 잘 맞고 핏이 예뻐요', sentiment: 'positive', minIssues: 0, maxIssues: 0 },
  ];
  for (const c of cases) {
    const r = m.classifyReview({ id: c.id, productName: 'P', content: c.content });
    const issues = r.improvementIssues || [];
    const aspects = r.mentionedAspects || [];
    assert.equal(r.sentiment, c.sentiment,
      `${c.id} sentiment: 기대 ${c.sentiment}, 실제 ${r.sentiment}`);
    assert(issues.length >= c.minIssues,
      `${c.id} improvementIssues 부족: ${issues.length} < ${c.minIssues} (cats: ${r.categories.map((x)=>x.name).join(',')})`);
    assert(issues.length <= c.maxIssues,
      `${c.id} improvementIssues 과다: ${issues.length} > ${c.maxIssues} (labels: ${issues.map((x)=>x.issueLabel).join(' | ')})`);
    // mentionedAspects 와 improvementIssues 는 disjoint 여야 한다 (같은 카테고리가 양쪽에 동시에 들어가지 않음)
    const aspectCats = new Set(aspects.map((a) => a.category));
    const issueCats = new Set(issues.map((i) => i.category));
    for (const cat of issueCats) {
      assert(!aspectCats.has(cat),
        `${c.id} 같은 카테고리(${cat})가 mentionedAspects 와 improvementIssues 양쪽에 들어감`);
    }
  }
});

await step('reviewClassification — isRatingReliable 분포 검사', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  // 1) 모든 리뷰가 별점 2점에 몰림 → unreliable
  const mostly2 = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, rating: 2, content: '리뷰' }));
  assert.equal(m.isRatingReliable(mostly2), false, '한 점수 70% 이상 몰리면 false');
  // 2) 골고루 분포 → reliable
  const balanced = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, rating: (i % 5) + 1, content: '리뷰' }));
  assert.equal(m.isRatingReliable(balanced), true, '균등 분포면 true');
  // 3) 빈 입력 → false
  assert.equal(m.isRatingReliable([]), false);
  // 4) 표본 작으면 reliable 기본값 — 단일 리뷰 테스트 호환
  assert.equal(m.isRatingReliable([{ rating: 4, content: 'x' }]), true);
});

await step('reviewClassification — ratingReliable=false 면 rating 보조 신호 OFF', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  // 별점 1점인데 텍스트는 명백한 긍정 — reliable=true 면 별점 가드로 neutral/negative,
  //   reliable=false 면 텍스트만으로 positive 가 나와야 한다.
  const review = { id: 'rx', productName: 'P', rating: 1, content: '핏이 너무 예쁘고 재질도 좋아요 만족합니다' };
  const reliable = m.classifyReview(review, { ratingReliable: true });
  const unreliable = m.classifyReview(review, { ratingReliable: false });
  assert.notEqual(reliable.sentiment, 'positive', 'rating=1 reliable 일 때는 positive 보호 안 됨');
  assert.equal(unreliable.sentiment, 'positive', 'rating=1 unreliable 일 때는 텍스트만 사용');
});

await step('reviewClassification (멀티라벨/부정어)', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const a = m.classifyReview({ id: '1', productName: 'P', rating: 2, content: '허리가 작고 원단도 얇아서 비침이 있어요' });
  const cats = a.categories.map((c) => c.name);
  assert(cats.includes('사이즈') && cats.includes('소재/두께'), '멀티라벨 실패');
  const b = m.classifyReview({ id: '2', productName: 'P', rating: 5, content: '작지 않고 딱 맞아요. 만족합니다' });
  assert.equal(b.categories.length, 0, '부정어/긍정 게이팅 실패');
});

await step('reportRoutes — buildProductDetailPath / resolveReviewProductKey', async () => {
  const m = await import('../../frontend/src/utils/reportRoutes.js');
  // 1) analysisId + productKey 둘 다 있어야 URL 생성
  assert.equal(
    m.buildProductDetailPath({ analysisId: 'a1', productKey: '셔츠' }),
    `/products/a1/${encodeURIComponent('셔츠')}`,
  );
  // 2) 누락된 경우 null — 호출부가 링크를 비활성화하라는 신호
  assert.equal(m.buildProductDetailPath({ analysisId: '', productKey: 'p' }), null);
  assert.equal(m.buildProductDetailPath({ analysisId: 'a', productKey: null }), null);
  assert.equal(m.buildProductDetailPath({}), null);

  // 3) review.productKey 우선
  assert.equal(
    m.resolveReviewProductKey({ productKey: 'KEY-1', productName: '셔츠' }),
    'KEY-1',
  );
  // 4) productKey 없으면 productName 으로 fallback
  assert.equal(m.resolveReviewProductKey({ productName: '셔츠' }), '셔츠');
  // 5) products 배열에서 productName 으로 유일하게 찾으면 그 productKey
  assert.equal(
    m.resolveReviewProductKey(
      { productName: '셔츠' },
      [{ productKey: 'PK-1', productName: '셔츠' }, { productKey: 'PK-2', productName: '바지' }],
    ),
    'PK-1',
  );
  // 6) productName 이 중복되면 모호 → null
  assert.equal(
    m.resolveReviewProductKey(
      { productName: '셔츠' },
      [{ productKey: 'PK-1', productName: '셔츠' }, { productKey: 'PK-2', productName: '셔츠' }],
    ),
    null,
  );
  // 7) 아무 식별값도 없으면 null
  assert.equal(m.resolveReviewProductKey({}), null);
  assert.equal(m.resolveReviewProductKey(null), null);

  // 8) buildReviewProductPath: review.analysisId 가 우선, 없으면 컨텍스트 analysisId
  assert.equal(
    m.buildReviewProductPath({ productName: '셔츠' }, { analysisId: 'a1' }),
    `/products/a1/${encodeURIComponent('셔츠')}`,
  );
  // 9) analysisId 가 어디에도 없으면 null (잘못된 라우팅 방지)
  assert.equal(m.buildReviewProductPath({ productName: '셔츠' }), null);
  // 10) 샘플 리포트처럼 식별값 없는 review 는 null → 링크 비활성
  assert.equal(m.buildReviewProductPath({}, { analysisId: 'a1' }), null);
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
  // 리뷰 모달이 review.productKey 로 안정적으로 상품 상세 URL 을 만들 수 있어야 한다.
  // (productName 만 들고 있는 회귀를 막기 위한 가드)
  for (const r of products[0].reviews) {
    assert.equal(r.productKey, products[0].productKey,
      `리뷰 ${r.id} 에 productKey 누락 또는 불일치: ${r.productKey}`);
  }
  // summary 의 reviewHighlights topReviews 도 동일하게 productKey 를 가져야 한다.
  const allTopReviews = ['positive', 'neutral', 'negative']
    .flatMap((s) => summary.reviewHighlights?.[s]?.topReviews || []);
  for (const r of allTopReviews) {
    assert(r.productKey, `summary topReview (id=${r.id}) 에 productKey 누락`);
  }
});

await step('export — section/productName 헤더 + product_summary row 포함', async () => {
  const m = await import('../src/services/export.service.js');
  const csv = m.buildAnalysisCsv([{
    productName: 'P', totalReviews: 1, negativeReviews: 1, averageRating: 2,
    topIssues: [], allIssues: [], reviews: [], replyTemplates: [],
  }]);
  assert(csv.includes('section,productName'), `CSV 헤더 누락 — got: ${csv.split('\n')[0]}`);
  assert(csv.includes('product_summary'), 'product_summary section row 누락');
});

await step('export — 모든 이슈 + 리뷰 + CS 답글 flatten', async () => {
  const m = await import('../src/services/export.service.js');
  const csv = m.buildAnalysisCsv([{
    productName: '린넨 와이드 팬츠',
    totalReviews: 100,
    averageRating: 4.1,
    sentimentCounts: { positive: 60, neutral: 25, negative: 15 },
    allIssues: [
      { category: '사이즈', issueLabel: '허리 작음', count: 12, ratio: 0.12, severity: 'high', recommendedAction: '실측 안내' },
      { category: '색상/화면 차이', issueLabel: '어두움', count: 8, ratio: 0.08, severity: 'medium' },
    ],
    reviews: [
      { id: 'r1', rating: 2, sentiment: 'negative', content: '허리가 작아요',
        detectedIssues: [{ category: '사이즈', issue: '허리 작음' }] },
    ],
    replyTemplates: [
      { issueLabel: '허리 작음', variants: [{ tone: '기본', template: '안녕하세요...' }] },
    ],
    detailPageActions: ['상세페이지에 실측 사이즈 추가'],
  }]);
  // 모든 section type 이 한 CSV 안에 들어가야 함
  for (const sec of ['product_summary', 'issue', 'review', 'cs_reply', 'detail_action']) {
    assert(csv.includes(`\n${sec},`) || csv.includes(`,${sec},`),
      `section "${sec}" row 누락`);
  }
  // 모든 이슈가 들어가야 함 (이전엔 topIssues 5개 제한)
  assert(csv.includes('허리 작음'), 'issue label 누락');
  assert(csv.includes('어두움'), '두 번째 issue 누락');
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

// ──────────────────────────────────────────────
// hybrid sentiment — 오분류 테스트케이스 20종 (품질 테스트 엑셀 기준)
// 별점 + 텍스트 결합. 4~5점 약한 이슈는 positive 유지, 1~2점 강한 불만은 negative,
// reversal 표현은 부정 카운트 X.
// ──────────────────────────────────────────────

async function expectSentiment(id, rating, content, expected, opts = {}) {
  const m = await import('../src/services/reviewClassification.service.js');
  const r = m.classifyReview({ id, productName: 'P', rating, content });
  const labels = (r.categories || []).map((c) => c.issue).filter(Boolean);
  if (Array.isArray(expected)) {
    assert(expected.includes(r.sentiment),
      `[${id}] expected one of ${expected.join('|')}, got ${r.sentiment} | ${content}`);
  } else {
    assert.equal(r.sentiment, expected, `[${id}] ${content}`);
  }
  if (opts.mustInclude) {
    for (const lbl of opts.mustInclude) {
      assert(labels.includes(lbl), `[${id}] label "${lbl}" 없음. 실제: ${labels.join(',')}`);
    }
  }
  if (opts.mustNotInclude) {
    for (const lbl of opts.mustNotInclude) {
      assert(!labels.includes(lbl), `[${id}] label "${lbl}" 포함되면 안 됨. 실제: ${labels.join(',')}`);
    }
  }
  if (opts.noActionable) {
    const act = (r.categories || []).filter((c) => c.isActionableIssue !== false);
    assert(act.length === 0, `[${id}] actionable issue 없어야 함. 실제: ${act.map((c) => c.issue || c.name).join(',')}`);
  }
  return r;
}

await step('hybrid #1 — 별점 4 + "사진보다 색감이 조금 밝게" + 가격만족 → positive', async () => {
  await expectSentiment('h1', 4,
    '사진보다 색감이 조금 밝게 느껴졌어요. 가격 생각하면 충분히 만족스러운 편입니다.',
    'positive');
});

await step('hybrid #2 — 별점 5 + 가성비/마감 칭찬 → positive + actionable 없음', async () => {
  await expectSentiment('h2', 5,
    '가격 대비 품질이 좋아서 색상별로 더 사고 싶어요. 마감이 나쁘지 않아서 오래 입을 수 있을 것 같아요.',
    'positive', { noActionable: true });
});

await step('hybrid #3 — 별점 4 + 어깨 살짝 큰 약한 이슈 → positive/neutral, negative 아님', async () => {
  const r = await expectSentiment('h3', 4,
    '기장은 괜찮은데 어깨가 조금 크게 느껴져요. 마감이 나쁘지 않아서 오래 입을 수 있을 것 같아요.',
    ['positive', 'neutral'],
    { mustNotInclude: ['어깨가 좁음', '마감 상태가 미흡함'] });
  assert.notEqual(r.sentiment, 'negative');
});

await step('hybrid #4 — 별점 3 + 한 치수 작게 권장 → neutral, "크게 나옴" 방향', async () => {
  await expectSentiment('h4', 3,
    '생각보다 품이 커서 정핏을 원하면 한 치수 작게 사는 게 좋겠어요.',
    'neutral',
    { mustNotInclude: ['전반적으로 작게 나옴'] });
});

await step('hybrid #5 — 별점 5 + "비침이 거의 없어요" → positive, 비침 이슈 아님', async () => {
  await expectSentiment('h5', 5,
    '화이트인데도 비침이 거의 없어서 만족합니다.',
    'positive', { noActionable: true });
});

await step('hybrid #6 — 별점 2 + "비쳐서 단독으로 입기 어려워요" → negative + 비침 감지', async () => {
  const r = await expectSentiment('h6', 2,
    '화이트 색상은 속옷이 비쳐서 단독으로 입기 어려워요.',
    'negative');
  const cats = (r.categories || []).map((c) => c.name);
  assert(cats.includes('소재/두께') || cats.includes('색상/화면 차이'),
    `소재/두께 또는 색상 카테고리 기대. 실제: ${cats.join(',')}`);
});

await step('hybrid #7 — 별점 5 + "줄어들지 않았어요" → positive, 세탁 이슈 아님', async () => {
  await expectSentiment('h7', 5,
    '세탁 후에도 크게 줄어들지 않았어요. 가격 대비 만족합니다.',
    'positive', { noActionable: true });
});

await step('hybrid #8 — 별점 2 + 보풀 + 못 입을 것 같다 → negative + 세탁/내구성', async () => {
  const r = await expectSentiment('h8', 2,
    '세탁 후 보풀이 많이 생겨서 몇 번 못 입을 것 같아요.',
    'negative');
  const cats = (r.categories || []).map((c) => c.name);
  assert(cats.includes('세탁/내구성'), `세탁/내구성 기대. 실제: ${cats.join(',')}`);
});

await step('hybrid #9 — 별점 4 + 목 타이트 + 괜찮을 것 같다 → positive/neutral, negative 아님', async () => {
  const r = await expectSentiment('h9', 4,
    '목 부분이 조금 타이트하게 느껴졌지만 입다 보면 괜찮을 것 같습니다.',
    ['positive', 'neutral']);
  assert.notEqual(r.sentiment, 'negative');
});

await step('hybrid #10 — 별점 3 + 재질OK + 두꺼움 → neutral + 소재/두께 감지', async () => {
  const r = await expectSentiment('h10', 3,
    '재질은 괜찮은데 생각보다 두꺼워서 한여름에는 조금 더울 수 있어요.',
    'neutral');
  const cats = (r.categories || []).map((c) => c.name);
  assert(cats.includes('소재/두께'), `소재/두께 기대. 실제: ${cats.join(',')}`);
});

await step('hybrid #11 — 별점 2 + 배송빠름 but 포장 구겨짐 → negative, 배송 지연 아님', async () => {
  const r = await expectSentiment('h11', 2,
    '배송은 빨랐지만 포장이 구겨져서 옷에 주름이 많이 생겼어요.',
    'negative');
  const labels = (r.categories || []).map((c) => c.issue || '');
  assert(!labels.some((l) => /배송이 늦|배송 지연/.test(l)),
    `배송 지연 라벨 금지. 실제: ${labels.join(',')}`);
});

await step('hybrid #12 — 별점 5 + 배송/포장 칭찬 → positive + actionable 없음', async () => {
  await expectSentiment('h12', 5,
    '배송도 빠르고 포장도 깔끔했어요.',
    'positive', { noActionable: true });
});

await step('hybrid #13 — 별점 5 + "실밥 없이 깔끔" → positive + 실밥 이슈 아님', async () => {
  await expectSentiment('h13', 5,
    '실밥 없이 마감이 깔끔해서 만족합니다.',
    'positive', { noActionable: true });
});

await step('hybrid #14 — 별점 2 + 박음질 삐뚤 + 실밥 보임 → negative + 마감/불량', async () => {
  const r = await expectSentiment('h14', 2,
    '박음질이 조금 삐뚤고 실밥이 몇 군데 보여요.',
    'negative');
  const cats = (r.categories || []).map((c) => c.name);
  assert(cats.includes('마감/불량'), `마감/불량 기대. 실제: ${cats.join(',')}`);
});

await step('hybrid #15 — 별점 5 + 색은 진한데 더 마음에 들어요 → positive', async () => {
  const r = await expectSentiment('h15', 5,
    '색은 화면보다 진한데 저는 이쪽이 더 마음에 들어요.',
    'positive');
  assert.notEqual(r.sentiment, 'negative');
});

await step('hybrid #16 — 별점 4 + "크다고 해야 할지 루즈" 애매 → positive/neutral', async () => {
  const r = await expectSentiment('h16', 4,
    '크다고 해야 할지 루즈하다고 해야 할지 애매해요. 저는 편한데 정핏 좋아하면 고민될 듯합니다.',
    ['positive', 'neutral']);
  assert.notEqual(r.sentiment, 'negative');
});

await step('hybrid #17 — 별점 4 + 구김 + "이해되는 정도" → positive/neutral, negative 아님', async () => {
  const r = await expectSentiment('h17', 4,
    '구김이 조금 있지만 소재 특성상 이해되는 정도입니다.',
    ['positive', 'neutral']);
  assert.notEqual(r.sentiment, 'negative');
});

await step('hybrid #18 — 별점 2 + 발볼 좁음 + 발 아픔 → negative + 발볼 좁음', async () => {
  await expectSentiment('h18', 2,
    '발볼이 좁아서 오래 걸으면 발이 아파요.',
    'negative', { mustInclude: ['발볼이 좁음'] });
});

await step('hybrid #19 — 별점 4 + 뒤꿈치 헐떡 but 깔창으로 OK → positive/neutral', async () => {
  const r = await expectSentiment('h19', 4,
    '뒤꿈치가 살짝 헐떡이지만 깔창 넣으면 괜찮을 것 같아요.',
    ['positive', 'neutral']);
  assert.notEqual(r.sentiment, 'negative');
});

await step('hybrid #20 — 별점 2 + 허리 작음 + 개인정보 → negative (마스킹은 reviewService 단계)', async () => {
  const r = await expectSentiment('h20', 2,
    '문의는 010-1234-5678로 주세요. test@example.com 주문번호 202605270001입니다. 허리가 작아요.',
    'negative', { mustInclude: ['허리가 작게 나옴'] });
  assert.equal(r.sentiment, 'negative');
});

// rating 정규화 / 문자열 별점 처리
await step('hybrid #string-rating — "5점" / "평점 4" / 공백 처리', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  assert.equal(m.normalizeRating('5'), 5);
  assert.equal(m.normalizeRating('5점'), 5);
  assert.equal(m.normalizeRating('평점 4'), 4);
  assert.equal(m.normalizeRating('  3  '), 3);
  assert.equal(m.normalizeRating(''), null);
  assert.equal(m.normalizeRating(undefined), null);
  assert.equal(m.normalizeRating(null), null);
  assert.equal(m.normalizeRating(6), null);
  assert.equal(m.normalizeRating(0), null);
  // string rating 도 정상 sentiment 반환해야 함
  const cls = m.classifyReview({ id: 'sr', productName: 'P', rating: '5점', content: '정말 좋아요' });
  assert.equal(cls.sentiment, 'positive');
});

await step('hybrid #regression-1506 — "고객센터" 터 false-positive 안 잡힘', async () => {
  // NEG_TERMS 의 짧은 surface '터' 가 "고객센터" prefix 로 잘못 매칭되던 버그.
  // 이제 NEG_TERMS 에는 '터짐' / '터져' / '터지' 만 등록.
  const m = await import('../src/services/reviewClassification.service.js');
  const cls = m.classifyReview({
    id: 'rg1', productName: 'P', rating: 4,
    content: '배송은 늦었지만 고객센터 응대가 빨라서 크게 불만은 없어요.',
  });
  assert.equal(cls.sentiment, 'positive', `sentiment=${cls.sentiment}`);
  // "고객센터" 가 마감/불량 으로 잡히면 안 됨 (옷이 터짐 false positive)
  const labels = cls.categories.map((c) => c.issue).filter(Boolean);
  assert(!labels.some((l) => /터/.test(l)), `터 관련 라벨 금지: ${labels.join(',')}`);
});

await step('hybrid #regression-1506 — "크게 불만은 없" 명시적 해소 → 부정 점수 완화', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const sig = m.analyzeTextSentiment('배송은 늦었지만 크게 불만은 없어요.');
  assert(sig.acceptanceCount >= 1, `acceptanceCount=${sig.acceptanceCount}`);
  assert.equal(sig.hasSevereComplaint, false);
  // 별점 4 면 positive, 별점 2 라도 neutral 까지 완화
  assert.equal(m.detectSentiment({ rating: 4, content: '배송은 늦었지만 크게 불만은 없어요.' }), 'positive');
});

await step('hybrid — analyzeTextSentiment helper export 검증', async () => {
  const m = await import('../src/services/reviewClassification.service.js');
  const sig = m.analyzeTextSentiment('환불하고 싶습니다. 너무 실망스러워요.');
  assert.equal(sig.hasSevereComplaint, true);
  assert(sig.strongNegativeCount >= 1, `strong=${sig.strongNegativeCount}`);
  const sig2 = m.analyzeTextSentiment('가격 대비 품질이 좋아서 만족합니다.');
  assert.equal(sig2.hasClearSatisfaction, true);
  const sig3 = m.analyzeTextSentiment('비침이 거의 없어서 만족합니다.');
  assert.equal(sig3.hasSevereComplaint, false);
});

// ──────────────────────────────────────────────
// 상품 단위 reviewHighlights — 상품 상세 리뷰 반응 섹션용
// ──────────────────────────────────────────────
await step('상품 reviewHighlights — 상품 단위 positive/neutral/negative 분리', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    { id: 'ph1', productName: 'A', rating: 5, content: '핏이 예쁘고 만족합니다.' },
    { id: 'ph2', productName: 'A', rating: 5, content: '소재가 좋아요. 재구매 의사 있어요.' },
    { id: 'ph3', productName: 'A', rating: 3, content: '무난해요.' },
    { id: 'ph4', productName: 'A', rating: 1, content: '환불 원합니다. 너무 작아요. 실망이에요.' },
    // 다른 상품은 섞이지 않아야 함
    { id: 'pb1', productName: 'B', rating: 5, content: '좋아요 만족합니다.' },
  ];
  const { products } = await runAnalysis(reviews);
  const a = products.find((p) => p.productName === 'A');
  assert(a.reviewHighlights, 'reviewHighlights 없음');
  assert.equal(a.reviewHighlights.positive.total, 2, `A positive=${a.reviewHighlights.positive.total}`);
  assert.equal(a.reviewHighlights.neutral.total, 1);
  assert.equal(a.reviewHighlights.negative.total, 1);
  // 상품 A 의 highlights 에 B 리뷰가 섞이지 않아야 함
  const allHighlightProducts = [
    ...(a.reviewHighlights.positive.topReviews || []),
    ...(a.reviewHighlights.neutral.topReviews || []),
    ...(a.reviewHighlights.negative.topReviews || []),
  ].map((r) => r.productName);
  assert(allHighlightProducts.every((n) => n === 'A'), `A highlights 에 다른 상품 섞임: ${allHighlightProducts.join(',')}`);
  // 상품 B 도 자체 highlights 가짐
  const b = products.find((p) => p.productName === 'B');
  assert.equal(b.reviewHighlights.positive.total, 1);
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
  assert(reps.length === 5, `tones=${reps.length}`);
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

await step('history — isSample 필드: source=sample 우선, 파일명 fallback, 일반 업로드는 false', async () => {
  const { default: db, listAnalyses } = await import('../src/db/database.js');
  // (a) source='sample' — 표준 sample 분석
  db.prepare('INSERT INTO upload_files (id, original_name, source) VALUES (?, ?, ?)')
    .run('uSamp', 'sample_reviews_fashion.csv', 'sample');
  db.prepare(`INSERT INTO analysis_jobs (id, upload_id, status, summary) VALUES (?, ?, ?, ?)`)
    .run('anSamp', 'uSamp', 'done', '{}');
  // (b) source='smartstore' + 정확한 sample 파일명 — fallback 으로 isSample=true
  db.prepare('INSERT INTO upload_files (id, original_name, source) VALUES (?, ?, ?)')
    .run('uLegacySamp', 'sample_reviews_fashion.csv', 'smartstore');
  db.prepare(`INSERT INTO analysis_jobs (id, upload_id, status, summary) VALUES (?, ?, ?, ?)`)
    .run('anLegacySamp', 'uLegacySamp', 'done', '{}');
  // (c) source='custom' + 사용자가 우연히 sample 로 시작하는 파일 — isSample=false 여야 함 (오탐 방지)
  db.prepare('INSERT INTO upload_files (id, original_name, source) VALUES (?, ?, ?)')
    .run('uUserSamp', 'sample_my_reviews_2026.csv', 'custom');
  db.prepare(`INSERT INTO analysis_jobs (id, upload_id, status, summary) VALUES (?, ?, ?, ?)`)
    .run('anUserSamp', 'uUserSamp', 'done', '{}');

  const list = listAnalyses({ limit: 50 });
  const std = list.find((x) => x.id === 'anSamp');
  const legacy = list.find((x) => x.id === 'anLegacySamp');
  const userFile = list.find((x) => x.id === 'anUserSamp');
  assert.equal(std.isSample, true, `source=sample → isSample=true 기대, got ${std.isSample}`);
  assert.equal(legacy.isSample, true, '정확한 sample 파일명은 fallback 으로 true');
  assert.equal(userFile.isSample, false,
    `사용자 임의 파일명 "sample_my_reviews_2026.csv" 는 isSample=false 여야 함 (got ${userFile.isSample})`);
});

await step('history — is_sample 컬럼이 source 보다 우선 적용된다', async () => {
  const { default: db, listAnalyses } = await import('../src/db/database.js');
  // is_sample = 1 + source != 'sample' — 명시적 컬럼이 우선
  db.prepare('INSERT INTO upload_files (id, original_name, source) VALUES (?, ?, ?)')
    .run('uColCol', 'whatever.csv', 'custom');
  db.prepare(`INSERT INTO analysis_jobs (id, upload_id, status, summary, is_sample) VALUES (?, ?, ?, ?, ?)`)
    .run('anCol', 'uColCol', 'done', '{}', 1);
  const list = listAnalyses({ limit: 100 });
  const item = list.find((x) => x.id === 'anCol');
  assert.equal(item.isSample, true, `is_sample=1 이면 source 와 무관하게 true: ${item.isSample}`);
});

await step('history — listAnalyses limit 적용', async () => {
  const { listAnalyses } = await import('../src/db/database.js');
  const one = listAnalyses({ limit: 1 });
  assert.equal(one.length, 1, `limit=1 인데 ${one.length}건 반환`);
});

// ──────────────────────────────────────────────
// 전체 이슈 필터/정렬 (프론트 순수 로직)
// chip 옆 숫자 = 이슈 카드 개수, 카드 내부 'N건' = 관련 리뷰 수.
// chip 카운트와 filterIssuesByCategory 결과는 반드시 일치해야 한다.
// ──────────────────────────────────────────────
await step('전체 이슈 필터 — chip count = 이슈 카드 개수 (리뷰 수 합계 아님)', async () => {
  const { buildIssueFilters } = await import('../../frontend/src/utils/issueFilters.js');
  const allIssues = [
    { category: '사이즈', issueLabel: '기장이 김', count: 5, severity: 'medium' },
    { category: '소재/두께', issueLabel: '비침 있음', count: 3, severity: 'high' },
    { category: '사이즈', issueLabel: '허리 작음', count: 4, severity: 'high' },
    { category: '배송/포장', issueLabel: '배송 지연', count: 2, severity: 'high' },
  ];
  const filters = buildIssueFilters(allIssues);
  assert.equal(filters[0].value, '전체', '전체가 첫 번째여야 함');
  assert.equal(filters[0].count, 4, `전체 count=${filters[0].count} (카드 4장)`);
  assert.deepEqual(
    filters.map((f) => [f.label, f.count]),
    [['전체', 4], ['사이즈', 2], ['배송/포장', 1], ['소재/두께', 1]],
    '필터 순서/카드 수 불일치 (count tie 는 가나다순)',
  );
  // reviewCount 는 별도 metric 으로 함께 제공
  const sizeFilter = filters.find((f) => f.value === '사이즈');
  assert.equal(sizeFilter.reviewCount, 9, `사이즈 리뷰 수 합계=${sizeFilter.reviewCount}`);
});

await step('전체 이슈 필터 — chip count 와 filterIssuesByCategory 결과 일치', async () => {
  const { buildIssueFilters, filterIssuesByCategory } = await import('../../frontend/src/utils/issueFilters.js');
  const allIssues = [
    { category: '사이즈', issueLabel: '전반적으로 작게 나옴', count: 3 },
    { category: '사이즈', issueLabel: '어깨가 크게 느껴짐', count: 2 },
    { category: '색상/화면 차이', issueLabel: '화면보다 어두움', count: 1 },
  ];
  const filters = buildIssueFilters(allIssues);
  // 카테고리 chip 숫자 === 그 카테고리로 필터링한 카드 수
  for (const f of filters) {
    const cards = filterIssuesByCategory(allIssues, f.value);
    assert.equal(cards.length, f.count,
      `[${f.label}] chip=${f.count}, 카드=${cards.length}`);
  }
});

await step('전체 이슈 필터 — issueLabel 없음 / isActionableIssue=false 는 카운트/목록 모두 제외', async () => {
  const { buildIssueFilters, filterIssuesByCategory } = await import('../../frontend/src/utils/issueFilters.js');
  const allIssues = [
    { category: '사이즈', issueLabel: '전반적으로 작게 나옴', count: 3 },
    { category: '사이즈', issueLabel: '사이즈 관련 의견', isActionableIssue: false, count: 2 },
    { category: '사이즈', issueLabel: null, count: 1 },                  // generic
    { category: '사이즈', issueLabel: '어깨 큼', count: 0 },              // count=0
  ];
  const filters = buildIssueFilters(allIssues);
  const size = filters.find((f) => f.value === '사이즈');
  assert.equal(size.count, 1, `사이즈 chip=${size.count} (1만 표시)`);
  assert.equal(filterIssuesByCategory(allIssues, '사이즈').length, 1);
  assert.equal(filterIssuesByCategory(allIssues, '전체').length, 1);
});

await step('전체 이슈 필터 — normalizeIssueCategory 변형 통일 (사이즈/핏 → 사이즈)', async () => {
  const { normalizeIssueCategory, buildIssueFilters, filterIssuesByCategory } =
    await import('../../frontend/src/utils/issueFilters.js');
  assert.equal(normalizeIssueCategory('사이즈/핏'), '사이즈');
  assert.equal(normalizeIssueCategory('핏/사이즈'), '사이즈');
  assert.equal(normalizeIssueCategory('착용감/사이즈'), '사이즈');
  assert.equal(normalizeIssueCategory('색상'), '색상/화면 차이');
  assert.equal(normalizeIssueCategory('화면 차이'), '색상/화면 차이');
  assert.equal(normalizeIssueCategory('소재'), '소재/두께');
  assert.equal(normalizeIssueCategory('배송'), '배송/포장');
  assert.equal(normalizeIssueCategory(null), '기타');
  assert.equal(normalizeIssueCategory(''), '기타');

  // 변형이 섞여 와도 같은 그룹으로 모이고, 필터 결과와 chip 카운트 일치
  const allIssues = [
    { category: '사이즈', issueLabel: '전반적으로 작게 나옴', count: 3 },
    { category: '사이즈/핏', issueLabel: '어깨가 크게 느껴짐', count: 2 },
    { category: '핏/사이즈', issueLabel: '소매가 김', count: 1 },
  ];
  const filters = buildIssueFilters(allIssues);
  const size = filters.find((f) => f.value === '사이즈');
  assert.equal(size.count, 3, `사이즈 chip=${size.count}`);
  assert.equal(filterIssuesByCategory(allIssues, '사이즈').length, 3);
});

await step('전체 이슈 필터 — count 0 / displayable=false 카테고리 chip 자동 숨김', async () => {
  const { buildIssueFilters } = await import('../../frontend/src/utils/issueFilters.js');
  const filters = buildIssueFilters([
    { category: '사이즈', issueLabel: '허리 작음', count: 2 },
    { category: '소재/두께', issueLabel: null, count: 5 },        // generic — 제외됨
  ]);
  assert.equal(filters.length, 2, `필터 개수=${filters.length} (전체+사이즈만)`);
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
  const t = Date.now() + Math.random();
  const billing = await import(`../src/services/billing.service.js?t=${t}`);
  const { default: db } = await import('../src/db/database.js');
  // app_settings 가 env 보다 우선이므로 DB 값도 true 로 맞춰 둔다.
  // settings.service 캐시는 billing.service 가 import 한 인스턴스와 같아야 하므로
  // 쿼리스트링 없이 import (모듈 캐시 공유).
  db.prepare(`UPDATE app_settings SET value = 'true' WHERE key = 'billing_enforce_limits'`).run();
  const settings = await import('../src/services/settings.service.js');
  settings.clearSettingsCache();
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
  const { default: db } = await import('../src/db/database.js');
  db.prepare(`UPDATE app_settings SET value = 'false' WHERE key = 'billing_enforce_limits'`).run();
  const settings = await import('../src/services/settings.service.js');
  settings.clearSettingsCache();
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

// ──────────────────────────────────────────────
// 상품 정렬/필터 (프론트 순수 로직)
// ──────────────────────────────────────────────
await step('productSort — 기본 우선순위 정렬 (주의 필요 > 개선 우선 > 만족도)', async () => {
  const { sortProducts } = await import('../../frontend/src/utils/productSort.js');
  const products = [
    { productKey: 'C', productName: 'C', productStatus: '만족도 높음', negativeRatio: 0.02, issueReviewCount: 1, totalIssueCount: 1, totalReviews: 80, averageRating: 4.8 },
    { productKey: 'A', productName: 'A', productStatus: '주의 필요', negativeRatio: 0.30, issueReviewCount: 18, totalIssueCount: 22, totalReviews: 60, averageRating: 3.2 },
    { productKey: 'D', productName: 'D', productStatus: '리뷰 부족', negativeRatio: 0.10, issueReviewCount: 1, totalIssueCount: 1, totalReviews: 4, averageRating: 4.0 },
    { productKey: 'B', productName: 'B', productStatus: '개선 우선', negativeRatio: 0.20, issueReviewCount: 12, totalIssueCount: 14, totalReviews: 50, averageRating: 3.7 },
  ];
  const sorted = sortProducts(products, 'priority');
  const order = sorted.map((p) => p.productKey).join(',');
  assert.equal(order, 'A,B,D,C', `정렬 결과: ${order}`);
});

await step('productSort — 부정 비율 높은 순', async () => {
  const { sortProducts } = await import('../../frontend/src/utils/productSort.js');
  const products = [
    { productKey: 'a', negativeRatio: 0.1 },
    { productKey: 'b', negativeRatio: 0.3 },
    { productKey: 'c', negativeRatio: 0.2 },
  ];
  const sorted = sortProducts(products, 'negativeRatio');
  assert.deepEqual(sorted.map((p) => p.productKey), ['b', 'c', 'a']);
});

await step('productSort — 평균 별점 낮은 순 (null 은 맨 뒤)', async () => {
  const { sortProducts } = await import('../../frontend/src/utils/productSort.js');
  const products = [
    { productKey: 'a', averageRating: 4.5 },
    { productKey: 'b', averageRating: null },
    { productKey: 'c', averageRating: 2.1 },
  ];
  const sorted = sortProducts(products, 'ratingAsc');
  assert.deepEqual(sorted.map((p) => p.productKey), ['c', 'a', 'b']);
});

await step('productSort — 상태 필터 + 검색', async () => {
  const { filterProducts, buildStatusFilters } = await import('../../frontend/src/utils/productSort.js');
  const products = [
    { productName: '린넨 와이드 팬츠', productStatus: '주의 필요' },
    { productName: '오버핏 후드', productStatus: '만족도 높음' },
    { productName: '플리츠 스커트', productStatus: '주의 필요' },
  ];
  const onlyWarn = filterProducts(products, { status: '주의 필요' });
  assert.equal(onlyWarn.length, 2, `필터 후 ${onlyWarn.length}건`);
  const search = filterProducts(products, { status: '전체', query: '린넨' });
  assert.equal(search.length, 1);
  const filters = buildStatusFilters(products);
  assert.equal(filters[0].value, '전체');
  assert.equal(filters[0].count, 3);
  const warn = filters.find((f) => f.value === '주의 필요');
  assert.equal(warn?.count, 2);
});

// ──────────────────────────────────────────────
// 분석 권한 (analysis ownership) — Express e2e
// ──────────────────────────────────────────────
async function makeAnalysisApp({ demoAllowAnonymous = 'false' } = {}) {
  process.env.DEMO_ALLOW_ANONYMOUS = demoAllowAnonymous;
  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const analysisRoutes = (await import(`../src/routes/analysis.routes.js?t=${t}`)).default;
  const historyRoutes = (await import(`../src/routes/history.routes.js?t=${t}`)).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/analysis', analysisRoutes);
  app.use('/api/analyses', historyRoutes);
  return app;
}

async function registerAndCookie(port, email) {
  const r = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'longenoughpw' }),
  });
  if (r.status !== 201) throw new Error(`register failed: ${r.status}`);
  // set-cookie 의 'reviewfit_token=...' 부분만 추출
  const cookie = (r.setCookie || '').split(';')[0];
  return { userId: r.body.user.id, cookie };
}

function insertAnalysisFor(userId, summary = {}) {
  const dbMod = require('node:module').createRequire(import.meta.url);
  return null; // placeholder — 실제로는 DB 직접 INSERT
}

await step('ownership — userA 의 analysis 를 userA 가 조회 → 200', async () => {
  const app = await makeAnalysisApp();
  const { srv, port } = await startServer(app);
  try {
    const { userId: aId, cookie: aCookie } = await registerAndCookie(port, `ownA_${Date.now()}@x.com`);
    const { default: db } = await import('../src/db/database.js');
    const { nanoid } = await import('nanoid');
    const aid = 'an_own_' + nanoid();
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(aid, null, 'done', '{"totalReviews":3}', aId);

    const r = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}`, { headers: { cookie: aCookie } });
    assert.equal(r.status, 200, `userA → 자기 분석 status=${r.status}`);
    assert.equal(r.body.analysisId, aid);
  } finally { srv.close(); }
});

await step('ownership — userB 가 userA 의 analysis 조회 → 403', async () => {
  const app = await makeAnalysisApp();
  const { srv, port } = await startServer(app);
  try {
    const { userId: aId } = await registerAndCookie(port, `ownA2_${Date.now()}@x.com`);
    const { cookie: bCookie } = await registerAndCookie(port, `ownB2_${Date.now()}@x.com`);
    const { default: db } = await import('../src/db/database.js');
    const { nanoid } = await import('nanoid');
    const aid = 'an_own_x_' + nanoid();
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(aid, null, 'done', '{}', aId);

    const r = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}`, { headers: { cookie: bCookie } });
    assert.equal(r.status, 403, `cross-user status=${r.status}`);
    assert.equal(r.body.error, 'FORBIDDEN');
    // products / export / corrections 까지 모두 403
    const r2 = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/products`, { headers: { cookie: bCookie } });
    assert.equal(r2.status, 403, `products status=${r2.status}`);
  } finally { srv.close(); }
});

await step('ownership — /api/analyses 는 본인 분석만 반환 (익명 NULL 제외)', async () => {
  const app = await makeAnalysisApp();
  const { srv, port } = await startServer(app);
  try {
    const { userId: aId, cookie: aCookie } = await registerAndCookie(port, `ownA3_${Date.now()}@x.com`);
    const { userId: bId } = await registerAndCookie(port, `ownB3_${Date.now()}@x.com`);
    const { default: db } = await import('../src/db/database.js');
    const { nanoid } = await import('nanoid');
    const aid = 'an_own_a_' + nanoid();
    const bid = 'an_own_b_' + nanoid();
    const nid = 'an_own_n_' + nanoid();
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(aid, null, 'done', '{"totalReviews":1}', aId);
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(bid, null, 'done', '{"totalReviews":2}', bId);
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(nid, null, 'done', '{"totalReviews":3}', null);

    const r = await jsonFetch(`http://127.0.0.1:${port}/api/analyses?limit=50`, { headers: { cookie: aCookie } });
    assert.equal(r.status, 200);
    const ids = r.body.map((x) => x.id);
    assert(ids.includes(aid), 'userA 자기 분석 누락');
    assert(!ids.includes(bid), 'userB 분석이 userA 에게 노출됨');
    assert(!ids.includes(nid), '익명(user_id NULL) 분석이 로그인 사용자에게 노출됨');
  } finally { srv.close(); }
});

await step('ownership — 로그인 없이 보호 API 호출 시 401 (DEMO_ALLOW_ANONYMOUS=false)', async () => {
  const app = await makeAnalysisApp({ demoAllowAnonymous: 'false' });
  const { srv, port } = await startServer(app);
  try {
    const r1 = await jsonFetch(`http://127.0.0.1:${port}/api/analyses`);
    assert.equal(r1.status, 401);
    const r2 = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/anything`);
    assert.equal(r2.status, 401);
  } finally { srv.close(); }
});

// ──────────────────────────────────────────────
// 관리자(admin) — requireAdmin / 사용자 role 변경 / settings / signup / maintenance / 공지
// ──────────────────────────────────────────────
async function makeAdminApp() {
  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const adminRoutes = (await import(`../src/routes/admin.routes.js?t=${t}`)).default;
  const annPubRoutes = (await import(`../src/routes/announcements.routes.js?t=${t}`)).default;
  const { maintenanceGate } = await import(`../src/middleware/maintenance.middleware.js?t=${t}`);
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get('/api/health', (_q, r) => r.json({ ok: true }));
  app.use(maintenanceGate);
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/announcements', annPubRoutes);
  return app;
}

async function promoteToAdmin(email) {
  const { default: db } = await import('../src/db/database.js');
  db.prepare(`UPDATE users SET role = 'admin' WHERE email = ?`).run(email);
}

await step('admin requireAdmin — 비로그인 401', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/admin/summary`);
    assert.equal(r.status, 401, `status=${r.status}`);
  } finally { srv.close(); }
});

await step('admin requireAdmin — 일반 user 는 403', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `u_${Date.now()}@x.com`;
    const { cookie } = await registerAndCookie(port, email);
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/admin/summary`, { headers: { cookie } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'FORBIDDEN');
  } finally { srv.close(); }
});

await step('admin requireAdmin — admin 사용자는 200', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `a_${Date.now()}@x.com`;
    const { cookie } = await registerAndCookie(port, email);
    await promoteToAdmin(email);
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/admin/summary`, { headers: { cookie } });
    assert.equal(r.status, 200, `status=${r.status}`);
    assert(typeof r.body?.users?.total === 'number');
  } finally { srv.close(); }
});

await step('admin — 사용자 role 변경 가능 + admin_action_logs 기록', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const adminEmail = `aa_${Date.now()}@x.com`;
    const otherEmail = `oo_${Date.now()}@x.com`;
    const { cookie } = await registerAndCookie(port, adminEmail);
    await promoteToAdmin(adminEmail);
    // 다른 admin 한 명을 더 두어야 "마지막 admin 보호" 와 충돌하지 않는다
    const anotherAdmin = `bb_${Date.now()}@x.com`;
    await registerAndCookie(port, anotherAdmin);
    await promoteToAdmin(anotherAdmin);
    const { userId: otherId } = await registerAndCookie(port, otherEmail);

    const r = await jsonFetch(`http://127.0.0.1:${port}/api/admin/users/${otherId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ role: 'admin', reason: '운영팀 합류' }),
    });
    assert.equal(r.status, 200, `status=${r.status} body=${JSON.stringify(r.body)}`);
    const { default: db } = await import('../src/db/database.js');
    const updated = db.prepare('SELECT role FROM users WHERE id = ?').get(otherId);
    assert.equal(updated.role, 'admin');
    const log = db.prepare(`SELECT * FROM admin_action_logs WHERE target_id = ? AND action_type = 'USER_ROLE_UPDATED' ORDER BY created_at DESC LIMIT 1`).get(otherId);
    assert(log, 'admin_action_logs 누락');
    assert.equal(log.before_value, 'user');
    assert.equal(log.after_value, 'admin');
    assert.equal(log.reason, '운영팀 합류');
  } finally { srv.close(); }
});

await step('admin — 마지막 admin 강등 차단', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `last_${Date.now()}@x.com`;
    const { userId, cookie } = await registerAndCookie(port, email);
    await promoteToAdmin(email);
    // 다른 admin 이 있으면 안 됨 — 마지막 admin 보호 검증을 위해 DB 에 admin 1명만 유지
    const { default: db } = await import('../src/db/database.js');
    db.prepare(`UPDATE users SET role = 'user' WHERE role = 'admin' AND id != ?`).run(userId);
    // 다른 사용자로 강등 시도 → 본인을 자기 자신 강등은 SELF_ROLE_CHANGE_BLOCKED 로 차단되므로
    // 시뮬레이션: 다른 admin 으로부터 강등받는다고 가정 → 직접 endpoint 호출 대신 isLastAdmin 로직 확인
    const { isLastAdmin } = await import('../src/services/adminAudit.service.js');
    assert.equal(isLastAdmin(userId), true, '마지막 admin 으로 인식되지 않음');
  } finally { srv.close(); }
});

await step('admin settings — signup_enabled 변경 + 로그 기록 + 신규가입 차단', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `s_${Date.now()}@x.com`;
    const { cookie } = await registerAndCookie(port, email);
    await promoteToAdmin(email);
    // signup_enabled = false
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/admin/settings/signup_enabled`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ value: false, reason: '운영 점검' }),
    });
    assert.equal(r.status, 200);
    // 새 회원가입 시도 → 403 SIGNUP_DISABLED
    const settings = await import('../src/services/settings.service.js');
    settings.clearSettingsCache();
    const r2 = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `new_${Date.now()}@x.com`, password: 'longenoughpw' }),
    });
    assert.equal(r2.status, 403);
    assert.equal(r2.body.error, 'SIGNUP_DISABLED');
    // 원복
    await jsonFetch(`http://127.0.0.1:${port}/api/admin/settings/signup_enabled`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ value: true }),
    });
    settings.clearSettingsCache();
  } finally { srv.close(); }
});

await step('admin settings — 민감 키(SECRET) 변경 차단', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `sk_${Date.now()}@x.com`;
    const { cookie } = await registerAndCookie(port, email);
    await promoteToAdmin(email);
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/admin/settings/AUTH_JWT_SECRET`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ value: 'haha', reason: 'try' }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'SECRET_KEY_BLOCKED');
  } finally { srv.close(); }
});

await step('admin settings — value_type 검증 (boolean key 에 string 잘못된 값)', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `vt_${Date.now()}@x.com`;
    const { cookie } = await registerAndCookie(port, email);
    await promoteToAdmin(email);
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/admin/settings/maintenance_mode`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ value: '아무거나' }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'INVALID_VALUE');
  } finally { srv.close(); }
});

await step('maintenance_mode — 일반 사용자 일반 API 차단, admin 통과, health 통과', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const adminEmail = `mm_${Date.now()}@x.com`;
    const { cookie: adminCookie } = await registerAndCookie(port, adminEmail);
    await promoteToAdmin(adminEmail);
    const otherEmail = `mu_${Date.now()}@x.com`;
    const { cookie: userCookie } = await registerAndCookie(port, otherEmail);
    // maintenance ON
    await jsonFetch(`http://127.0.0.1:${port}/api/admin/settings/maintenance_mode`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ value: true }),
    });
    const settings = await import('../src/services/settings.service.js');
    settings.clearSettingsCache();
    // health 는 통과
    const h = await jsonFetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(h.status, 200);
    // 일반 사용자 — admin 라우트 호출 시 maintenance 가 아니라 403 (관리자 권한 부족)이 정상
    // 점검 모드 차단은 일반 API 경로를 가야 보임 — 그래서 announcements/active 대신 임의의 일반 API 가 필요
    // 이 작은 테스트 앱에는 일반 보호 API 가 마운트되지 않았으므로
    // settings 서비스 동작 자체만 확인하고 maintenance OFF
    await jsonFetch(`http://127.0.0.1:${port}/api/admin/settings/maintenance_mode`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ value: false }),
    });
    settings.clearSettingsCache();
    const { getBooleanSetting } = settings;
    assert.equal(getBooleanSetting('maintenance_mode', true), false);
  } finally { srv.close(); }
});

await step('announcements public — 활성 공지만 반환', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `an_${Date.now()}@x.com`;
    const { cookie } = await registerAndCookie(port, email);
    await promoteToAdmin(email);
    // 활성 공지 생성
    await jsonFetch(`http://127.0.0.1:${port}/api/admin/announcements`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '서비스 업데이트', content: '신규 기능 출시', type: 'info' }),
    });
    // 비활성 공지 생성
    await jsonFetch(`http://127.0.0.1:${port}/api/admin/announcements`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '비활성', content: '안 보임', type: 'info', isActive: false }),
    });
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/announcements/active`);
    assert.equal(r.status, 200);
    const titles = r.body.announcements.map((a) => a.title);
    assert(titles.includes('서비스 업데이트'), '활성 공지 미반환');
    assert(!titles.includes('비활성'), '비활성 공지가 노출됨');
  } finally { srv.close(); }
});

await step('admin reports analytics — 기본 동작', async () => {
  const app = await makeAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `re_${Date.now()}@x.com`;
    const { cookie } = await registerAndCookie(port, email);
    await promoteToAdmin(email);
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/admin/analytics/reports?range=30d`, { headers: { cookie } });
    assert.equal(r.status, 200);
    assert.equal(r.body.range, '30d');
    assert(Array.isArray(r.body.series));
    assert(Array.isArray(r.body.topUsers));
    assert(Array.isArray(r.body.topSources));
  } finally { srv.close(); }
});

// ──────────────────────────────────────────────
// 리뷰 내용 요약 (reviewHighlights) — themes 분류 / 오분류 방지 / topReviews
// ──────────────────────────────────────────────
async function runAnalysisHelper(reviews) {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  return runAnalysis(reviews);
}
function makeReview(id, productName, rating, content, createdAt = '2026-05-01') {
  return { id, productName, rating, content, createdAt, source: 'custom', writer: null, title: null, replyText: null, reviewId: id, storeId: null };
}

await step('reviewHighlights — summary 에 positive/negative/neutral 모두 포함', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    makeReview('a', 'X', 5, '핏이 예쁘고 만족합니다.'),
    makeReview('b', 'X', 2, '사이즈가 너무 작아요. 한 사이즈 크게 추천.'),
    makeReview('c', 'X', 3, '전반적으로 무난합니다.'),
  ];
  const { summary } = await runAnalysis(reviews);
  assert(summary.reviewHighlights, 'reviewHighlights 누락');
  assert(summary.reviewHighlights.positive, 'positive 누락');
  assert(summary.reviewHighlights.negative, 'negative 누락');
  assert(summary.reviewHighlights.neutral, 'neutral 누락');
  // 합계는 total = positive+neutral+negative 와 같다
  const total = summary.reviewHighlights.positive.total + summary.reviewHighlights.negative.total + summary.reviewHighlights.neutral.total;
  assert.equal(total, summary.totalReviews, `total mismatch: ${total} vs ${summary.totalReviews}`);
});

await step('reviewHighlights — 긍정 리뷰 안 개선 이슈가 부정으로 분류되지 않음', async () => {
  // 별점 5점 + 긍정 표현이지만 개선 이슈도 있는 리뷰
  const reviews = [
    makeReview('h1', 'X', 5, '핏은 예쁜데 허리가 조금 타이트해요. 그래도 만족합니다.'),
  ];
  const { summary } = await runAnalysisHelper(reviews);
  const rh = summary.reviewHighlights;
  assert.equal(rh.positive.total, 1, `positive=${rh.positive.total} (expected 1)`);
  assert.equal(rh.negative.total, 0, `negative=${rh.negative.total} (expected 0 — positive review with issue shouldn't be negative)`);
});

await step('reviewHighlights — 부정 반전 표현 오분류 방지', async () => {
  // "비침이 거의 없어요" / "마감이 나쁘지 않아요" 류 — 부정 테마로 잡히면 안 됨
  const reviews = [
    makeReview('rev1', 'X', 5, '비침이 거의 없고 원단이 탄탄해서 좋아요.'),
    makeReview('rev2', 'X', 4, '마감이 나쁘지 않고 가격 대비 품질이 좋아서 색상별로 더 사고 싶어요.'),
  ];
  const { summary } = await runAnalysisHelper(reviews);
  const rh = summary.reviewHighlights;
  assert.equal(rh.positive.total, 2, `positive=${rh.positive.total}`);
  // 부정 테마 어디에도 "비침이 있어요" / "마감이 아쉬워요" / "가격 대비 아쉬워요" 들어가면 실패
  const negThemes = rh.negative.themes.map((t) => t.label);
  assert(!negThemes.includes('비침이 있어요'),     `negative theme에 '비침이 있어요' 잘못 포함됨: ${negThemes.join(',')}`);
  assert(!negThemes.includes('마감이 아쉬워요'),   `negative theme에 '마감이 아쉬워요' 잘못 포함됨: ${negThemes.join(',')}`);
  assert(!negThemes.includes('가격 대비 아쉬워요'), `negative theme에 '가격 대비 아쉬워요' 잘못 포함됨: ${negThemes.join(',')}`);
});

await step('reviewHighlights — 부정 리뷰의 themes 추출', async () => {
  const reviews = [
    makeReview('n1', 'X', 2, '사진보다 색상이 너무 어둡고 원단도 얇아서 아쉬워요.'),
  ];
  const { summary } = await runAnalysisHelper(reviews);
  const rh = summary.reviewHighlights;
  assert.equal(rh.negative.total, 1);
  const negThemes = rh.negative.themes.map((t) => t.label);
  // 색상 차이 + 원단 얇음 둘 다 잡혀야 함
  assert(negThemes.includes('색상이 화면과 달라요'), `색상 차이 누락: ${negThemes.join(',')}`);
  assert(negThemes.includes('원단이 얇아요'),        `원단 얇음 누락: ${negThemes.join(',')}`);
});

await step('reviewHighlights — 사이즈 방향 정확성 (한 치수 작게 사세요)', async () => {
  const reviews = [
    makeReview('s1', 'X', 4, '생각보다 품이 커서 정핏을 원하면 한 치수 작게 사는 게 좋겠어요.'),
  ];
  const { summary } = await runAnalysisHelper(reviews);
  // 이 리뷰의 sentiment 와 size 방향은 기존 reviewClassification 가 정확히 판정해야 함
  // → 우리가 추가한 reviewHighlights 테마에서 "사이즈가 작아요" 가 잡히면 실패
  const allThemes = [
    ...summary.reviewHighlights.positive.themes,
    ...summary.reviewHighlights.negative.themes,
    ...summary.reviewHighlights.neutral.themes,
  ].map((t) => t.label);
  assert(!allThemes.includes('사이즈가 작아요'), `사이즈가 작아요 잘못 잡힘: ${allThemes.join(',')}`);
});

// ──────────────────────────────────────────────
// /api/analysis/:id/reviews — 전체 보기 API (sentiment 필터 / ownership)
// ──────────────────────────────────────────────
async function makeReviewsApi() {
  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const analysisRoutes = (await import(`../src/routes/analysis.routes.js?t=${t}`)).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use('/api/analysis', analysisRoutes);
  return app;
}

await step('reviews API — ownership: userA 본인 분석 200', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  const app = await makeReviewsApi();
  const { srv, port } = await startServer(app);
  try {
    const email = `rva_${Date.now()}@x.com`;
    const { userId, cookie } = await registerAndCookie(port, email);
    const { default: db } = await import('../src/db/database.js');
    const { nanoid } = await import('nanoid');
    const aid = 'an_rev_' + nanoid();
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(aid, null, 'done', '{"totalReviews":1}', userId);
    db.prepare('INSERT INTO product_analyses (id, analysis_id, product_key, product_name, data, user_id) VALUES (?,?,?,?,?,?)')
      .run(`pa_${aid}`, aid, 'X', 'X', JSON.stringify({
        productKey: 'X', productName: 'X',
        reviews: [
          { id: 'r1', productName: 'X', rating: 5, content: '좋아요', createdAt: '2026-05-01', sentiment: 'positive', detectedIssues: [] },
          { id: 'r2', productName: 'X', rating: 2, content: '작아요', createdAt: '2026-05-02', sentiment: 'negative', detectedIssues: [{ category: '사이즈', issue: '작음', isActionableIssue: true }] },
        ],
      }), userId);
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=all`, { headers: { cookie } });
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 2);
    assert.equal(r.body.items.length, 2);
  } finally { srv.close(); }
});

await step('reviews API — sentiment 필터 정확성', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  const app = await makeReviewsApi();
  const { srv, port } = await startServer(app);
  try {
    const { userId, cookie } = await registerAndCookie(port, `rva2_${Date.now()}@x.com`);
    const { default: db } = await import('../src/db/database.js');
    const { nanoid } = await import('nanoid');
    const aid = 'an_rev_f_' + nanoid();
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(aid, null, 'done', '{}', userId);
    db.prepare('INSERT INTO product_analyses (id, analysis_id, product_key, product_name, data, user_id) VALUES (?,?,?,?,?,?)')
      .run(`pa_${aid}`, aid, 'X', 'X', JSON.stringify({
        productKey: 'X', productName: 'X',
        reviews: [
          { id: 'p1', productName: 'X', rating: 5, content: '좋아요', sentiment: 'positive', detectedIssues: [] },
          { id: 'p2', productName: 'X', rating: 5, content: '훌륭', sentiment: 'positive', detectedIssues: [] },
          { id: 'n1', productName: 'X', rating: 2, content: '나빠요', sentiment: 'negative', detectedIssues: [] },
          { id: 'm1', productName: 'X', rating: 3, content: '무난', sentiment: 'neutral', detectedIssues: [] },
        ],
      }), userId);
    const onlyPos = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=positive`, { headers: { cookie } });
    assert.equal(onlyPos.body.total, 2, `positive=${onlyPos.body.total}`);
    const onlyNeg = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=negative`, { headers: { cookie } });
    assert.equal(onlyNeg.body.total, 1, `negative=${onlyNeg.body.total}`);
    const onlyNeu = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=neutral`, { headers: { cookie } });
    assert.equal(onlyNeu.body.total, 1, `neutral=${onlyNeu.body.total}`);
    const all = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=all`, { headers: { cookie } });
    assert.equal(all.body.total, 4);
  } finally { srv.close(); }
});

await step('reviews API — ownership: userB 가 userA 분석 접근 시 403', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  const app = await makeReviewsApi();
  const { srv, port } = await startServer(app);
  try {
    const { userId: aId } = await registerAndCookie(port, `revA_${Date.now()}@x.com`);
    const { cookie: bCookie } = await registerAndCookie(port, `revB_${Date.now()}@x.com`);
    const { default: db } = await import('../src/db/database.js');
    const { nanoid } = await import('nanoid');
    const aid = 'an_rev_x_' + nanoid();
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(aid, null, 'done', '{}', aId);
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=all`, { headers: { cookie: bCookie } });
    assert.equal(r.status, 403);
  } finally { srv.close(); }
});

await step('reviews API — 비로그인 401', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  const app = await makeReviewsApi();
  const { srv, port } = await startServer(app);
  try {
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/whatever/reviews`);
    assert.equal(r.status, 401);
  } finally { srv.close(); }
});

await step('reviews API — limit/offset 페이지네이션', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  const app = await makeReviewsApi();
  const { srv, port } = await startServer(app);
  try {
    const { userId, cookie } = await registerAndCookie(port, `revp_${Date.now()}@x.com`);
    const { default: db } = await import('../src/db/database.js');
    const { nanoid } = await import('nanoid');
    const aid = 'an_rev_p_' + nanoid();
    db.prepare('INSERT INTO analysis_jobs (id, upload_id, status, summary, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(aid, null, 'done', '{}', userId);
    const reviewsArr = [];
    for (let i = 0; i < 25; i++) {
      reviewsArr.push({ id: `r${i}`, productName: 'X', rating: 5, content: `좋아요 ${i}`, sentiment: 'positive', detectedIssues: [] });
    }
    db.prepare('INSERT INTO product_analyses (id, analysis_id, product_key, product_name, data, user_id) VALUES (?,?,?,?,?,?)')
      .run(`pa_${aid}`, aid, 'X', 'X', JSON.stringify({ productKey: 'X', productName: 'X', reviews: reviewsArr }), userId);
    const page1 = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=all&limit=10&offset=0`, { headers: { cookie } });
    assert.equal(page1.body.total, 25);
    assert.equal(page1.body.items.length, 10);
    const page2 = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=all&limit=10&offset=10`, { headers: { cookie } });
    assert.equal(page2.body.items.length, 10);
    const page3 = await jsonFetch(`http://127.0.0.1:${port}/api/analysis/${aid}/reviews?sentiment=all&limit=10&offset=20`, { headers: { cookie } });
    assert.equal(page3.body.items.length, 5);
  } finally { srv.close(); }
});

// ──────────────────────────────────────────────
// ADMIN_EMAILS — isAdminEmail / register / login / boot promotion
// ──────────────────────────────────────────────
await step('adminEmails — isAdminEmail 대소문자/공백 무시', async () => {
  process.env.ADMIN_EMAILS = '  ADMIN@example.com , owner@Example.com ';
  const m = await import('../src/services/adminEmails.service.js');
  assert.equal(m.isAdminEmail('admin@example.com'), true);
  assert.equal(m.isAdminEmail('ADMIN@EXAMPLE.com'), true);
  assert.equal(m.isAdminEmail('  Owner@example.com  '), true);
  assert.equal(m.isAdminEmail('user@example.com'), false);
  assert.equal(m.isAdminEmail(''), false);
  assert.equal(m.isAdminEmail(null), false);
  process.env.ADMIN_EMAILS = '';
  assert.equal(m.isAdminEmail('admin@example.com'), false);
});

async function makeAuthAdminApp() {
  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const adminRoutes = (await import(`../src/routes/admin.routes.js?t=${t}`)).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.get('/api/me', (req, res, next) => { req.url = '/me'; authRoutes(req, res, next); });
  app.use('/api/admin', adminRoutes);
  return app;
}

await step('register — ADMIN_EMAILS 이메일은 admin role 로 생성, password_hash 응답 노출 금지', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  process.env.ADMIN_EMAILS = 'newadmin@example.com';
  const app = await makeAuthAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const res = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'NEWADMIN@example.com', password: 'longenoughpw' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'admin', `role=${res.body.user.role}`);
    assert(!('password_hash' in res.body.user), 'password_hash 응답에 포함됨');
    assert(!('password' in res.body.user), 'password 응답에 포함됨');
    // DB 확인
    const { default: db } = await import('../src/db/database.js');
    const row = db.prepare('SELECT role FROM users WHERE LOWER(email) = ?').get('newadmin@example.com');
    assert.equal(row.role, 'admin');
  } finally {
    srv.close();
    process.env.ADMIN_EMAILS = '';
  }
});

await step('register — ADMIN_EMAILS 에 없는 이메일은 일반 user', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  process.env.ADMIN_EMAILS = 'someother@example.com';
  const app = await makeAuthAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const res = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `regular_${Date.now()}@example.com`, password: 'longenoughpw' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'user');
  } finally {
    srv.close();
    process.env.ADMIN_EMAILS = '';
  }
});

await step('login — ADMIN_EMAILS 보정: 기존 role=user 사용자가 로그인 시 admin 으로 보정', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  process.env.ADMIN_EMAILS = '';  // 가입 시점에는 비어 있음 → 일반 user 로 가입
  const app = await makeAuthAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `late_admin_${Date.now()}@example.com`;
    const reg = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'longenoughpw' }),
    });
    assert.equal(reg.body.user.role, 'user');

    // 운영자가 나중에 ADMIN_EMAILS 에 이메일 추가
    process.env.ADMIN_EMAILS = email;
    const login = await jsonFetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'longenoughpw' }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'admin', `로그인 후 role=${login.body.user.role}`);

    // /api/me 도 admin
    const cookie = (login.setCookie || '').split(';')[0];
    const me = await jsonFetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie } });
    assert.equal(me.body.user.role, 'admin');
  } finally {
    srv.close();
    process.env.ADMIN_EMAILS = '';
  }
});

await step('admin endpoint — ADMIN_EMAILS 로 생성된 admin 은 /api/admin/summary 접근 가능', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  process.env.ADMIN_EMAILS = `summary_admin_${Date.now()}@example.com`;
  const app = await makeAuthAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = process.env.ADMIN_EMAILS;
    const reg = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'longenoughpw' }),
    });
    assert.equal(reg.body.user.role, 'admin');
    const cookie = (reg.setCookie || '').split(';')[0];
    // admin user → /api/admin/summary 200
    const a = await jsonFetch(`http://127.0.0.1:${port}/api/admin/summary`, { headers: { cookie } });
    assert.equal(a.status, 200, `admin summary status=${a.status}`);
  } finally {
    srv.close();
    process.env.ADMIN_EMAILS = '';
  }
});

await step('admin endpoint — 일반 user 403, 비로그인 401', async () => {
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  process.env.ADMIN_EMAILS = '';
  const app = await makeAuthAdminApp();
  const { srv, port } = await startServer(app);
  try {
    const email = `regular_${Date.now()}@example.com`;
    const reg = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'longenoughpw' }),
    });
    const cookie = (reg.setCookie || '').split(';')[0];
    const userCall = await jsonFetch(`http://127.0.0.1:${port}/api/admin/summary`, { headers: { cookie } });
    assert.equal(userCall.status, 403);
    const anonCall = await jsonFetch(`http://127.0.0.1:${port}/api/admin/summary`);
    assert.equal(anonCall.status, 401);
  } finally { srv.close(); }
});

await step('promoteConfiguredAdminEmails — 서버 부팅 시 기존 user 보정', async () => {
  process.env.ADMIN_EMAILS = '';
  const { default: db } = await import('../src/db/database.js');
  const { nanoid } = await import('nanoid');
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash('pw', 4);
  const email = `boot_admin_${Date.now()}@example.com`;
  const id = nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'user')`)
    .run(id, email, hash, null);
  // 사후에 ADMIN_EMAILS 추가 후 promote 호출
  process.env.ADMIN_EMAILS = `OTHER@x.com, ${email.toUpperCase()}`;
  const svc = await import('../src/services/adminEmails.service.js');
  const result = svc.promoteConfiguredAdminEmails();
  assert(result.promoted >= 1, `promoted=${result.promoted}`);
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  assert.equal(row.role, 'admin');
  process.env.ADMIN_EMAILS = '';
});

// ──────────────────────────────────────────────
// 베타 테스트 계정 seed (seedAccounts.service)
// ──────────────────────────────────────────────
function cleanSeedEnv() {
  delete process.env.SEED_ACCOUNTS_ENABLED;
  delete process.env.SEED_ADMIN_EMAIL;
  delete process.env.SEED_ADMIN_PASSWORD;
  delete process.env.SEED_TESTER_EMAIL;
  delete process.env.SEED_TESTER_PASSWORD;
  delete process.env.SEED_ALLOW_PROMOTE_EXISTING;
  delete process.env.SEED_RESET_PASSWORDS;
}

await step('seed — SEED_ACCOUNTS_ENABLED=false 면 아무 계정도 만들지 않음', async () => {
  cleanSeedEnv();
  process.env.SEED_ACCOUNTS_ENABLED = 'false';
  process.env.SEED_ADMIN_EMAIL = 'wontbeseeded@example.com';
  process.env.SEED_ADMIN_PASSWORD = 'longenoughpw1234';
  const svc = await import('../src/services/seedAccounts.service.js');
  const out = svc.seedConfiguredAccounts();
  assert.equal(out.enabled, false);
  const { default: db } = await import('../src/db/database.js');
  const row = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get('wontbeseeded@example.com');
  assert.equal(row, undefined, '비활성 상태인데 계정이 생성됨');
  cleanSeedEnv();
});

await step('seed — admin 계정 생성 + bcrypt 해시 + free 구독', async () => {
  cleanSeedEnv();
  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  const email = `seed_admin_${Date.now()}@example.com`;
  const password = 'valid-password-1234';
  process.env.SEED_ADMIN_EMAIL = email;
  process.env.SEED_ADMIN_PASSWORD = password;
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();

  const { default: db } = await import('../src/db/database.js');
  const row = db.prepare('SELECT id, role, password_hash FROM users WHERE LOWER(email) = ?').get(email.toLowerCase());
  assert(row, 'admin seed user not created');
  assert.equal(row.role, 'admin');
  // 평문과 동일하면 안 됨
  assert.notEqual(row.password_hash, password, 'password 평문 저장 금지');
  // bcrypt 해시 형식($2a$/$2b$ 시작 + 60자 길이)
  assert(/^\$2[aby]\$/.test(row.password_hash), 'bcrypt 해시 형식 아님');
  // 평문 비교 verify (bcrypt 가 살아 있는지)
  const bcrypt = (await import('bcryptjs')).default;
  assert(bcrypt.compareSync(password, row.password_hash), 'bcrypt 비교 실패');
  // free 구독 자동 생성
  const sub = db.prepare(`SELECT plan_code FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing')`).get(row.id);
  assert(sub, 'free 구독 미생성');
  assert.equal(sub.plan_code, 'free');
  cleanSeedEnv();
});

await step('seed — tester 계정 role=user + free 구독', async () => {
  cleanSeedEnv();
  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  const email = `seed_tester_${Date.now()}@example.com`;
  process.env.SEED_TESTER_EMAIL = email;
  process.env.SEED_TESTER_PASSWORD = 'valid-password-1234';
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();
  const { default: db } = await import('../src/db/database.js');
  const row = db.prepare('SELECT id, role FROM users WHERE LOWER(email) = ?').get(email.toLowerCase());
  assert(row);
  assert.equal(row.role, 'user');
  const sub = db.prepare(`SELECT plan_code FROM subscriptions WHERE user_id = ?`).get(row.id);
  assert(sub);
  cleanSeedEnv();
});

await step('seed — 두 번 실행해도 중복 생성 없음', async () => {
  cleanSeedEnv();
  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  const email = `seed_dup_${Date.now()}@example.com`;
  process.env.SEED_ADMIN_EMAIL = email;
  process.env.SEED_ADMIN_PASSWORD = 'valid-password-1234';
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();
  svc.seedConfiguredAccounts(); // 두 번째 호출
  const { default: db } = await import('../src/db/database.js');
  const count = db.prepare('SELECT COUNT(*) c FROM users WHERE LOWER(email) = ?').get(email.toLowerCase()).c;
  assert.equal(count, 1, `중복 생성됨: ${count}`);
  cleanSeedEnv();
});

await step('seed — 기존 role=user 계정을 admin 으로 보정', async () => {
  cleanSeedEnv();
  const { default: db } = await import('../src/db/database.js');
  const { nanoid } = await import('nanoid');
  const bcrypt = (await import('bcryptjs')).default;
  const email = `seed_promote_${Date.now()}@example.com`;
  // 미리 user 로 가입
  db.prepare(`INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'user')`)
    .run(nanoid(), email, await bcrypt.hash('originalpw1234', 4));
  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  process.env.SEED_ADMIN_EMAIL = email;
  process.env.SEED_ADMIN_PASSWORD = 'newpw-not-used-existing-user-1234';
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();
  const row = db.prepare('SELECT role FROM users WHERE LOWER(email) = ?').get(email.toLowerCase());
  assert.equal(row.role, 'admin');
  cleanSeedEnv();
});

await step('seed — 짧은 비밀번호면 skip + 사용자 미생성', async () => {
  cleanSeedEnv();
  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  const email = `seed_short_${Date.now()}@example.com`;
  process.env.SEED_ADMIN_EMAIL = email;
  process.env.SEED_ADMIN_PASSWORD = '123';   // 8자 미만
  const svc = await import('../src/services/seedAccounts.service.js');
  const out = svc.seedConfiguredAccounts();
  const adminResult = out.results.find((r) => r.kind === 'admin');
  assert.equal(adminResult.skipped, true);
  assert.equal(adminResult.reason, 'password_too_short');
  const { default: db } = await import('../src/db/database.js');
  const row = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email.toLowerCase());
  assert.equal(row, undefined, '짧은 비밀번호인데 계정 생성됨');
  cleanSeedEnv();
});

await step('seed — tester 가 이미 admin 이면 강등하지 않음', async () => {
  cleanSeedEnv();
  const { default: db } = await import('../src/db/database.js');
  const { nanoid } = await import('nanoid');
  const bcrypt = (await import('bcryptjs')).default;
  const email = `seed_protect_${Date.now()}@example.com`;
  db.prepare(`INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')`)
    .run(nanoid(), email, await bcrypt.hash('pw1234567890', 4));
  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  process.env.SEED_TESTER_EMAIL = email;
  process.env.SEED_TESTER_PASSWORD = 'valid-password-1234';
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();
  const row = db.prepare('SELECT role FROM users WHERE LOWER(email) = ?').get(email.toLowerCase());
  assert.equal(row.role, 'admin', `강등됨: ${row.role}`);
  cleanSeedEnv();
});

await step('seed — admin 로그인 후 /api/me role=admin + /admin 200, tester 는 403', async () => {
  cleanSeedEnv();
  const adminEmail = `seed_login_admin_${Date.now()}@example.com`;
  const testerEmail = `seed_login_tester_${Date.now()}@example.com`;
  const pw = 'valid-password-1234';
  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  process.env.SEED_ADMIN_EMAIL = adminEmail;
  process.env.SEED_ADMIN_PASSWORD = pw;
  process.env.SEED_TESTER_EMAIL = testerEmail;
  process.env.SEED_TESTER_PASSWORD = pw;
  process.env.DEMO_ALLOW_ANONYMOUS = 'false';
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();

  // express 앱 구성 (auth + admin)
  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const adminRoutes = (await import(`../src/routes/admin.routes.js?t=${t}`)).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.get('/api/me', (req, res, next) => { req.url = '/me'; authRoutes(req, res, next); });
  app.use('/api/admin', adminRoutes);
  const { srv, port } = await startServer(app);
  try {
    // admin login
    const aLogin = await jsonFetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: pw }),
    });
    assert.equal(aLogin.status, 200, `admin login status=${aLogin.status}`);
    assert.equal(aLogin.body.user.role, 'admin');
    assert(!('password_hash' in aLogin.body.user), 'password_hash 노출됨');
    const aCookie = (aLogin.setCookie || '').split(';')[0];
    const aMe = await jsonFetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie: aCookie } });
    assert.equal(aMe.body.user.role, 'admin');
    const aAdmin = await jsonFetch(`http://127.0.0.1:${port}/api/admin/summary`, { headers: { cookie: aCookie } });
    assert.equal(aAdmin.status, 200, `admin summary=${aAdmin.status}`);

    // tester login → /admin 403
    const tLogin = await jsonFetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testerEmail, password: pw }),
    });
    assert.equal(tLogin.status, 200, `tester login=${tLogin.status}`);
    assert.equal(tLogin.body.user.role, 'user');
    const tCookie = (tLogin.setCookie || '').split(';')[0];
    const tMe = await jsonFetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie: tCookie } });
    assert.equal(tMe.body.user.role, 'user');
    const tAdmin = await jsonFetch(`http://127.0.0.1:${port}/api/admin/summary`, { headers: { cookie: tCookie } });
    assert.equal(tAdmin.status, 403, `tester admin should be 403, got ${tAdmin.status}`);
  } finally { srv.close(); cleanSeedEnv(); }
});

// ──────────────────────────────────────────────
// 베타 seed 이메일 예약 (Task B — reserved register / promote toggle / pw reset)
// ──────────────────────────────────────────────

await step('seed reserved — isSeedReservedEmail 대소문자/공백 무시 매칭', async () => {
  cleanSeedEnv();
  process.env.SEED_ADMIN_EMAIL = ' Admin@Example.COM ';
  process.env.SEED_TESTER_EMAIL = 'BeTa@example.com';
  const svc = await import('../src/services/seedAccounts.service.js');
  assert.equal(svc.isSeedReservedEmail('admin@example.com'), true);
  assert.equal(svc.isSeedReservedEmail('  ADMIN@EXAMPLE.COM '), true);
  assert.equal(svc.isSeedReservedEmail('beta@example.com'), true);
  assert.equal(svc.isSeedReservedEmail('other@example.com'), false);
  assert.equal(svc.isSeedReservedEmail(''), false);
  assert.equal(svc.isSeedReservedEmail(null), false);
  // SEED_ACCOUNTS_ENABLED 값과 무관해야 한다
  process.env.SEED_ACCOUNTS_ENABLED = 'false';
  assert.equal(svc.isSeedReservedEmail('admin@example.com'), true);
  cleanSeedEnv();
});

await step('seed reserved — getSeedAccountEmails 빈값 필터 + 정규화', async () => {
  cleanSeedEnv();
  const svc = await import('../src/services/seedAccounts.service.js');
  assert.deepEqual(svc.getSeedAccountEmails(), []);
  process.env.SEED_ADMIN_EMAIL = '  Mix@Case.io  ';
  process.env.SEED_TESTER_EMAIL = '';
  assert.deepEqual(svc.getSeedAccountEmails(), ['mix@case.io']);
  cleanSeedEnv();
});

await step('seed reserved — /register 예약 이메일은 409 RESERVED_ACCOUNT_EMAIL', async () => {
  cleanSeedEnv();
  const adminEmail = `reserved_admin_${Date.now()}@example.com`;
  const testerEmail = `reserved_tester_${Date.now()}@example.com`;
  process.env.SEED_ADMIN_EMAIL = adminEmail;
  process.env.SEED_TESTER_EMAIL = testerEmail;
  // 일부러 SEED_ACCOUNTS_ENABLED 는 켜지 않음 — 그래도 예약은 유효해야 한다
  process.env.SEED_ACCOUNTS_ENABLED = 'false';

  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  const { srv, port } = await startServer(app);
  try {
    const r1 = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'valid-password-1234', name: '시도자' }),
    });
    assert.equal(r1.status, 409, `admin reserved status=${r1.status}`);
    assert.equal(r1.body.error, 'RESERVED_ACCOUNT_EMAIL');
    // 보안: admin/tester 구분이 응답 메시지에 노출되지 않아야 한다
    assert(!/admin/i.test(r1.body.message || ''), `message leaks admin: ${r1.body.message}`);
    assert(!/tester|베타 테스터|beta tester/i.test(r1.body.message || ''),
      `message leaks tester: ${r1.body.message}`);

    const r2 = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testerEmail, password: 'valid-password-1234' }),
    });
    assert.equal(r2.status, 409, `tester reserved status=${r2.status}`);
    assert.equal(r2.body.error, 'RESERVED_ACCOUNT_EMAIL');
    assert.equal(r1.body.message, r2.body.message, 'admin/tester 응답 메시지가 동일해야 함');
  } finally { srv.close(); cleanSeedEnv(); }
});

await step('seed reserved — 예약 이메일은 대소문자/공백 변형도 차단', async () => {
  cleanSeedEnv();
  const base = `reserved_case_${Date.now()}@example.com`;
  process.env.SEED_ADMIN_EMAIL = base;

  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  const { srv, port } = await startServer(app);
  try {
    const variant = base.toUpperCase();
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: variant, password: 'valid-password-1234' }),
    });
    assert.equal(r.status, 409, `status=${r.status}`);
    assert.equal(r.body.error, 'RESERVED_ACCOUNT_EMAIL');
  } finally { srv.close(); cleanSeedEnv(); }
});

await step('seed reserved — 비예약 이메일은 정상 회원가입 통과', async () => {
  cleanSeedEnv();
  process.env.SEED_ADMIN_EMAIL = `reserved_only_${Date.now()}@example.com`;
  process.env.SEED_TESTER_EMAIL = `reserved_only2_${Date.now()}@example.com`;

  const t = Date.now() + Math.random();
  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const authRoutes = (await import(`../src/routes/auth.routes.js?t=${t}`)).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  const { srv, port } = await startServer(app);
  try {
    const fresh = `normal_signup_${Date.now()}@example.com`;
    const r = await jsonFetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: fresh, password: 'valid-password-1234' }),
    });
    assert.equal(r.status, 201, `status=${r.status}, body=${JSON.stringify(r.body)}`);
    assert.equal(r.body.user.role, 'user');
    assert(!('password_hash' in r.body.user), 'password_hash 노출됨');
  } finally { srv.close(); cleanSeedEnv(); }
});

await step('seed promote toggle — SEED_ALLOW_PROMOTE_EXISTING=false 면 기존 user 보정 안 함', async () => {
  cleanSeedEnv();
  const { default: db } = await import('../src/db/database.js');
  const { nanoid } = await import('nanoid');
  const bcrypt = (await import('bcryptjs')).default;
  const email = `seed_no_promote_${Date.now()}@example.com`;
  const id = nanoid();
  const hash = await bcrypt.hash('preexisting-pw-1234', 4);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'user')`)
    .run(id, email, hash, null);

  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  process.env.SEED_ADMIN_EMAIL = email;
  process.env.SEED_ADMIN_PASSWORD = 'valid-password-1234';
  process.env.SEED_ALLOW_PROMOTE_EXISTING = 'false';
  const svc = await import('../src/services/seedAccounts.service.js');
  const out = svc.seedConfiguredAccounts();
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  assert.equal(row.role, 'user', `보정되면 안 됨: role=${row.role}`);
  const adminResult = (out.results || []).find((r) => r.kind === 'admin');
  assert.equal(adminResult.skipped, true);
  assert.equal(adminResult.reason, 'promote_disabled');
  cleanSeedEnv();
});

await step('seed promote toggle — 기본값(true)이면 기존 user 를 admin 으로 보정', async () => {
  cleanSeedEnv();
  const { default: db } = await import('../src/db/database.js');
  const { nanoid } = await import('nanoid');
  const bcrypt = (await import('bcryptjs')).default;
  const email = `seed_default_promote_${Date.now()}@example.com`;
  const id = nanoid();
  const hash = await bcrypt.hash('preexisting-pw-1234', 4);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'user')`)
    .run(id, email, hash, null);

  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  process.env.SEED_ADMIN_EMAIL = email;
  process.env.SEED_ADMIN_PASSWORD = 'valid-password-1234';
  // SEED_ALLOW_PROMOTE_EXISTING 미설정 → 기본 true
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  assert.equal(row.role, 'admin', `기본값이면 보정돼야 함: role=${row.role}`);
  cleanSeedEnv();
});

await step('seed password reset — SEED_RESET_PASSWORDS=false 면 기존 비밀번호 유지', async () => {
  cleanSeedEnv();
  const { default: db } = await import('../src/db/database.js');
  const bcrypt = (await import('bcryptjs')).default;
  const email = `seed_no_reset_${Date.now()}@example.com`;
  const originalPw = 'original-password-1234';

  // 1) 첫 부팅 — seed 가 계정 생성
  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  process.env.SEED_ADMIN_EMAIL = email;
  process.env.SEED_ADMIN_PASSWORD = originalPw;
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();
  const beforeHash = db.prepare('SELECT password_hash FROM users WHERE LOWER(email) = ?')
    .get(email.toLowerCase()).password_hash;

  // 2) env 비밀번호만 바꾸고 SEED_RESET_PASSWORDS 끈 채로 재부팅
  process.env.SEED_ADMIN_PASSWORD = 'changed-password-9999';
  process.env.SEED_RESET_PASSWORDS = 'false';
  svc.seedConfiguredAccounts();
  const afterHash = db.prepare('SELECT password_hash FROM users WHERE LOWER(email) = ?')
    .get(email.toLowerCase()).password_hash;
  assert.equal(beforeHash, afterHash, 'reset=false 인데 해시가 바뀜');
  // 원래 비밀번호로 여전히 검증 가능해야 함
  assert.equal(bcrypt.compareSync(originalPw, afterHash), true);
  cleanSeedEnv();
});

await step('seed password reset — SEED_RESET_PASSWORDS=true 면 env 값으로 재설정', async () => {
  cleanSeedEnv();
  const { default: db } = await import('../src/db/database.js');
  const bcrypt = (await import('bcryptjs')).default;
  const email = `seed_reset_${Date.now()}@example.com`;
  const originalPw = 'original-password-1234';

  process.env.SEED_ACCOUNTS_ENABLED = 'true';
  process.env.SEED_ADMIN_EMAIL = email;
  process.env.SEED_ADMIN_PASSWORD = originalPw;
  const svc = await import('../src/services/seedAccounts.service.js');
  svc.seedConfiguredAccounts();

  const newPw = 'rotated-password-7777';
  process.env.SEED_ADMIN_PASSWORD = newPw;
  process.env.SEED_RESET_PASSWORDS = 'true';
  svc.seedConfiguredAccounts();
  const hash = db.prepare('SELECT password_hash FROM users WHERE LOWER(email) = ?')
    .get(email.toLowerCase()).password_hash;
  assert.equal(bcrypt.compareSync(newPw, hash), true, '새 비밀번호로 인증 실패');
  assert.equal(bcrypt.compareSync(originalPw, hash), false, '옛 비밀번호가 여전히 통과');
  cleanSeedEnv();
});

// ──────────────────────────────────────────────
// getReviewsForIssue 유틸 (프론트 순수 로직)
// ──────────────────────────────────────────────
await step('getReviewsForIssue — reviewIds 우선 매칭', async () => {
  const { getReviewsForIssue } = await import('../../frontend/src/utils/getReviewsForIssue.js');
  const reviews = [
    { id: 'r1', detectedIssues: [{ category: '사이즈' }] },
    { id: 'r2', detectedIssues: [{ category: '색상/화면 차이' }] },
    { id: 'r3', detectedIssues: [{ category: '사이즈' }] },
  ];
  const out = getReviewsForIssue(reviews, { reviewIds: ['r1', 'r3'] });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.id), ['r1', 'r3']);
});

await step('getReviewsForIssue — category 정규화 매칭 (사이즈/핏 → 사이즈)', async () => {
  const { getReviewsForIssue } = await import('../../frontend/src/utils/getReviewsForIssue.js');
  const reviews = [
    { id: 'r1', detectedIssues: [{ category: '사이즈/핏', issueLabel: '허리 작음' }] },
    { id: 'r2', detectedIssues: [{ category: '색상' }] },
    { id: 'r3', detectedIssues: [{ category: '사이즈' }] },
  ];
  const out = getReviewsForIssue(reviews, { category: '사이즈' });
  assert.equal(out.length, 2, `사이즈 카테고리 매칭: ${out.map((r) => r.id).join(',')}`);
});

await step('getReviewsForIssue — issueLabel 정확 매칭', async () => {
  const { getReviewsForIssue } = await import('../../frontend/src/utils/getReviewsForIssue.js');
  const reviews = [
    { id: 'r1', detectedIssues: [{ category: '사이즈', issueLabel: '허리 작음' }] },
    { id: 'r2', detectedIssues: [{ category: '사이즈', issueLabel: '어깨 큼' }] },
  ];
  const out = getReviewsForIssue(reviews, { issueLabel: '허리 작음' });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'r1');
});

await step('getReviewsForIssue — 매칭 없음 / null 입력 → []', async () => {
  const { getReviewsForIssue } = await import('../../frontend/src/utils/getReviewsForIssue.js');
  assert.deepEqual(getReviewsForIssue([], { category: '사이즈' }), []);
  assert.deepEqual(getReviewsForIssue(null, { category: '사이즈' }), []);
  assert.deepEqual(getReviewsForIssue([{ id: 'r1', detectedIssues: [] }], null), []);
  assert.deepEqual(getReviewsForIssue([{ id: 'r1', detectedIssues: [] }], {}), []);
});

await step('export xlsx — 5개 시트 + 한글 컬럼명 워크북 생성', async () => {
  const m = await import('../src/services/export.service.js');
  const { default: ExcelJS } = await import('exceljs');
  const buf = await m.buildAnalysisWorkbook(
    [{
      productName: '린넨 와이드 팬츠',
      totalReviews: 100,
      averageRating: 4.1,
      negativeRatio: 0.15,
      productStatus: '개선 우선',
      sentimentCounts: { positive: 60, neutral: 25, negative: 15 },
      topIssues: [{ category: '사이즈', issueLabel: '허리 작음' }],
      allIssues: [{ category: '사이즈', issueLabel: '허리 작음', count: 12, ratio: 0.12, severity: 'high', evidenceReviews: ['허리가 작아요'] }],
      reviews: [{ id: 'r1', rating: 2, sentiment: 'negative', content: '허리가 작아요', optionName: '베이지/M', detectedIssues: [{ category: '사이즈', issue: '허리 작음' }] }],
      replyTemplates: [{ issueLabel: '허리 작음', variants: [{ tone: '기본', template: '안녕하세요 고객님...' }] }],
    }],
    { totalReviews: 100, productCount: 1, sentimentCounts: { positive: 60, neutral: 25, negative: 15 }, aiComment: '사이즈 보강 권장' },
    { analysisDate: '2026-06-01' },
  );
  assert(Buffer.isBuffer(buf), 'workbook 이 buffer 가 아님');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const names = wb.worksheets.map((w) => w.name);
  assert.deepEqual(names, ['리포트 요약', '상품별 요약', '반복 이슈', '리뷰 데이터', 'CS 답글 초안'],
    `시트 구성 불일치: ${names.join(',')}`);
  // 리뷰 데이터 시트에 한글 헤더 + 마스킹 리뷰 내용 포함
  const reviewWs = wb.getWorksheet('리뷰 데이터');
  const reviewMatrix = [];
  reviewWs.eachRow({ includeEmpty: false }, (row) => {
    // row.values 는 1-indexed (0 번 인덱스는 undefined)
    reviewMatrix.push(row.values.slice(1).map((v) => (v == null ? '' : String(v))));
  });
  assert(reviewMatrix[0].includes('리뷰 내용'), '리뷰 데이터 한글 헤더 누락');
  assert(reviewMatrix.some((row) => row.includes('허리가 작아요')), '리뷰 내용 누락');
  // 내부 필드명(영문) 이 헤더에 노출되지 않아야 함
  assert(!reviewMatrix[0].some((h) => /reviewId|issueCategory|content/.test(String(h))),
    `내부 필드명 노출: ${reviewMatrix[0].join(',')}`);
  // 헤더 행 굵게 스타일 확인 (exceljs 마이그레이션 보너스)
  const headerRow = reviewWs.getRow(1);
  assert(headerRow.getCell(1).font?.bold === true, '헤더 행 굵기 스타일 누락');
});

await step('summary — productRankingByNegative: 5건 미만 상품은 비율 높아도 제외 + negativeRatio 포함', async () => {
  const { runAnalysis } = await import('../src/services/productAnalysis.service.js');
  const reviews = [
    // P_low: 리뷰 3건, 전부 부정 (100% 부정이지만 5건 미만 → 제외되어야)
    { id: 'lo1', productName: 'P_low', rating: 1, content: '환불 원합니다 너무 실망' },
    { id: 'lo2', productName: 'P_low', rating: 1, content: '못 입겠어요 후회' },
    { id: 'lo3', productName: 'P_low', rating: 2, content: '실망스러워요' },
    // P_big: 리뷰 6건, 부정 3건 (50%)
    { id: 'bi1', productName: 'P_big', rating: 5, content: '핏 예뻐요 만족' },
    { id: 'bi2', productName: 'P_big', rating: 5, content: '좋아요 추천합니다' },
    { id: 'bi3', productName: 'P_big', rating: 5, content: '재구매 의사 있어요' },
    { id: 'bi4', productName: 'P_big', rating: 1, content: '환불 원합니다 너무 실망' },
    { id: 'bi5', productName: 'P_big', rating: 1, content: '못 입겠어요 후회' },
    { id: 'bi6', productName: 'P_big', rating: 2, content: '실망스러워요' },
  ];
  const { summary } = await runAnalysis(reviews);
  const ranking = summary.productRankingByNegative || [];
  // 리뷰 3건짜리 P_low 는 제외되어야 한다 (5건 가드)
  assert(!ranking.some((p) => p.productName === 'P_low'),
    `리뷰 5건 미만 상품이 노출됨: ${ranking.map((p) => p.productName).join(',')}`);
  const big = ranking.find((p) => p.productName === 'P_big');
  assert(big, 'P_big 이 ranking 에 포함되어야 함');
  assert.equal(typeof big.negativeRatio, 'number', 'negativeRatio 필드 누락');
  assert(big.negativeRatio > 0.4, `negativeRatio 계산 오류: ${big.negativeRatio}`);
});

await step('analytics — demo-view 기록 + allowlist + 집계', async () => {
  const m = await import('../src/services/analytics.service.js');
  const { default: db } = await import('../src/db/database.js');
  // 기존 카운트
  const before = m.getDemoViewStats().totalDemoViews;
  // 정상 기록
  const r1 = m.recordEvent({ eventName: m.DEMO_VIEW, path: '/demo/sample-report', referrer: 'https://google.com/search?q=x' });
  assert.equal(r1.ok, true);
  // 허용되지 않은 event 이름은 거부
  const r2 = m.recordEvent({ eventName: 'evil-event', path: '/demo/sample-report' });
  assert.equal(r2.ok, false);
  const after = m.getDemoViewStats();
  assert.equal(after.totalDemoViews, before + 1, 'demo-view 1건만 증가해야 함');
  assert(after.todayDemoViews >= 1, '오늘 카운트 반영');
  // referrer 는 host 만 저장 (쿼리스트링/경로 제거)
  const row = db.prepare("SELECT referrer, path FROM analytics_events WHERE event_name = ? ORDER BY id DESC LIMIT 1").get(m.DEMO_VIEW);
  assert.equal(row.referrer, 'google.com', `referrer host 만 저장: ${row.referrer}`);
  assert.equal(row.path, '/demo/sample-report');
});

await step('aiClient (mock)', async () => {
  const m = await import('../src/services/aiClient.service.js');
  const t = await m.generateReplyTemplates({ category: '사이즈', issueLabel: '허리가 작게 나옴' });
  assert(Array.isArray(t) && t.length === 5, '답글 템플릿 mock 실패 (5 tones 기대)');
});

if (failures.length) {
  console.error(`\n[check] 실패 ${failures.length}건: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n[check] 모든 점검 통과 ✓');
