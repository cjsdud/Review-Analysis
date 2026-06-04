// 운영 데이터 회귀 검증 스크립트.
// 실제 엑셀 파일(첫 인자) 의 모든 리뷰를 classifyReview 로 돌려 다음 지표를 출력:
//
//   - rating <=2 + 강한 긍정 표현 리뷰 중 negative 로 남은 비율
//   - 가격 양보 표현 리뷰의 sentiment 분포
//   - 사이즈 방향 표현 리뷰의 추천 조치 방향 정확도
//   - T2 케이스(고정) 의 현재 결과
//
// 실행: node backend/scripts/check-review-classification-regression.js path/to/file.xlsx
// 인자가 없으면 backend/data/sample-reviews.json 또는 내장 mini 샘플 사용.
//
// 개인정보/리뷰 원문 전체를 로그에 출력하지 않는다. 실패 사례는 reviewId 와 evidence
// 앞부분(60자) 정도만 표시.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyReview, hasPriceConcession } from '../src/services/reviewClassification.service.js';
import { detectSizeDirection } from '../src/services/ai/sizeDirection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 내장 mini 샘플 — 인자 미지정 시 사용. 운영 환경에선 실제 엑셀을 인자로 지정.
const INLINE_SAMPLE = [
  { id: 'S1', rating: 2, content: '이건 완전 멋지 전투용 바지임 비싸긴해도 돈값을 함 가격이 비쌈' },
  { id: 'S2', rating: 3, content: '한여름말고는 입기 좋을거같아요 2사이즈는 너무딱맞네요 크게 3사이즈갈걸 그랬나봐요' },
  { id: 'S3', rating: 5, content: '비싸지만 퀄리티가 좋아서 만족합니다' },
  { id: 'S4', rating: 4, content: '가격은 좀 있지만 재구매 의사 있습니다' },
  { id: 'S5', rating: 1, content: '비싼데 품질도 별로고 돈 아까워요' },
  { id: 'S6', rating: 2, content: '가격 대비 별로예요' },
  { id: 'S7', rating: 4, content: '비싸긴 한데 그래도 계속 사게 됩니다' },
  { id: 'S8', rating: 3, content: '허리가 너무 크고 품도 넉넉해서 한 치수 작게 갈 걸 그랬어요' },
  { id: 'S9', rating: 5, content: '핏 좋고 재질도 좋아요 다음에도 살 것 같아요' },
  { id: 'S10', rating: 1, content: '불량이라 못 입겠어요 환불하고 싶습니다' },
];

async function loadReviews(filePath) {
  if (!filePath) return INLINE_SAMPLE;
  if (filePath.endsWith('.json')) {
    const j = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(j) ? j : (Array.isArray(j.reviews) ? j.reviews : INLINE_SAMPLE);
  }
  if (filePath.endsWith('.xlsx') || filePath.endsWith('.csv')) {
    const { parseFile } = await import('../src/services/fileParser.service.js');
    const buf = fs.readFileSync(filePath);
    const parsed = await parseFile(buf, path.basename(filePath));
    // 헤더 자동 추정 — '리뷰내용' / '내용' / 'content' / 'review' 시도.
    const contentKey = parsed.headers.find((h) => /리뷰|후기|내용|content|review/i.test(h)) || parsed.headers[0];
    const ratingKey = parsed.headers.find((h) => /별점|평점|rating/i.test(h));
    return parsed.rows.map((r, i) => ({
      id: r.id || r.reviewId || `r${i}`,
      content: String(r[contentKey] || '').trim(),
      rating: ratingKey ? Number(r[ratingKey]) || null : null,
    })).filter((r) => r.content);
  }
  return INLINE_SAMPLE;
}

// 강한 긍정 표현 — 회귀 검증용 (rule 의 POS_TERMS/CLEAR_SATISFACTION 과 별개로 큰 시그널만).
const STRONG_POS_RE = /(완전\s*멋|너무\s*좋|만족|돈값|값어치|재구매|또\s*살|계속\s*사|여기서만|추천|마음에\s*들|예쁘|이쁘)/;

function pct(n, total) { if (!total) return '0.0%'; return `${((n / total) * 100).toFixed(1)}%`; }
function summarize(label, rows) {
  const buckets = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  for (const r of rows) buckets[r.sentiment] = (buckets[r.sentiment] || 0) + 1;
  return { label, total: rows.length, ...buckets };
}

