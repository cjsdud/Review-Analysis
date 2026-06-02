// 분석 오케스트레이션: 분류 → 이슈 클러스터 → 상품별 리포트 → 전체 요약
import { nanoid } from 'nanoid';
import {
  applyReviewCorrections,
  classifyAll,
  FASHION_CATEGORIES,
  isRatingReliable,
  splitAspectAndIssue,
} from './reviewClassification.service.js';
import {
  PROMPT_VERSION,
  ANALYSIS_VERSION,
  reviewHash as makeReviewHash,
  selectLlmMode,
  shouldReanalyze,
} from './ai/index.js';
import { getCachedReviewAnalysis, saveReviewAnalysisCache } from './ai/cache.service.js';
import { recordLlmUsage } from './ai/usage.service.js';
import { buildIssueClusters } from './issueDetection.service.js';
import aiClient from './aiClient.service.js';
import {
  extractPositiveKeywords,
  extractFrequentKeywords,
  buildReviewTrends,
} from './keywordAnalysis.service.js';
import { buildReviewHighlights } from './reviewHighlights.service.js';

// 분석 의미가 있는 카테고리만 추림 (포괄 라벨 '기타' 제외, 긍정/중립 제외).
const meaningfulCategories = (c) =>
  (c.categories || []).filter(
    (cat) => cat.name && cat.name !== '기타' && cat.isActionableIssue !== false,
  );

// "사이즈 관련 의견" 처럼 카테고리명 + "관련 의견" 으로 끝나는 라벨
const GENERIC_LABEL_RE = /관련 의견$/;
const isGenericLabel = (label) => !label || GENERIC_LABEL_RE.test(label);

// 별점 + 텍스트 감성 기준으로 상품 상태 배지를 결정한다.
// 입력: { totalReviews, positiveRatio, negativeRatio, issueRatio }
// 출력: '만족도 높음' | '좋은데 고칠 점 있음' | '개선 우선' | '주의 필요' | '리뷰 부족' | '보통'
export function deriveProductStatus({ totalReviews, positiveRatio, negativeRatio, issueRatio }) {
  if (totalReviews < 10) return '리뷰 부족';
  if (negativeRatio >= 0.25) return '주의 필요';
  if (negativeRatio >= 0.15 && issueRatio >= 0.3) return '개선 우선';
  if (positiveRatio >= 0.75 && negativeRatio <= 0.1) return '만족도 높음';
  if (positiveRatio >= 0.7 && issueRatio >= 0.25) return '좋은데 고칠 점 있음';
  return '보통';
}

// 짧은 셀러 친화 해석 문구 — 규칙 기반(LLM 미사용).
function deriveProductInsight({ positiveRatio, negativeRatio, issueRatio }) {
  if (positiveRatio >= 0.75 && issueRatio < 0.2) {
    return '전체 만족도가 높은 상품입니다. 현재는 큰 개선 이슈보다 강점을 유지하는 것이 중요합니다.';
  }
  if (positiveRatio >= 0.7 && issueRatio >= 0.25) {
    return '전체 만족도는 높지만, 반복되는 개선 포인트가 있습니다. 상세페이지 안내를 보강하면 기대치 차이를 줄일 수 있습니다.';
  }
  if (negativeRatio >= 0.25) {
    return '부정 리뷰 비율이 높은 편입니다. 상품 품질, 상세페이지 안내, CS 대응을 우선 점검하는 것이 좋습니다.';
  }
  if (issueRatio >= 0.35) {
    return '개선 이슈가 여러 리뷰에서 반복됩니다. 먼저 고칠 상품으로 우선 검토하세요.';
  }
  return '특별히 두드러진 위험 신호는 없습니다. 카테고리별 세부 이슈를 참고해 작은 개선 포인트부터 점검해 보세요.';
}

// 비율은 소수 3자리로 통일.
const ratio3 = (a, b) => (b ? Number((a / b).toFixed(3)) : 0);

