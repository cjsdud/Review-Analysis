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
import {
  computeEffectivePolicy,
  defaultAnalysisModeFor,
  getAnalysisMode,
} from '../constants/analysisModes.js';
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

// 리뷰 → 감성 카운트 집계. mixed 도 자체 버킷으로 — 기존 positive/neutral/negative
// 합산 비율 계산이 깨지지 않도록 ratios 도 4 키 모두 채운다. 프론트가 mixed 모르는
// 화면에서는 (positive+neutral+negative) 만 합쳐도 100% 가까이 나옴 (mixed 가 적을 때).
function aggregateSentiment(classifications) {
  const counts = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  for (const c of classifications) {
    const s = c.sentiment || 'neutral';
    if (s === 'positive') counts.positive++;
    else if (s === 'negative') counts.negative++;
    else if (s === 'mixed') counts.mixed++;
    else counts.neutral++;
  }
  const total = classifications.length;
  const ratios = {
    positive: ratio3(counts.positive, total),
    neutral: ratio3(counts.neutral, total),
    negative: ratio3(counts.negative, total),
    mixed: ratio3(counts.mixed, total),
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

// LLM 호출 1건마다 requestType 별 usage row 를 남기는 통일된 wrapper.
// aiClient.* 가 끝난 직후 lastUsage / lastCallStatus / lastCallModel 을 읽어
// llm_usage_logs 에 기록한다. mock/skipped 도 token=0 으로 일관 기록 — 관리자
// 콘솔에서 "이번 분석이 OpenAI 를 정말 호출했는가" 를 한눈에 보기 위함.
async function callWithUsage(fn, { requestType, role, userId, analysisId }) {
  const result = await fn();
  const provider = aiClient.aiMode;
  const status = aiClient.lastCallStatus;
  const usage = aiClient.lastUsage || {};
  const model = aiClient.lastCallModel || aiClient.modelForRole?.(role || 'review') || null;
  recordLlmUsage({
    userId, analysisId, provider, model,
    promptVersion: PROMPT_VERSION, analysisVersion: ANALYSIS_VERSION,
    requestType, usage,
    status: status === 'fallback' ? 'ok' : (status === 'skipped' ? 'ok' : 'ok'),
    openaiCalled: provider === 'openai' && status === 'ok',
    fallbackUsed: status === 'fallback' || (provider !== 'openai' && status !== 'skipped'),
    fallbackProvider: status === 'fallback' ? 'mock' : null,
    error: status === 'fallback' ? aiClient.lastCallError : null,
  });
  return result;
}

// 플랜 정책 기반 mini 재분석 — Pro/Business 만 활성. 캐시 + token usage 로깅 포함.
// 분석 단위 카운터(cacheHit, miss, miniReanalysis, openaiCalled, fallbackUsed) 를
// 반환해 runAnalysis 가 한 줄 분석 summary 로그를 남길 수 있게 한다.
async function maybeMiniReanalyze({ classifications, reviewMap, planCode, userId, analysisId }) {
  const stats = {
    candidateCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    miniReanalysisCount: 0,
    openaiCalled: false,
    fallbackUsed: false,
    fallbackProvider: null,
    model: null,
  };
  const policy = selectLlmMode(planCode);
  stats.model = policy.precisionModel || null;
  if (!policy.allowMiniReanalysis) return stats; // Free/Starter 는 단계 자체 OFF

  const candidates = [];
  for (const c of classifications) {
    const review = reviewMap.get(c.reviewId);
    const content = review?.content || '';
    if (shouldReanalyze(c, content, policy)) {
      candidates.push({ classification: c, content });
    }
  }
  stats.candidateCount = candidates.length;
  if (!candidates.length) return stats;

  const cap = Math.max(1, Math.ceil(classifications.length * (policy.maxMiniReanalysisRatio || 0)));
  const targets = candidates.slice(0, cap);
  const model = policy.precisionModel || 'gpt-5.4-mini';
  stats.model = model;

  const reanalyze = [];
  for (const t of targets) {
    const hash = makeReviewHash(t.content, PROMPT_VERSION);
    const cached = getCachedReviewAnalysis({
      reviewHash: hash, promptVersion: PROMPT_VERSION,
      analysisVersion: ANALYSIS_VERSION, model,
    });
    if (cached) {
      mergeMiniResult(t.classification, cached);
      stats.cacheHitCount++;
    } else {
      t.hash = hash;
      reanalyze.push(t);
      stats.cacheMissCount++;
    }
  }
  if (!reanalyze.length) return stats;

  const reqType = 'review_reanalysis';
  try {
    const llmResults = await aiClient.classifyAmbiguousReviews(
      reanalyze.map((t) => ({ id: t.classification.reviewId, content: t.content })),
      FASHION_CATEGORIES,
    );
    const provider = aiClient.aiMode;
    const usage = aiClient.lastUsage || {};
    // 정확한 판정: provider=openai 이고 마지막 호출이 ok 여야만 진짜 호출.
    // 429/timeout/parse_failed 면 fallback (호출은 시도 → mock 응답으로 떨어짐).
    const callStatus = aiClient.lastCallStatus;
    const callError = aiClient.lastCallError;
    stats.openaiCalled = provider === 'openai' && callStatus === 'ok';
    if (callStatus === 'fallback' || provider !== 'openai') {
      stats.fallbackUsed = true;
      stats.fallbackProvider = callStatus === 'fallback' ? 'mock' : provider;
    }
    stats.miniReanalysisCount = reanalyze.length;
    stats.errorMessage = callError;
    // 실제 호출 시 aiClient 가 ROLE='precision' 기반으로 모델을 골라 썼다.
    // env 가 override 했다면 그 모델이 lastCallModel 에 있다 — 그걸 우선 기록.
    const actualModel = aiClient.lastCallModel || model;
    recordLlmUsage({
      userId, analysisId, provider, model: actualModel,
      promptVersion: PROMPT_VERSION, analysisVersion: ANALYSIS_VERSION,
      requestType: reqType, usage, status: 'ok',
      openaiCalled: stats.openaiCalled,
      fallbackUsed: stats.fallbackUsed,
      fallbackProvider: stats.fallbackProvider,
      miniReanalysisCount: stats.miniReanalysisCount,
      cacheMissCount: stats.cacheMissCount,
      error: callError || null,
    });
    const byId = new Map((llmResults || []).map((r) => [r.reviewId, r]));
    for (const t of reanalyze) {
      const r = byId.get(t.classification.reviewId);
      if (!r) continue;
      // 새 schema (mentionedAspects / improvementIssues 분리) 우선. 둘 다 비어 있고
      // sentiment 도 없으면 mini 결과 의미 없음 — 기존 nano 결과 유지.
      const aspects = Array.isArray(r.mentionedAspects) ? r.mentionedAspects : [];
      const issues = Array.isArray(r.improvementIssues) ? r.improvementIssues : [];
      if (!r.sentiment && aspects.length === 0 && issues.length === 0) continue;

      // improvementIssues → 기존 categories[] 호환 형태로 복원.
      // mentionedAspects 는 categories 에 절대 넣지 않는다 (반복 이슈 차트 오염 방지).
      const newCategories = issues.map((iss) => ({
        name: FASHION_CATEGORIES.includes(iss.category) ? iss.category : (iss.category || '기타'),
        issue: iss.issueLabel || null,
        confidence: typeof iss.confidence === 'number' ? iss.confidence : (r.confidence ?? 0.7),
        evidence: (iss.evidence || t.content).slice(0, 140),
        source: 'llm-mini',
        strength: 3,
        issuePolarity: 'negative',
        isActionableIssue: true,
        severity: ['low', 'medium', 'high'].includes(iss.severity) ? iss.severity : 'medium',
      }));
      const merged = {
        sentiment: r.sentiment || null,
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
        categories: newCategories,
        mentionedAspects: aspects.map((a) => ({
          category: a.category,
          categoryLabel: a.categoryLabel || a.category,
          sentiment: a.sentiment || 'neutral',
        })),
        improvementIssues: issues.map((iss) => ({
          category: iss.category,
          categoryLabel: iss.categoryLabel || iss.category,
          issueLabel: iss.issueLabel,
          severity: iss.severity || 'medium',
          evidence: iss.evidence || '',
        })),
        needsReply: r.needsReply === true,
      };
      mergeMiniResult(t.classification, merged);
      saveReviewAnalysisCache({
        reviewHash: t.hash, promptVersion: PROMPT_VERSION, analysisVersion: ANALYSIS_VERSION,
        provider, model, result: merged, userId, analysisId,
      });
    }
  } catch (e) {
    stats.fallbackUsed = true;
    stats.fallbackProvider = 'error';
    recordLlmUsage({
      userId, analysisId, provider: aiClient.aiMode, model,
      promptVersion: PROMPT_VERSION, analysisVersion: ANALYSIS_VERSION,
      requestType: reqType, status: 'error', error: e.message,
      miniReanalysisCount: reanalyze.length, cacheMissCount: stats.cacheMissCount,
      fallbackUsed: true, fallbackProvider: 'error',
    });
    console.warn('[reanalyze] mini 재분석 실패 — nano 결과 유지:', e.message);
  }
  return stats;
}

// mini 결과 → 기존 classification 에 덮어쓰기. 둘 다 비어 있으면 유지.
// sentiment / confidence 가 들어오면 함께 갱신 — mini 모델의 재판단을 반영.
function mergeMiniResult(classification, merged) {
  if (!merged) return;
  const hasAspects = Array.isArray(merged.mentionedAspects) && merged.mentionedAspects.length > 0;
  const hasIssues = Array.isArray(merged.improvementIssues) && merged.improvementIssues.length > 0;
  // sentiment 도 categories 도 아무 의미 있는 값이 없으면 그대로 유지.
  if (!merged.sentiment && !hasAspects && !hasIssues) return;
  if (merged.sentiment) classification.sentiment = merged.sentiment;
  if (typeof merged.confidence === 'number') classification.confidence = merged.confidence;
  // categories 는 improvementIssues 기준만 — mentionedAspects 가 차트로 새는 것 방지.
  classification.categories = Array.isArray(merged.categories) ? merged.categories : [];
  classification.mentionedAspects = merged.mentionedAspects || [];
  classification.improvementIssues = merged.improvementIssues || [];
  classification.needsReply = merged.needsReply === true;
  classification.ambiguous = false;
}

// 입력: reviews(ReviewNormalized[]), corrections([{productKey,original,corrected}] — 옵션),
//       opts: { planCode?, userId?, analysisId? } — 플랜 정책 + LLM usage 로깅에 사용
// 출력: { analysisId, summary, products, classifications }
export async function runAnalysis(reviews, corrections = [], opts = {}) {
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));

  // progress reporter — 단계별로 호출자(runAnalysisJob) 에 비율(0~99)을 전달.
  // 같은 값 / 더 작은 값은 무시 → 절대 감소하지 않음. 호출 실패는 silently skip.
  let lastProgress = 5;
  async function reportProgress(p, step) {
    const safe = Math.max(lastProgress, Math.min(99, Math.round(p)));
    if (safe === lastProgress) return;
    lastProgress = safe;
    if (typeof opts.onProgress === 'function') {
      try { await opts.onProgress({ progress: safe, step }); } catch { /* ignore */ }
    }
  }
  await reportProgress(10, 'preprocessing');

  // 분석 방식 결정 — opts.analysisMode 가 없으면 플랜 기본값. plan 정책 + mode →
  // effectivePolicy 로 합쳐 이번 분석에서 어떤 LLM 단계가 실제로 켜질지 정한다.
  const planCode = opts.planCode || 'free';
  const analysisMode = opts.analysisMode || defaultAnalysisModeFor(planCode);
  const planPolicy = selectLlmMode(planCode);
  const effectivePolicy = computeEffectivePolicy(planPolicy, analysisMode);

  // 배치 단위 rating 신뢰도 — 한 점수에 몰리거나 텍스트와 충돌하면 false 가 되어
  // 이후 감성 판정에서 rating 보조 신호가 꺼진다.
  const ratingReliable = isRatingReliable(reviews);

  // 이 분석 전체에 걸쳐 발생하는 LLM 호출의 ok/fallback 카운트를 정확히 집계하기 위해
  // 세션 카운터를 리셋. classifyAll → buildIssueClusters → per-product report/reply →
  // generateMonthlyReport 까지 누적된다.
  if (typeof aiClient.resetSessionStats === 'function') aiClient.resetSessionStats();

  await reportProgress(25, 'classification_started');
  const classifications = await classifyAll(reviews, aiClient, { ratingReliable });
  await reportProgress(45, 'classification_done');

  if (corrections && corrections.length) {
    applyReviewCorrections(reviews, classifications, corrections);
  }

  // 플랜의 LLM 정책에 따라 애매한 리뷰만 mini 모델로 재분석.
  //   - Free/Starter: policy.allowMiniReanalysis=false → 단계 자체 skip
  //   - Pro/Business: shouldReanalyze=true 인 항목 + maxMiniReanalysisRatio 이내만 호출
  // 캐시 hit 이면 LLM 호출 없이 result 사용, miss 면 호출 + 캐시 저장 + token usage 로깅.
  // mini 재분석은 effectivePolicy.allowMiniReanalysis 가 true 일 때만. plan policy
  // 가 허용해도 사용자가 quick/standard/batch 를 골랐으면 false 가 되어 OFF.
  const reanalyzeStats = effectivePolicy.allowMiniReanalysis
    ? await maybeMiniReanalyze({
        classifications,
        reviewMap,
        planCode,
        userId: opts.userId || null,
        analysisId: opts.analysisId || null,
      })
    : { cacheHitCount: 0, cacheMissCount: 0, miniReanalysisCount: 0, openaiCalled: false, fallbackUsed: false, fallbackProvider: null, model: null };

  // 운영 진단용 첫 줄 — 호출 *전* 환경/플랜/모드만 출력. 호출 결과는 끝나고 sessionStats 로.
  const policy = planPolicy;
  console.info('[ReviewFit AI] provider=' + aiClient.aiMode);
  console.info('[ReviewFit AI] mode=' + analysisMode + ' (label=' + (getAnalysisMode(analysisMode)?.label || '?') + ')');
  console.info('[ReviewFit AI] plan=' + planCode + ' llmMode=' + policy.mode);
  console.info('[ReviewFit AI] reviewModel=' + policy.reviewModel);
  console.info('[ReviewFit AI] summaryModel=' + policy.summaryModel);
  console.info('[ReviewFit AI] precisionModel=' + (policy.precisionModel || 'none'));
  console.info('[ReviewFit AI] promptVersion=' + PROMPT_VERSION);
  console.info('[ReviewFit AI] analysisVersion=' + ANALYSIS_VERSION);
  console.info('[ReviewFit AI] reviewCount=' + reviews.length);
  console.info(
    '[ReviewFit AI] cacheHit=' + reanalyzeStats.cacheHitCount +
    ' cacheMiss=' + reanalyzeStats.cacheMissCount,
  );
  console.info('[ReviewFit AI] miniReanalysisCount=' + reanalyzeStats.miniReanalysisCount);

  await reportProgress(55, 'mini_reanalysis_done');
  const clusters = await buildIssueClusters(classifications, reviewMap, aiClient);
  await reportProgress(60, 'clusters_built');

  const productNames = [...new Set(reviews.map((r) => r.productName))];
  const products = [];
  // 상품 루프 — 매 5상품마다 또는 마지막에 진행률 업데이트. 60% → 85% 구간.
  let productIdx = 0;
  const productCount = productNames.length || 1;

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

    // 4) 상품 요약 — analysisMode 가 quick 이면 LLM 호출 스킵 (룰 기반 fallback).
    const report = effectivePolicy.usesProductSummaryLlm
      ? await callWithUsage(
          () => aiClient.generateProductImprovementReport({
            productName, totalReviews: total, negativeReviews, negativeRatio, topIssues,
          }),
          { requestType: 'product_summary', role: 'summary', userId: opts.userId || null, analysisId: opts.analysisId || null },
        )
      : { detailPageActions: [], summary: '' };

    // 5) CS 답글 — analysisMode 가 quick/batch 면 OFF.
    const replyTemplates = [];
    if (effectivePolicy.usesCsReplyLlm) {
      for (const iss of topIssues.slice(0, 3)) {
        const variants = await callWithUsage(
          () => aiClient.generateReplyTemplates({
            category: iss.category, issueLabel: iss.issueLabel,
            recommendedAction: iss.recommendedAction, polarity: iss.polarity,
            isActionableIssue: true, severity: iss.severity,
          }),
          { requestType: 'cs_reply', role: 'csReply', userId: opts.userId || null, analysisId: opts.analysisId || null },
        );
        if (variants && variants.length) replyTemplates.push({ issueLabel: iss.issueLabel, variants });
      }
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
    productIdx++;
    // 상품 루프 진행률 — 5 상품마다 또는 마지막에 보고. 60% + 0~25% × ratio.
    if (productIdx % 5 === 0 || productIdx === productCount) {
      await reportProgress(60 + (productIdx / productCount) * 25, 'product_summaries');
    }
  }
  await reportProgress(85, 'overall_summary_started');

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

  // 전체 요약 — quick 모드는 OFF. 룰 기반 짧은 fallback 만 제공.
  const overall = effectivePolicy.usesOverallSummaryLlm
    ? await callWithUsage(
        () => aiClient.generateMonthlyReport({
          totalReviews,
          negativeReviews,
          negativeRatio: ratio3(negativeReviews, totalReviews),
          topCategories: [...categoryDistribution].sort((a, b) => b.count - a.count),
        }),
        { requestType: 'report_summary', role: 'summary', userId: opts.userId || null, analysisId: opts.analysisId || null },
      )
    : { summary: '리뷰 반응 기본 흐름을 정리했어요. 더 자세한 요약은 기본 분석 이상에서 제공됩니다.' };
  await reportProgress(92, 'finalizing');

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
    // 사용자/관리자가 리포트 상단/히스토리에서 "이 분석이 어떤 방식이었는지" 확인할 수 있게 동봉.
    // 관리자만 보는 effectivePolicy 도 함께 (일반 사용자 UI 는 analysisMode 만 노출).
    analysisMode,
    analysisModeLabel: getAnalysisMode(analysisMode)?.label || null,
    effectivePolicy,
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

  // 모든 LLM 호출이 끝난 후 — 정확한 누적 통계로 analysis_summary row + 콘솔 한 줄.
  const session = aiClient.sessionStats || { realCalls: 0, fallbacks: 0, lastError: null };
  const realCallSucceeded = session.realCalls > 0;
  const anyFallback = session.fallbacks > 0 || (aiClient.aiMode === 'openai' && !realCallSucceeded);
  const summaryRow = {
    userId: opts.userId || null,
    analysisId: opts.analysisId || null,
    provider: aiClient.aiMode,
    model: reanalyzeStats.model || null,
    promptVersion: PROMPT_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    requestType: 'analysis_summary',
    reviewCount: reviews.length,
    cacheHitCount: reanalyzeStats.cacheHitCount,
    cacheMissCount: reanalyzeStats.cacheMissCount,
    miniReanalysisCount: reanalyzeStats.miniReanalysisCount,
    openaiCalled: aiClient.aiMode === 'openai' && realCallSucceeded,
    fallbackUsed: anyFallback,
    fallbackProvider: anyFallback ? 'mock' : null,
    error: session.lastError || null,
  };
  recordLlmUsage(summaryRow);
  console.info('[ReviewFit AI] openaiCalled=' + summaryRow.openaiCalled +
    ' realCalls=' + session.realCalls + ' fallbacks=' + session.fallbacks);
  if (summaryRow.fallbackUsed) {
    console.info('[ReviewFit AI] fallbackUsed=true reason=' + (session.lastError || 'unknown'));
  }

  // opts.analysisId 가 주어지면 그대로 — 비동기 job 흐름에서 pending row 가
  // 먼저 만들어졌을 때 id 가 일치해야 한다. 없으면 새로 생성 (legacy).
  const analysisId = opts.analysisId || nanoid();
  return { analysisId, summary, products, classifications };
}
