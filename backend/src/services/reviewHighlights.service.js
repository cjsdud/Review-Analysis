// 대시보드 "리뷰 내용 요약" — sentiment 별로 topReviews + themes 를 생성한다.
// productAnalysis.service.js 의 summary 에 reviewHighlights 필드로 첨부된다.
//
// 원칙:
//   - 모든 리뷰 데이터는 이미 마스킹된 상태 (normalizeReview 단계에서 처리됨).
//   - 별점 우선 + 텍스트 sentiment 보조 (sentiment 가 'positive' 인데 분류기가 issue 를 잡았어도 긍정).
//   - 한 리뷰가 긍정 topReviews 에 있으면서 동시에 issueReviewCount 에 포함될 수 있음 (개념 분리).
//   - themes 는 키워드 매칭(extractPositiveKeywords / extractFrequentKeywords) 결과를 sentiment 별로 분배.
//
// 출력 구조:
//   { positive: { total, ratio, topReviews: [...], themes: [...] }, negative: {...}, neutral: {...} }
import { extractPositiveKeywords, extractFrequentKeywords } from './keywordAnalysis.service.js';

const TOP_REVIEWS_PER_SENTIMENT = 5;
const TOP_THEMES_PER_SENTIMENT = 5;
const MIN_CONTENT_LEN = 10;
const MAX_CONTENT_LEN_FOR_SUMMARY = 200;

// "사이즈가 작아요", "색상이 화면과 달라요" 같은 부정 테마 라벨 매핑.
// extractFrequentKeywords 에서 잡힌 raw 라벨을 사용자 친화 표현으로 다시 가공한다.
const NEGATIVE_THEME_RULES = [
  { label: '사이즈가 작아요', patterns: ['작아', '작게', '타이트', '낑', '꽉 끼', '꽉 껴', '한 치수 크게'] },
  { label: '사이즈가 커요',   patterns: ['커요', '커서', '크게 나', '헐렁', '넉넉', '벙벙', '한 치수 작게', '사이즈 다운'] },
  { label: '색상이 화면과 달라요', patterns: ['색이 달라', '색상이 달라', '색감이 달라', '톤이 달라', '실물이 다', '색 차이', '색상 차이', '화면보다 어두', '화면보다 밝', '사진보다 어두', '사진보다 밝', '사진과 다', '색상이 너무 어둡', '색상이 너무 밝', '색상이 어두워', '색상이 밝아'] },
  { label: '원단이 얇아요',   patterns: ['얇아', '얇고', '얇은', '얇네', '얇어'] },
  { label: '비침이 있어요',   patterns: ['비침', '비쳐', '속이 보', '속옷이 보'] },
  { label: '마감이 아쉬워요', patterns: ['마감 아쉬', '마감이 아쉬', '실밥', '박음질이 삐뚤', '봉제'] },
  { label: '배송이 느려요',   patterns: ['배송 늦', '배송이 늦', '배송이 느', '도착이 늦', '늦게 도착', '늦게 와', '늦게 옴'] },
  { label: '포장이 아쉬워요', patterns: ['포장 구', '포장이 구', '포장 부실', '구겨져', '구김'] },
  { label: '세탁 후 변형이 있어요', patterns: ['줄어', '늘어', '쭈그', '수축', '변형', '틀어'] },
  { label: '가격 대비 아쉬워요', patterns: ['가격 대비 아쉬', '가격 대비 별로', '가격대비 아쉬', '비싼데', '돈 아까', '돈이 아깝'] },
  { label: '착용감이 불편해요', patterns: ['불편', '답답', '쓸려', '쓸린', '배기', '갑갑'] },
  { label: '상세페이지 정보가 부족해요', patterns: ['상세페이지', '정보가 부족', '안내가 부족', '설명이 부족'] },
];

