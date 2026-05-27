// 분석 오케스트레이션: 분류 → 이슈 클러스터 → 상품별 리포트 → 전체 요약
import { nanoid } from 'nanoid';
import { classifyAll, FASHION_CATEGORIES } from './reviewClassification.service.js';
import { buildIssueClusters } from './issueDetection.service.js';
import aiClient from './aiClient.service.js';

// 입력: reviews(ReviewNormalized[]) — 정규화·마스킹 완료된 리뷰 배열
// 출력: { analysisId, summary(전체 지표/분포/랭킹), products(ProductAnalysis[]), classifications }
export async function runAnalysis(reviews) {
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));

  // 1) 멀티라벨 분류 (규칙 + 애매한 부정 리뷰만 LLM)
  const classifications = await classifyAll(reviews, aiClient);

  // 2) 상품·카테고리·세부이슈 클러스터 + 근거 리뷰 선별
  const clusters = await buildIssueClusters(classifications, reviewMap, aiClient);

  // 3) 상품별 집계
  const productNames = [...new Set(reviews.map((r) => r.productName))];
  const products = [];

  for (const productName of productNames) {
    const productReviews = reviews.filter((r) => r.productName === productName);
    const productCls = classifications.filter((c) => c.productName === productName);
    const productClusters = clusters.filter((cl) => cl.productName === productName);

    const negativeReviews = productCls.filter((c) => c.sentiment === 'negative').length;
    const total = productReviews.length;
    const negativeRatio = total ? Number((negativeReviews / total).toFixed(3)) : 0;
    // 지표 분리: 별점/감성 부정 vs 개선 이슈 발견
    const issueReviewCount = productCls.filter((c) => c.categories.length > 0).length;
    const totalIssueCount = productCls.reduce((s, c) => s + c.categories.length, 0);
    const issueRatio = total ? Number((issueReviewCount / total).toFixed(3)) : 0;
    const ratings = productReviews.map((r) => r.rating).filter((n) => typeof n === 'number');
    const averageRating = ratings.length
      ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
      : undefined;

    // topIssues: count 우선, 동률이면 평균 신뢰도
    const topIssues = productClusters
      .sort((a, b) => b.count - a.count || b.avgConfidence - a.avgConfidence)
      .slice(0, 5)
      .map((cl) => ({
        category: cl.category,
        issueLabel: cl.issueLabel,
        count: cl.count,
        ratio: total ? Number((cl.count / total).toFixed(3)) : 0,
        confidence: cl.avgConfidence,
        evidenceReviews: cl.evidenceReviews,
        recommendedAction: cl.action,
        source: cl.source,
      }));

    // 상세페이지 액션 = 상위 이슈의 추천 액션(중복 제거)
    const detailPageActions = [...new Set(topIssues.map((i) => i.recommendedAction).filter(Boolean))];

    // 4) 자연어 요약 (LLM/mock)
    const report = await aiClient.generateProductImprovementReport({
      productName,
      totalReviews: total,
      negativeReviews,
      negativeRatio,
      topIssues,
    });

    // 5) 답글 템플릿 (상위 이슈별)
    const replyTemplates = [];
    for (const iss of topIssues.slice(0, 3)) {
      const variants = await aiClient.generateReplyTemplates({ category: iss.category, issueLabel: iss.issueLabel });
      replyTemplates.push({ issueLabel: iss.issueLabel, variants });
    }

    products.push({
      productKey: productName,
      productName,
      totalReviews: total,
      negativeReviews,
      negativeRatio,
      issueReviewCount,
      totalIssueCount,
      issueRatio,
      averageRating,
      topIssues,
      detailPageActions: detailPageActions.length ? detailPageActions : report.detailPageActions || [],
      replyTemplates,
      summary: report.summary || '',
    });
  }

  // 6) 전체 요약 + 카테고리 분포
  const totalReviews = reviews.length;
  const negativeReviews = classifications.filter((c) => c.sentiment === 'negative').length;
  const issueReviewCount = classifications.filter((c) => c.categories.length > 0).length;
  const totalIssueCount = classifications.reduce((s, c) => s + c.categories.length, 0);
  const issueRatio = totalReviews ? Number((issueReviewCount / totalReviews).toFixed(3)) : 0;
  const allRatings = reviews.map((r) => r.rating).filter((n) => typeof n === 'number');
  const averageRating = allRatings.length
    ? Number((allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(2))
    : undefined;

  // 카테고리 분포 (불만 매칭 기준, 리뷰당 카테고리 1회)
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
  const categoryDistribution = FASHION_CATEGORIES.map((name) => ({ name, count: categoryCount[name] || 0 })).filter(
    (c) => c.count > 0,
  );

  // 상품 랭킹: 부정 리뷰(별점·감성) 기준 / 개선 이슈(분석으로 발견된 불만) 기준
  const byNegative = [...products].sort((a, b) => b.negativeReviews - a.negativeReviews).slice(0, 10);
  const byIssues = [...products]
    .sort((a, b) => b.issueReviewCount - a.issueReviewCount || b.totalIssueCount - a.totalIssueCount)
    .slice(0, 10);

  const overall = await aiClient.generateMonthlyReport({
    totalReviews,
    negativeReviews,
    negativeRatio: totalReviews ? Number((negativeReviews / totalReviews).toFixed(3)) : 0,
    topCategories: [...categoryDistribution].sort((a, b) => b.count - a.count),
  });

  const summary = {
    totalReviews,
    negativeReviews,
    negativeRatio: totalReviews ? Number((negativeReviews / totalReviews).toFixed(3)) : 0,
    issueReviewCount,
    totalIssueCount,
    issueRatio,
    averageRating,
    productCount: productNames.length,
    categoryDistribution,
    productRankingByNegative: byNegative.map((p) => ({
      productKey: p.productKey,
      productName: p.productName,
      negativeReviews: p.negativeReviews,
      totalReviews: p.totalReviews,
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
  };

  return { analysisId: nanoid(), summary, products, classifications };
}
