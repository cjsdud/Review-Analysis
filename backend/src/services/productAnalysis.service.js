// 분석 오케스트레이션: 분류 → 이슈 클러스터 → 상품별 리포트 → 전체 요약
import { nanoid } from 'nanoid';
import { classifyAll, FASHION_CATEGORIES } from './reviewClassification.service.js';
import { buildIssueClusters } from './issueDetection.service.js';
import aiClient from './aiClient.service.js';

export async function runAnalysis(reviews) {
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));

  // 1) 멀티라벨 분류 (규칙 + 애매한 건 LLM)
  const classifications = await classifyAll(reviews, aiClient);

  // 2) 상품·카테고리별 이슈 클러스터
  const clusters = await buildIssueClusters(classifications, reviewMap, aiClient);

  // 3) 상품별 집계
  const productNames = [...new Set(reviews.map((r) => r.productName))];
  const products = [];

  for (const productName of productNames) {
    const productReviews = reviews.filter((r) => r.productName === productName);
    const productCls = classifications.filter((c) => c.productName === productName);
    const productClusters = clusters.filter((cl) => cl.productName === productName);

    const negativeReviews = productCls.filter((c) => c.sentiment === 'negative').length;
    const ratings = productReviews.map((r) => r.rating).filter((n) => typeof n === 'number');
    const averageRating = ratings.length
      ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
      : undefined;

    // topIssues: 클러스터를 count 내림차순
    const topIssues = productClusters
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((cl) => ({
        category: cl.category,
        issueLabel: cl.label,
        count: cl.count,
        ratio: Number((cl.count / productReviews.length).toFixed(3)),
        evidenceReviews: cl.evidenceReviews,
        recommendedAction: '', // 아래 LLM 리포트에서 채움
        source: cl.source,
      }));

    // 4) LLM(또는 mock) 상품 리포트
    const report = await aiClient.generateProductImprovementReport({ productName, topIssues });

    // recommendedAction 매핑 (detailPageActions와 1:1 정렬)
    topIssues.forEach((iss, idx) => {
      iss.recommendedAction = report.detailPageActions?.[idx] || '';
    });

    // 5) 답글 템플릿 (이슈별)
    const replyTemplates = [];
    for (const iss of topIssues.slice(0, 3)) {
      const tpls = await aiClient.generateReplyTemplates({ category: iss.category, issueLabel: iss.issueLabel });
      replyTemplates.push({ issueLabel: iss.issueLabel, variants: tpls });
    }

    products.push({
      productKey: productName,
      productName,
      totalReviews: productReviews.length,
      negativeReviews,
      averageRating,
      topIssues,
      detailPageActions: report.detailPageActions || [],
      replyTemplates,
      summary: report.summary || '',
    });
  }

  // 6) 전체 요약 + 카테고리 분포
  const totalReviews = reviews.length;
  const negativeReviews = classifications.filter((c) => c.sentiment === 'negative').length;
  const allRatings = reviews.map((r) => r.rating).filter((n) => typeof n === 'number');
  const averageRating = allRatings.length
    ? Number((allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(2))
    : undefined;

  // 카테고리 분포 (불만 기준: 긍정 리뷰 제외, 리뷰당 카테고리 1회)
  const categoryCount = Object.fromEntries(FASHION_CATEGORIES.map((c) => [c, 0]));
  for (const c of classifications) {
    if (c.sentiment === 'positive') continue;
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

  // 상품 랭킹
  const byNegative = [...products].sort((a, b) => b.negativeReviews - a.negativeReviews).slice(0, 10);
  const byIssues = [...products]
    .map((p) => ({ ...p, issueTotal: p.topIssues.reduce((s, i) => s + i.count, 0) }))
    .sort((a, b) => b.issueTotal - a.issueTotal)
    .slice(0, 10);

  const overall = await aiClient.generateMonthlyReport({
    totalReviews,
    negativeReviews,
    topCategories: [...categoryDistribution].sort((a, b) => b.count - a.count),
  });

  const summary = {
    totalReviews,
    negativeReviews,
    negativeRatio: totalReviews ? Number((negativeReviews / totalReviews).toFixed(3)) : 0,
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
      issueTotal: p.issueTotal,
    })),
    aiComment: overall.summary,
    aiMode: aiClient.aiMode,
  };

  return { analysisId: nanoid(), summary, products, classifications };
}