const POSITIVE_THEME_RULES = [
  { label: '사이즈가 잘 맞아요',     patterns: ['사이즈 잘 맞', '딱 맞', '정사이즈', '잘 맞아', '잘 맞고', '잘 맞습'] },
  { label: '핏이 예뻐요',           patterns: ['핏이 예쁘', '핏이 이쁘', '핏 예쁘', '핏 이쁘', '라인이 예쁘', '맵시', '핏감 좋'] },
  { label: '색상이 마음에 들어요',   patterns: ['색감 좋', '색이 예쁘', '색이 이쁘', '컬러 예쁘', '톤이 예쁘', '색상이 마음', '색 마음'] },
  { label: '소재가 좋아요',         patterns: ['재질이 좋', '재질 좋', '소재가 좋', '소재 좋', '원단이 좋', '원단 좋', '원단 탄탄'] },
  { label: '가격 대비 만족해요',     patterns: ['가성비 좋', '가격 대비 좋', '가격대비 좋', '가격 대비 만족', '가격 생각하면', '이 가격에'] },
  { label: '배송이 빨라요',         patterns: ['배송 빠르', '배송이 빠르', '빠른 배송', '빨리 왔', '빨리 도착', '하루 만에'] },
  { label: '마감이 괜찮아요',       patterns: ['마감 좋', '마감이 좋', '마감 깔끔', '박음질 좋', '꼼꼼하게', '실밥 없', '실밥이 없'] },
  { label: '재구매 의사가 있어요',   patterns: ['재구매', '또 사고', '더 사고', '다음에도', '색상별로 더'] },
  { label: '착용감이 편해요',       patterns: ['편해요', '편하고', '편합니', '편하게', '편안', '착용감 좋', '입기 편'] },
  { label: '상세페이지와 비슷해요',  patterns: ['상세페이지와 비슷', '사진과 같', '사진과 비슷', '실물 같', '실물이 같'] },
];

const NEUTRAL_THEME_RULES = [
  { label: '전반적으로 무난해요',         patterns: ['무난', '괜찮은 편', '나쁘지 않', '쓸 만', '쓸만'] },
  { label: '장점과 아쉬움이 함께 있어요', patterns: ['장점은', '아쉬운 점은', '아쉬운 부분은', '단점은', '~지만'] },
  { label: '개인 취향에 따라 다를 수 있어요', patterns: ['취향에 따라', '취향이', '개인 차', '사람마다'] },
  { label: '기대와 조금 다르지만 사용할 만해요', patterns: ['기대와 다', '기대보다', '예상과 다', '예상보다'] },
];

function textOf(r) {
  return `${r.title || ''} ${r.content || ''}`;
}

// 한 리뷰에서 매칭되는 테마 라벨들. 한 리뷰가 너무 많은 테마에 걸리지 않도록 상한 적용.
function matchThemes(text, rules, maxPerReview = 3) {
  const out = [];
  for (const rule of rules) {
    if (rule.patterns.some((p) => text.includes(p))) out.push(rule);
    if (out.length >= maxPerReview) break;
  }
  return out;
}

// sentiment 별로 themes + 대표 리뷰 examples 생성
function buildThemes(reviewsOfSentiment, rules, sentimentLabel) {
  const tallies = new Map(); // label → { count, exReviews: [...] }
  for (const r of reviewsOfSentiment) {
    const text = textOf(r);
    if (!text.trim()) continue;
    for (const rule of matchThemes(text, rules)) {
      const e = tallies.get(rule.label) || { count: 0, exReviews: [] };
      e.count++;
      e.exReviews.push(r);
      tallies.set(rule.label, e);
    }
  }
  const themes = [];
  for (const rule of rules) {
    const e = tallies.get(rule.label);
    if (!e || e.count === 0) continue;
    // 대표 예문 1~3개: 길이 적당하고 (긍정이면 별점 높은 순, 부정이면 별점 낮은 순) 정렬
    const examples = [...e.exReviews]
      .sort((a, b) => {
        const al = (a.content || '').length;
        const bl = (b.content || '').length;
        const aGood = al >= 20 && al <= 200 ? 0 : 1;
        const bGood = bl >= 20 && bl <= 200 ? 0 : 1;
        if (aGood !== bGood) return aGood - bGood;
        if (sentimentLabel === 'positive') return (b.rating ?? 0) - (a.rating ?? 0);
        if (sentimentLabel === 'negative') return (a.rating ?? 5) - (b.rating ?? 5);
        return 0;
      })
      .slice(0, 3)
      .map((r) => {
        const c = r.content || '';
        return c.length > MAX_CONTENT_LEN_FOR_SUMMARY ? `${c.slice(0, MAX_CONTENT_LEN_FOR_SUMMARY)}…` : c;
      });
    themes.push({
      label: rule.label,
      count: e.count,
      sentiment: sentimentLabel,
      examples,
    });
  }
  return themes.sort((a, b) => b.count - a.count).slice(0, TOP_THEMES_PER_SENTIMENT);
}