async function main() {
  const [, , filePath] = process.argv;
  const reviews = await loadReviews(filePath);
  console.log(`[Regression] loaded ${reviews.length} reviews from ${filePath || '(inline sample)'}\n`);

  const classified = reviews.map((r) => ({ ...r, ...classifyReview({ id: r.id, productName: 'P', content: r.content, rating: r.rating }) }));

  // 1) rating <=2 + 강한 긍정
  const lowRatingStrongPos = classified.filter((r) => r.rating != null && r.rating <= 2 && STRONG_POS_RE.test(r.content));
  const stillNeg = lowRatingStrongPos.filter((r) => r.sentiment === 'negative');
  console.log(`[Regression] rating<=2 + strong positive: ${lowRatingStrongPos.length}`);
  console.log(`[Regression]   still negative: ${stillNeg.length} (${pct(stillNeg.length, lowRatingStrongPos.length)})`);

  // 2) 가격 양보 표현
  const concession = classified.filter((r) => hasPriceConcession(r.content));
  const concSum = summarize('price concession', concession);
  const concPosMixed = concession.filter((r) => r.sentiment === 'positive' || r.sentiment === 'mixed').length;
  console.log(`[Regression] price concession reviews: ${concSum.total}`);
  console.log(`[Regression]   positive/mixed: ${concPosMixed} (${pct(concPosMixed, concSum.total)})`);
  console.log(`[Regression]   distribution: pos=${concSum.positive} neu=${concSum.neutral} neg=${concSum.negative} mix=${concSum.mixed}`);

  // 3) "비쌈" 단독 (양보 표현 없음)
  const expensiveOnly = classified.filter((r) => /비싸|비쌈/.test(r.content) && !hasPriceConcession(r.content));
  const eoSum = summarize('expensive only', expensiveOnly);
  console.log(`[Regression] 'expensive only' (no concession): ${eoSum.total}`);
  console.log(`[Regression]   distribution: pos=${eoSum.positive} neu=${eoSum.neutral} neg=${eoSum.negative} mix=${eoSum.mixed}`);

  // 4) 사이즈 방향 정확도 — 추천 액션이 evidence 와 반대가 아닌지.
  const upsizeRev = classified.filter((r) => detectSizeDirection(r.content) === 'upsize');
  const downsizeRev = classified.filter((r) => detectSizeDirection(r.content) === 'downsize');
  // 액션 텍스트는 rule classification 의 categories[].action 에 들어 있음.
  function actionText(r) { return (r.categories || []).map((c) => c.action || '').join(' '); }
  const wrongDown = upsizeRev.filter((r) => /다운|작게 선택|한\s*치수\s*작/.test(actionText(r)));
  const wrongUp = downsizeRev.filter((r) => /한\s*치수\s*크|크게 선택|업\s*추천/.test(actionText(r)));
  console.log(`[Regression] upsize-direction reviews: ${upsizeRev.length}`);
  console.log(`[Regression]   wrong downsize actions: ${wrongDown.length}`);
  if (wrongDown.length) {
    for (const r of wrongDown.slice(0, 5)) console.log(`     - id=${r.id} evidence="${r.content.slice(0, 60)}"`);
  }
  console.log(`[Regression] downsize-direction reviews: ${downsizeRev.length}`);
  console.log(`[Regression]   wrong upsize actions: ${wrongUp.length}`);
  if (wrongUp.length) {
    for (const r of wrongUp.slice(0, 5)) console.log(`     - id=${r.id} evidence="${r.content.slice(0, 60)}"`);
  }

  // 5) T2 고정 케이스
  const t2 = classified.find((r) => r.content.includes('한여름말고는 입기 좋을거같아요'));
  if (t2) {
    const labels = (t2.categories || []).map((c) => c.issue).join(' | ');
    console.log(`[Regression] T2 sentiment=${t2.sentiment} labels="${labels}"`);
  }

  // 전체 sentiment 분포
  const all = summarize('all', classified);
  console.log(`\n[Regression] overall: pos=${all.positive} neu=${all.neutral} neg=${all.negative} mix=${all.mixed} (total=${all.total})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