// 리뷰 → 감성 카운트 집계
function aggregateSentiment(classifications) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const c of classifications) {
    const s = c.sentiment || 'neutral';
    if (s === 'positive') counts.positive++;
    else if (s === 'negative') counts.negative++;
    else counts.neutral++;
  }
  const total = classifications.length;
  const ratios = {
    positive: ratio3(counts.positive, total),
    neutral: ratio3(counts.neutral, total),
    negative: ratio3(counts.negative, total),
  };
  return { counts, ratios };
}

// 리뷰 객체를 셀러에게 보여줄 마스킹된 형태로 변환 (분석 결과 안에 저장).
// classifications 의 categories 를 detectedIssues 로 함께 첨부한다.
// 마스킹 + 분류 정보 부착. productKey 를 명시적으로 함께 받아 review 객체에
// 넣어줘서, 프론트의 리뷰 모달이 상품명만으로 추측하지 않고 안정적으로 상품
// 상세 리포트 URL 을 만들 수 있게 한다. (productKey 는 현재 productName 과 같지만
// 향후 표기 통일/정규화 로 분리되어도 review → product 링크가 깨지지 않도록.)
function maskedReviewForProduct(review, classification, productKey) {
  const cats = (classification?.categories || []).map((cat) => ({
    category: cat.name,
    issue: cat.issue || null,
    severity: cat.severity || 'medium',
    issuePolarity: cat.issuePolarity || 'negative',
    isActionableIssue: cat.isActionableIssue !== false,
    confidence: cat.confidence ?? 0,
  }));
  return {
    id: review.id,
    productKey: productKey ?? review.productName,
    productName: review.productName,
    optionName: review.optionName || null,
    rating: review.rating ?? null,
    // ratingReliable=false 면 화면/export 에서 별점을 감성 신호로 신뢰하지 말도록
    // 함께 전달. 원본 값은 보존한다.
    ratingReliable: classification?.ratingReliable !== false,
    title: review.title || null,
    content: review.content || '',
    createdAt: review.createdAt || null,
    replyText: review.replyText || null,
    reviewId: review.reviewId || null,
    source: review.source || null,
    sentiment: classification?.sentiment || 'neutral',
    // 기존 detectedIssues 는 호환 위해 그대로 유지 — 다운스트림(차트/모달/export)이 사용 중.
    detectedIssues: cats,
    // 신규: 언급 vs 실제 개선 신호 분리. 반복 이슈/리포트는 improvementIssues 만 집계해야 한다.
    mentionedAspects: classification?.mentionedAspects || [],
    improvementIssues: classification?.improvementIssues || [],
  };
}