// 대표 topReviews 선별 — sentiment 별로 길이 적당하고 내용이 있는 리뷰 우선.
function pickTopReviews(reviewsOfSentiment, classifications, sentimentLabel, max = TOP_REVIEWS_PER_SENTIMENT) {
  const clsById = new Map((classifications || []).map((c) => [c.reviewId, c]));
  const candidates = reviewsOfSentiment.filter((r) => (r.content || '').length >= MIN_CONTENT_LEN);
  const sorted = [...candidates].sort((a, b) => {
    const al = (a.content || '').length;
    const bl = (b.content || '').length;
    const aGood = al >= 30 && al <= 250 ? 0 : 1;
    const bGood = bl >= 30 && bl <= 250 ? 0 : 1;
    if (aGood !== bGood) return aGood - bGood;
    if (sentimentLabel === 'positive') {
      if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) - (a.rating ?? 0);
    } else if (sentimentLabel === 'negative') {
      if ((a.rating ?? 5) !== (b.rating ?? 5)) return (a.rating ?? 5) - (b.rating ?? 5);
    }
    // 최신순 보조 정렬
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  return sorted.slice(0, max).map((r) => {
    const c = clsById.get(r.id);
    const cats = (c?.categories || []).map((cat) => ({
      category: cat.name,
      issue: cat.issue || null,
      severity: cat.severity || 'medium',
      issuePolarity: cat.issuePolarity || 'negative',
      isActionableIssue: cat.isActionableIssue !== false,
    }));
    return {
      id: r.id,
      // productKey 는 현재 productName 과 같지만, 프론트의 리뷰 모달이 안정적인
      // 라우팅 키를 쓰도록 명시적으로 함께 내려준다.
      productKey: r.productName,
      productName: r.productName,
      optionName: r.optionName || null,
      rating: r.rating ?? null,
      title: r.title || null,
      content: (r.content || '').slice(0, MAX_CONTENT_LEN_FOR_SUMMARY),
      createdAt: r.createdAt || null,
      sentiment: sentimentLabel,
      detectedIssues: cats,
      source: r.source || null,
    };
  });
}

// sentiment 판정 — classification.sentiment 우선, 없으면 별점 기반.
function sentimentOf(review, classification) {
  if (classification?.sentiment) return classification.sentiment;
  if (typeof review.rating === 'number') {
    if (review.rating <= 2) return 'negative';
    if (review.rating === 3) return 'neutral';
    return 'positive';
  }
  return 'neutral';
}

const ratio3 = (a, b) => (b ? Number((a / b).toFixed(3)) : 0);

// 메인 진입점: 모든 리뷰 + classifications 로 sentiment 별 highlights 생성.
export function buildReviewHighlights(reviews, classifications) {
  const total = reviews.length || 1;
  const clsById = new Map((classifications || []).map((c) => [c.reviewId, c]));

  // sentiment 그룹화
  const groups = { positive: [], neutral: [], negative: [] };
  for (const r of reviews) {
    const s = sentimentOf(r, clsById.get(r.id));
    if (s === 'positive') groups.positive.push(r);
    else if (s === 'negative') groups.negative.push(r);
    else groups.neutral.push(r);
  }

  const out = {};
  for (const [sentiment, list] of Object.entries(groups)) {
    const count = list.length;
    out[sentiment] = {
      total: count,
      ratio: ratio3(count, total),
      topReviews: pickTopReviews(list, classifications, sentiment),
      themes: buildThemes(
        list,
        sentiment === 'positive' ? POSITIVE_THEME_RULES
          : sentiment === 'negative' ? NEGATIVE_THEME_RULES
          : NEUTRAL_THEME_RULES,
        sentiment,
      ),
    };
  }
  return out;
}

// 전체 보기 API 에서 사용할 단순 리뷰 직렬화 (sentiment + detectedIssues 첨부)
export function serializeReviewForList(review, classification) {
  const cats = (classification?.categories || []).map((cat) => ({
    category: cat.name,
    issue: cat.issue || null,
    severity: cat.severity || 'medium',
    issuePolarity: cat.issuePolarity || 'negative',
    isActionableIssue: cat.isActionableIssue !== false,
  }));
  return {
    id: review.id,
    productKey: review.productName,
    productName: review.productName,
    optionName: review.optionName || null,
    rating: review.rating ?? null,
    title: review.title || null,
    content: review.content || '',
    createdAt: review.createdAt || null,
    sentiment: classification?.sentiment || sentimentOf(review, classification),
    detectedIssues: cats,
    source: review.source || null,
  };
}

// 외부에서 sentiment 판정 재사용 (analysis routes 에서 reviews 필터링 시)
export { sentimentOf };