// 플랜 정책 기반 mini 재분석 — Pro/Business 만 활성. 캐시 + token usage 로깅 포함.
async function maybeMiniReanalyze({ classifications, reviewMap, planCode, userId, analysisId }) {
  const policy = selectLlmMode(planCode);
  if (!policy.allowMiniReanalysis) return; // Free/Starter 는 단계 자체 OFF
  // 후보 선별: shouldReanalyze 가 true 인 분류만.
  const candidates = [];
  for (const c of classifications) {
    const review = reviewMap.get(c.reviewId);
    const content = review?.content || '';
    if (shouldReanalyze(c, content, policy)) {
      candidates.push({ classification: c, content });
    }
  }
  if (!candidates.length) return;
  // 비율 상한 (maxMiniReanalysisRatio) — 비용 폭주 방지. 0.2 면 전체의 20% 까지만.
  const cap = Math.max(1, Math.ceil(classifications.length * (policy.maxMiniReanalysisRatio || 0)));
  const targets = candidates.slice(0, cap);
  const model = policy.precisionModel || 'gpt-5.4-mini';

  const reanalyze = []; // 캐시 miss 라 LLM 으로 보낼 항목만
  for (const t of targets) {
    const hash = makeReviewHash(t.content, PROMPT_VERSION);
    const cached = getCachedReviewAnalysis({
      reviewHash: hash, promptVersion: PROMPT_VERSION,
      analysisVersion: ANALYSIS_VERSION, model,
    });
    if (cached) {
      mergeMiniResult(t.classification, cached);
    } else {
      t.hash = hash;
      reanalyze.push(t);
    }
  }
  if (!reanalyze.length) return;

  // LLM 호출 — mock 환경에서는 aiClient 가 mock 응답으로 fallback. 실 호출 시에는
  // token usage 가 응답에 포함되지 않으면 0 으로 기록 (provider 응답 형식이 모델별
  // 로 다를 수 있어 방어적).
  const reqType = 'review_reanalysis';
  try {
    const llmResults = await aiClient.classifyAmbiguousReviews(
      reanalyze.map((t) => ({ id: t.classification.reviewId, content: t.content })),
      FASHION_CATEGORIES,
    );
    const usage = aiClient.lastUsage || {};
    recordLlmUsage({
      userId, analysisId, provider: aiClient.aiMode, model,
      promptVersion: PROMPT_VERSION, requestType: reqType,
      usage, status: 'ok',
    });
    const byId = new Map((llmResults || []).map((r) => [r.reviewId, r]));
    for (const t of reanalyze) {
      const r = byId.get(t.classification.reviewId);
      if (!r || !Array.isArray(r.categories) || r.categories.length === 0) continue;
      // nano 결과를 mini 결과로 덮어쓰되 schema 정규화.
      const newCategories = r.categories
        .filter((cat) => cat && cat.name)
        .map((cat) => ({
          name: FASHION_CATEGORIES.includes(cat.name) ? cat.name : '기타',
          issue: cat.issue || null,
          confidence: typeof cat.confidence === 'number' ? cat.confidence : 0.7,
          evidence: t.content.slice(0, 140),
          source: 'llm-mini',
          strength: 3,
          issuePolarity: cat.issuePolarity || 'negative',
          isActionableIssue: cat.isActionableIssue !== false,
          severity: cat.severity || 'medium',
        }));
      const split = splitAspectAndIssue(newCategories);
      const merged = {
        categories: newCategories,
        mentionedAspects: split.mentionedAspects,
        improvementIssues: split.improvementIssues,
      };
      mergeMiniResult(t.classification, merged);
      saveReviewAnalysisCache({
        reviewHash: t.hash, promptVersion: PROMPT_VERSION, analysisVersion: ANALYSIS_VERSION,
        provider: aiClient.aiMode, model, result: merged, userId, analysisId,
      });
    }
  } catch (e) {
    // 재분석 실패는 전체 분석을 깨뜨리면 안 된다 — 기존 nano 결과 유지 + 에러 로깅.
    recordLlmUsage({
      userId, analysisId, provider: aiClient.aiMode, model,
      promptVersion: PROMPT_VERSION, requestType: reqType,
      status: 'error', error: e.message,
    });
    console.warn('[reanalyze] mini 재분석 실패 — nano 결과 유지:', e.message);
  }
}

// mini 결과 → 기존 classification 에 덮어쓰기. 빈 결과면 유지.
function mergeMiniResult(classification, merged) {
  if (!merged || !Array.isArray(merged.categories) || merged.categories.length === 0) return;
  classification.categories = merged.categories;
  classification.mentionedAspects = merged.mentionedAspects || [];
  classification.improvementIssues = merged.improvementIssues || [];
  classification.ambiguous = false;
}

// 입력: reviews(ReviewNormalized[]), corrections([{productKey,original,corrected}] — 옵션),
//       opts: { planCode?, userId?, analysisId? } — 플랜 정책 + LLM usage 로깅에 사용
// 출력: { analysisId, summary, products, classifications }
export async function runAnalysis(reviews, corrections = [], opts = {}) {
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));

  // 배치 단위 rating 신뢰도 — 한 점수에 몰리거나 텍스트와 충돌하면 false 가 되어
  // 이후 감성 판정에서 rating 보조 신호가 꺼진다.
  const ratingReliable = isRatingReliable(reviews);
  const classifications = await classifyAll(reviews, aiClient, { ratingReliable });

  if (corrections && corrections.length) {
    applyReviewCorrections(reviews, classifications, corrections);
  }

  // 플랜의 LLM 정책에 따라 애매한 리뷰만 mini 모델로 재분석.
  //   - Free/Starter: policy.allowMiniReanalysis=false → 단계 자체 skip
  //   - Pro/Business: shouldReanalyze=true 인 항목 + maxMiniReanalysisRatio 이내만 호출
  // 캐시 hit 이면 LLM 호출 없이 result 사용, miss 면 호출 + 캐시 저장 + token usage 로깅.
  await maybeMiniReanalyze({
    classifications,
    reviewMap,
    planCode: opts.planCode || 'free',
    userId: opts.userId || null,
    analysisId: opts.analysisId || null,
  });

  const clusters = await buildIssueClusters(classifications, reviewMap, aiClient);

  const productNames = [...new Set(reviews.map((r) => r.productName))];
  const products = [];

  for (const productName of productNames) {
    const productReviews = reviews.filter((r) => r.productName === productName);
    const productCls = classifications.filter((c) => c.productName === productName);
    const productClusters = clusters.filter((cl) => cl.productName === productName);

    const total = productReviews.length;
    const negativeReviews = productCls.filter((c) => c.sentiment === 'negative').length;
    const negativeRatio = ratio3(negativeReviews, total);

    const sentiment = aggregateSentiment(productCls);
    const sentimentCounts = sentiment.counts;
    const sentimentRatios = sentiment.ratios;
    const positiveReviews = sentimentCounts.positive;
    const neutralReviews = sentimentCounts.neutral;

    const issueReviewCount = productCls.filter((c) => meaningfulCategories(c).length > 0).length;
    const totalIssueCount = productCls.reduce((s, c) => s + meaningfulCategories(c).length, 0);
    const issueRatio = ratio3(issueReviewCount, total);
    const ratings = productReviews.map((r) => r.rating).filter((n) => typeof n === 'number');
    const averageRating = ratings.length
      ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
      : undefined;

    // allIssues: 의미 있는 모든 actionable 이슈 클러스터(generic/'기타' 제외)
    const allIssues = productClusters
      .filter((cl) => cl.category && cl.category !== '기타' && !isGenericLabel(cl.issueLabel))
      .filter((cl) => cl.polarity !== 'positive' && cl.polarity !== 'neutral')
      .sort((a, b) => b.count - a.count || b.avgConfidence - a.avgConfidence)
      .map((cl, idx) => ({
        id: `${productName}__${cl.category}__${cl.issueLabel}__${idx}`,
        category: cl.category,
        issueLabel: cl.issueLabel,
        count: cl.count,
        ratio: ratio3(cl.count, total),
        confidence: cl.avgConfidence,
        severity: cl.severity || 'medium',
        polarity: cl.polarity || 'negative',
        source: cl.source,
        recommendedAction: cl.action,
        evidenceReviews: cl.evidenceReviews,
        reviewIds: cl.reviewIds || [],
      }));

    // topIssues: 상위 5 (UI 핵심 문제 카드)
    const topIssues = allIssues.slice(0, 5).map((iss) => ({
      category: iss.category,
      issueLabel: iss.issueLabel,
      count: iss.count,
      ratio: iss.ratio,
      confidence: iss.confidence,
      evidenceReviews: iss.evidenceReviews,
      recommendedAction: iss.recommendedAction,
      source: iss.source,
      severity: iss.severity,
      polarity: iss.polarity,
    }));

    const detailPageActions = [...new Set(topIssues.map((i) => i.recommendedAction).filter(Boolean))];

    const productStatus = deriveProductStatus({
      totalReviews: total,
      positiveRatio: sentimentRatios.positive,
      negativeRatio,
      issueRatio,
    });
    const productInsight = deriveProductInsight({
      positiveRatio: sentimentRatios.positive,
      negativeRatio,
      issueRatio,
    });

    // 4) LLM 요약
    const report = await aiClient.generateProductImprovementReport({
      productName,
      totalReviews: total,
      negativeReviews,
      negativeRatio,
      topIssues,
    });

    // 5) 답글 템플릿 — 상위 이슈별, polarity/actionable/severity 정보를 함께 넘김
    const replyTemplates = [];
    for (const iss of topIssues.slice(0, 3)) {
      const variants = await aiClient.generateReplyTemplates({
        category: iss.category,
        issueLabel: iss.issueLabel,
        recommendedAction: iss.recommendedAction,
        polarity: iss.polarity,
        isActionableIssue: true,
        severity: iss.severity,
      });
      if (variants && variants.length) replyTemplates.push({ issueLabel: iss.issueLabel, variants });
    }

    // 6) 마스킹된 리뷰 목록 (상세에서 사용)
    const clsById = new Map(productCls.map((c) => [c.reviewId, c]));
    const productReviewList = productReviews.map((r) => maskedReviewForProduct(r, clsById.get(r.id), productName));

    // 7) 키워드 + 추이 (신규)
    const positiveKeywords = extractPositiveKeywords(productReviews, productCls);
    const frequentKeywords = extractFrequentKeywords(productReviews, productCls);
    const reviewTrends = buildReviewTrends(productReviews, productCls);

    // 8) 상품 단위 리뷰 반응 요약 (긍정/중립/부정 themes + topReviews)
    //    전체 summary.reviewHighlights 와 별도 — 이 상품 리뷰만 입력.
    const reviewHighlights = buildReviewHighlights(productReviews, productCls);

    products.push({
      productKey: productName,
      productName,
      totalReviews: total,
      negativeReviews,
      negativeRatio,
      positiveReviews,
      neutralReviews,
      sentimentCounts,
      sentimentRatios,
      issueReviewCount,
      totalIssueCount,
      issueRatio,
      averageRating,
      productStatus,
      productInsight,
      topIssues,
      allIssues,
      detailPageActions: detailPageActions.length ? detailPageActions : report.detailPageActions || [],
      replyTemplates,
      summary: report.summary || '',
      reviews: productReviewList,
      // 신규 필드 (기존 필드는 그대로)
      positiveKeywords,
      frequentKeywords,
      reviewTrends,
      reviewHighlights,
      ratingReliable,
    });
  }

  // 7) 전체 요약 + 카테고리 분포
  const totalReviews = reviews.length;
  const overallSentiment = aggregateSentiment(classifications);
  const negativeReviews = overallSentiment.counts.negative;
  const positiveReviews = overallSentiment.counts.positive;
  const neutralReviews = overallSentiment.counts.neutral;
  const issueReviewCount = classifications.filter((c) => meaningfulCategories(c).length > 0).length;
  const totalIssueCount = classifications.reduce((s, c) => s + meaningfulCategories(c).length, 0);
  const issueRatio = ratio3(issueReviewCount, totalReviews);
  const allRatings = reviews.map((r) => r.rating).filter((n) => typeof n === 'number');
  const averageRating = allRatings.length
    ? Number((allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(2))
    : undefined;

  const categoryCount = Object.fromEntries(FASHION_CATEGORIES.map((c) => [c, 0]));
  for (const c of classifications) {
    const seen = new Set();
    for (const cat of c.categories) {
      if (!seen.has(cat.name)) {
        categoryCount[cat.name] = (categoryCount[cat.name] || 0) + 1;
        seen.add(cat.name);
      }
    }
  }
  const otherCount = categoryCount['기타'] || 0;
  const categoryDistribution = FASHION_CATEGORIES.map((name) => ({ name, count: categoryCount[name] || 0 })).filter(
    (c) => c.count > 0 && c.name !== '기타',
  );

  // "부정 리뷰가 많은 상품" 랭킹 — 리뷰가 너무 적은 상품이 비율만 높다고 1위가 되지
  // 않도록 최소 리뷰 수(MIN_REVIEWS) 가드. 동률은 부정 비율 > 전체 리뷰 수 순으로 tie-break.
  const MIN_REVIEWS_FOR_NEG_RANK = 5;
  const byNegative = [...products]
    .filter((p) => (p.totalReviews || 0) >= MIN_REVIEWS_FOR_NEG_RANK)
    .sort(
      (a, b) =>
        b.negativeReviews - a.negativeReviews ||
        (b.negativeRatio || 0) - (a.negativeRatio || 0) ||
        b.totalReviews - a.totalReviews,
    )
    .slice(0, 10);
  const byIssues = [...products]
    .sort((a, b) => b.issueReviewCount - a.issueReviewCount || b.totalIssueCount - a.totalIssueCount)
    .slice(0, 10);

  const overall = await aiClient.generateMonthlyReport({
    totalReviews,
    negativeReviews,
    negativeRatio: ratio3(negativeReviews, totalReviews),
    topCategories: [...categoryDistribution].sort((a, b) => b.count - a.count),
  });

  // 전체 키워드 TOP 10 — 모든 리뷰 기준으로 한 번 더 추출 (상품별과 별도 집계라 합산이 아닌 전역 매칭)
  const positiveKeywordsTop10All = extractPositiveKeywords(reviews, classifications);
  const frequentKeywordsTop10All = extractFrequentKeywords(reviews, classifications);
  const positiveKeywordsTop10 = positiveKeywordsTop10All.slice(0, 10).map((k) => ({
    keyword: k.keyword,
    count: k.count,
    ratio: k.ratio,
  }));
  const frequentKeywordsTop10 = frequentKeywordsTop10All.slice(0, 10).map((k) => ({
    keyword: k.keyword,
    count: k.count,
    ratio: k.ratio,
    sentimentHint: k.sentimentHint,
  }));

  const summary = {
    totalReviews,
    negativeReviews,
    positiveReviews,
    neutralReviews,
    sentimentCounts: overallSentiment.counts,
    sentimentRatios: overallSentiment.ratios,
    negativeRatio: ratio3(negativeReviews, totalReviews),
    issueReviewCount,
    totalIssueCount,
    issueRatio,
    averageRating,
    // 배치 단위 rating 신뢰도 — 셀러에게 "별점 그대로 믿지 마세요" 안내를 띄울 수 있는 신호.
    ratingReliable,
    productCount: productNames.length,
    categoryDistribution,
    otherCount,
    productRankingByNegative: byNegative.map((p) => ({
      productKey: p.productKey,
      productName: p.productName,
      negativeReviews: p.negativeReviews,
      negativeRatio: p.negativeRatio,
      totalReviews: p.totalReviews,
      // 부정 리뷰의 주요 카테고리(상위 1개) 만 미리 추출 — 카드 우측에 chip 1개로 노출.
      topNegativeCategory: (() => {
        const negCats = (p.topIssues || [])
          .filter((iss) => iss.polarity !== 'positive')
          .slice(0, 1)
          .map((iss) => iss.category);
        return negCats[0] || null;
      })(),
    })),
    productRankingByIssues: byIssues.map((p) => ({
      productKey: p.productKey,
      productName: p.productName,
      issueReviewCount: p.issueReviewCount,
      totalIssueCount: p.totalIssueCount,
      totalReviews: p.totalReviews,
    })),
    aiComment: overall.summary,
    aiMode: aiClient.aiMode,
    // 신규 필드
    positiveKeywordsTop10,
    frequentKeywordsTop10,
    reviewHighlights: buildReviewHighlights(reviews, classifications),
  };

  return { analysisId: nanoid(), summary, products, classifications };
}
