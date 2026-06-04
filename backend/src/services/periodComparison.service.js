// 기간별 리뷰 반응 변화 (period comparison).
//
// 입력: products[] (productAnalysis.runAnalysis 가 만든 결과)
//       + 옵션 { mode, currentStart, currentEnd, previousStart, previousEnd, planCode, periodComparisonAllowed }
// 출력: periodComparison 응답 객체 — 화면/Export/Print 가 그대로 사용.
//
// 핵심 원칙:
//   1) 단정형 표현 금지 — "줄어든 것으로 보입니다 / 늘어난 것으로 보입니다" 톤.
//   2) 리뷰 수가 너무 적으면 caution 표시 (변화 단정 X).
//   3) Pro 이상 전용 — Free/Starter 는 locked.
//   4) 작성일이 없는 리뷰는 비교에서 제외 (전체 분석에는 영향 없음).
//   5) improvementIssues 만 이슈 변화 집계에 사용 — mentionedAspects 는 차트 오염 방지로 제외.

import { normalizeReviewDate } from '../utils/dateUtils.js';
import { normalizeCategoryKey, categoryLabelFor } from './ai/sizeDirection.js';

// 비교 모드.
export const PERIOD_MODES = Object.freeze({
  RECENT_30_VS_PREVIOUS_30: 'recent_30_vs_previous_30',
  RECENT_90_VS_PREVIOUS_90: 'recent_90_vs_previous_90',
  CUSTOM: 'custom',
  MONTHLY_TREND: 'monthly_trend',
  WEEKLY_TREND: 'weekly_trend',
});

// 기간별 비교가 의미 있으려면 각 기간에 최소 이 수 이상의 리뷰가 있어야 한다.
export const MIN_REVIEWS_PER_PERIOD = 10;
// 작성일이 유효한 리뷰가 너무 적으면 unavailable.
const MIN_DATED_REVIEWS = 10;
const MIN_DATED_RATIO = 0.3;

// 비율은 소수 3자리.
const r3 = (a, b) => (b ? Number((a / b).toFixed(3)) : 0);
// %p 변화는 소수 3자리.
const dRatio = (cur, prev) => Number(((cur || 0) - (prev || 0)).toFixed(3));

// 카운트 → 비율 객체.
function ratios(counts, total) {
  return {
    positive: r3(counts.positive || 0, total),
    neutral: r3(counts.neutral || 0, total),
    negative: r3(counts.negative || 0, total),
    mixed: r3(counts.mixed || 0, total),
  };
}

// products 의 reviews 를 모두 모아 평탄화 — productAnalysis 가 마스킹된 review 객체에
// sentiment, improvementIssues, createdAt 을 이미 채워 둔다. createdAt 은 다양한 형식이
// 들어올 수 있으므로 normalizeReviewDate 로 통일.
export function flattenAllReviews(products) {
  const out = [];
  for (const p of (products || [])) {
    const list = Array.isArray(p.reviews) ? p.reviews : [];
    for (const r of list) {
      out.push({
        ...r,
        productKey: r.productKey || p.productKey || p.productName,
        productName: r.productName || p.productName,
        // 정규화된 날짜 (YYYY-MM-DD) — 비교에 사용. null 이면 기간별 비교에서 제외.
        _date: normalizeReviewDate(r.createdAt),
      });
    }
  }
  return out;
}

// 두 기간의 리뷰를 잘라낸다. start/end 는 YYYY-MM-DD (inclusive).
function inRange(rev, start, end) {
  if (!rev._date) return false;
  return rev._date >= start && rev._date <= end;
}

// 리뷰 배열 → 기간 집계 (감성, 이슈 카테고리별 카운트, 상품별 카운트).
// improvementIssues 만 사용 — mentionedAspects 는 집계 제외.
function aggregatePeriod(reviews) {
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
  const issueByCategory = new Map(); // categoryKey → count
  const productStats = new Map(); // productKey → { productName, total, negative, issueCount, issueByCategory: Map }

  for (const r of reviews) {
    const s = r.sentiment || 'neutral';
    if (sentimentCounts[s] != null) sentimentCounts[s] += 1;
    else sentimentCounts.neutral += 1;

    // improvementIssues 우선, 없으면 detectedIssues 에서 actionable 만 사용.
    let issues = Array.isArray(r.improvementIssues) ? r.improvementIssues : null;
    if (!issues || !issues.length) {
      issues = (r.detectedIssues || [])
        .filter((i) => i && i.category && i.category !== '기타' && i.isActionableIssue !== false)
        .map((i) => ({ category: i.category, categoryLabel: i.category }));
    }
    const seen = new Set();
    for (const iss of issues) {
      const key = normalizeCategoryKey(iss.category || iss.categoryLabel);
      if (!key || key === 'other') continue;
      if (seen.has(key)) continue;
      seen.add(key);
      issueByCategory.set(key, (issueByCategory.get(key) || 0) + 1);
    }

    // 상품별 집계.
    const pk = r.productKey || r.productName || '상품명 없음';
    if (!productStats.has(pk)) {
      productStats.set(pk, {
        productKey: pk,
        productName: r.productName || pk,
        total: 0,
        negative: 0,
        issueReviewCount: 0,
        issueByCategory: new Map(),
      });
    }
    const ps = productStats.get(pk);
    ps.total += 1;
    if (s === 'negative') ps.negative += 1;
    if (seen.size > 0) ps.issueReviewCount += 1;
    for (const k of seen) {
      ps.issueByCategory.set(k, (ps.issueByCategory.get(k) || 0) + 1);
    }
  }

  return {
    totalReviews: reviews.length,
    sentimentCounts,
    sentimentRatios: ratios(sentimentCounts, reviews.length),
    issueByCategory,
    productStats,
  };
}

// 기간 집계 → 외부 응답 shape 의 currentPeriod/previousPeriod.
function periodShape(label, startDate, endDate, agg) {
  const issueCounts = [];
  for (const [key, count] of agg.issueByCategory.entries()) {
    issueCounts.push({ category: key, categoryLabel: categoryLabelFor(key), count });
  }
  issueCounts.sort((a, b) => b.count - a.count);
  return {
    label,
    startDate,
    endDate,
    totalReviews: agg.totalReviews,
    sentimentCounts: agg.sentimentCounts,
    sentimentRatios: agg.sentimentRatios,
    issueCounts,
  };
}

// 이슈 변화 — 두 기간의 categoryKey 카운트 차이를 비교.
function buildIssueDeltas(curAgg, prevAgg) {
  const allKeys = new Set([
    ...curAgg.issueByCategory.keys(),
    ...prevAgg.issueByCategory.keys(),
  ]);
  const rows = [];
  for (const k of allKeys) {
    const curCount = curAgg.issueByCategory.get(k) || 0;
    const prevCount = prevAgg.issueByCategory.get(k) || 0;
    const delta = curCount - prevCount;
    rows.push({
      category: k,
      categoryLabel: categoryLabelFor(k),
      currentCount: curCount,
      previousCount: prevCount,
      countDelta: delta,
    });
  }
  // 개선된 이슈 — 줄어든 (delta < 0), 절대값이 큰 순.
  const improved = rows
    .filter((r) => r.countDelta < 0 && r.previousCount >= 2)
    .sort((a, b) => a.countDelta - b.countDelta)
    .slice(0, 5);
  // 새로 늘어난 이슈 — 늘어난 (delta > 0), 절대값이 큰 순.
  const worsened = rows
    .filter((r) => r.countDelta > 0)
    .sort((a, b) => b.countDelta - a.countDelta)
    .slice(0, 5);
  // 새로 나타난 이슈 — 이전 0, 현재 양수.
  const newIssues = rows
    .filter((r) => r.previousCount === 0 && r.currentCount > 0)
    .sort((a, b) => b.currentCount - a.currentCount)
    .slice(0, 5);
  // 해소된 이슈 — 이전 양수, 현재 0.
  const resolved = rows
    .filter((r) => r.previousCount > 0 && r.currentCount === 0)
    .sort((a, b) => b.previousCount - a.previousCount)
    .slice(0, 5);
  return { improved, worsened, newIssues, resolved };
}

// 상품별 변화 — 부정 비율 / 이슈 카운트 변화. 최소 리뷰 수 미만 상품은 ranking 제외.
function buildProductDeltas(curAgg, prevAgg) {
  const allKeys = new Set([
    ...curAgg.productStats.keys(),
    ...prevAgg.productStats.keys(),
  ]);
  const rows = [];
  for (const pk of allKeys) {
    const cur = curAgg.productStats.get(pk);
    const prev = prevAgg.productStats.get(pk);
    const curTotal = cur?.total || 0;
    const prevTotal = prev?.total || 0;
    const curNeg = cur?.negative || 0;
    const prevNeg = prev?.negative || 0;
    const curIssue = cur?.issueReviewCount || 0;
    const prevIssue = prev?.issueReviewCount || 0;
    const curNegRatio = r3(curNeg, curTotal);
    const prevNegRatio = r3(prevNeg, prevTotal);

    // 가장 많이 바뀐 이슈 카테고리 (top changed) — 절대값 기준.
    let topChanged = null;
    const allCats = new Set([
      ...(cur?.issueByCategory.keys() || []),
      ...(prev?.issueByCategory.keys() || []),
    ]);
    let bestAbs = 0;
    for (const k of allCats) {
      const dc = (cur?.issueByCategory.get(k) || 0) - (prev?.issueByCategory.get(k) || 0);
      if (Math.abs(dc) > Math.abs(bestAbs)) {
        bestAbs = dc;
        topChanged = {
          category: k,
          categoryLabel: categoryLabelFor(k),
          countDelta: dc,
        };
      }
    }

    rows.push({
      productKey: pk,
      productName: cur?.productName || prev?.productName || pk,
      currentTotalReviews: curTotal,
      previousTotalReviews: prevTotal,
      currentNegativeRatio: curNegRatio,
      previousNegativeRatio: prevNegRatio,
      negativeRatioDelta: dRatio(curNegRatio, prevNegRatio),
      currentIssueCount: curIssue,
      previousIssueCount: prevIssue,
      issueCountDelta: curIssue - prevIssue,
      topChangedIssue: topChanged,
    });
  }
  // 개선된 상품 — 부정 비율 ↓ + 이슈 카운트 ↓, 현재 리뷰 수가 최소 기준 이상.
  const improved = rows
    .filter((r) => r.currentTotalReviews >= 5 && r.negativeRatioDelta < 0 && r.issueCountDelta <= 0)
    .sort((a, b) => a.negativeRatioDelta - b.negativeRatioDelta || a.issueCountDelta - b.issueCountDelta)
    .slice(0, 5);
  // 악화된 상품 — 부정 비율 ↑ + 이슈 카운트 ↑.
  const worsened = rows
    .filter((r) => r.currentTotalReviews >= 5 && r.negativeRatioDelta > 0 && r.issueCountDelta >= 0)
    .sort((a, b) => b.negativeRatioDelta - a.negativeRatioDelta || b.issueCountDelta - a.issueCountDelta)
    .slice(0, 5);
  return { improved, worsened, all: rows };
}

// 월별/주별 추이 — 작성일 기준 bucket. 너무 데이터가 적으면 빈 배열.
function buildTrend(dated, granularity) {
  if (!dated.length) return [];
  const buckets = new Map(); // periodKey → { reviews: [] }
  for (const r of dated) {
    const k = bucketKey(r._date, granularity);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const keys = [...buckets.keys()].sort(); // YYYY-MM 또는 YYYY-Www 정렬은 lexical 로 충분
  return keys.map((period) => {
    const reviews = buckets.get(period);
    const agg = aggregatePeriod(reviews);
    // top issues (상위 3개 카테고리) — 차트 hover 또는 보조 정보.
    const topIssues = [...agg.issueByCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, count]) => ({ category: k, categoryLabel: categoryLabelFor(k), count }));
    return {
      period,
      totalReviews: agg.totalReviews,
      positiveRatio: agg.sentimentRatios.positive,
      neutralRatio: agg.sentimentRatios.neutral,
      negativeRatio: agg.sentimentRatios.negative,
      mixedRatio: agg.sentimentRatios.mixed,
      topIssues,
    };
  });
}

function bucketKey(ymd, granularity) {
  if (granularity === 'monthly') return ymd.slice(0, 7); // YYYY-MM
  // weekly — ISO 주차 기준. 간단히 'YYYY-Www' 로.
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // ISO 주차 계산
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// YYYY-MM-DD 더하기 N일.
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// 데이터 기준 최신 날짜 — 운영 데이터는 분석 시점보다 과거에 끝나 있을 수 있으므로
// "today" 가 아니라 "최신 리뷰 날짜" 를 기준으로 윈도우를 잡는다.
function maxDate(dated) {
  let m = null;
  for (const r of dated) {
    if (r._date && (!m || r._date > m)) m = r._date;
  }
  return m;
}

// 데이터 기준 가장 오래된 날짜.
function minDate(dated) {
  let m = null;
  for (const r of dated) {
    if (r._date && (!m || r._date < m)) m = r._date;
  }
  return m;
}

// 데이터 품질 — 비교 기간 리뷰 수가 너무 적으면 caution.
function buildDataQuality(curTotal, prevTotal) {
  const currentEnough = curTotal >= MIN_REVIEWS_PER_PERIOD;
  const previousEnough = prevTotal >= MIN_REVIEWS_PER_PERIOD;
  let cautionMessage = null;
  if (!currentEnough && !previousEnough) {
    cautionMessage = '비교 기간의 리뷰 수가 적어 변화 추이는 참고용으로만 봐주세요.';
  } else if (!currentEnough || !previousEnough) {
    cautionMessage = '한쪽 기간의 리뷰 수가 적어 변화 해석은 참고용으로 봐주세요.';
  }
  return { currentEnough, previousEnough, minReviewsPerPeriod: MIN_REVIEWS_PER_PERIOD, cautionMessage };
}

// 룰 기반 변화 요약 — 단정형 금지, "줄어든 것으로 보입니다" 톤.
// LLM 실패 시 fallback 또는 Free/Starter 잠금 직전 미리보기로 사용.
export function buildRuleBasedPeriodSummary(comparison) {
  if (!comparison || !comparison.deltas) return '';
  const { currentPeriod, previousPeriod, deltas, improvedIssues, worsenedIssues, dataQuality } = comparison;
  if (!currentPeriod || !previousPeriod) return '';

  const parts = [];
  const curLabel = currentPeriod.label || '최근 기간';
  const prevLabel = previousPeriod.label || '이전 기간';

  // 1) 감성 비율 변화
  const posDelta = deltas.positiveRatioDelta || 0;
  const negDelta = deltas.negativeRatioDelta || 0;
  if (Math.abs(posDelta) < 0.02 && Math.abs(negDelta) < 0.02) {
    parts.push(`${curLabel}은 ${prevLabel}과 비교해 긍정·부정 비율 변화가 크지 않은 것으로 보입니다.`);
  } else {
    const posPhrase = posDelta > 0.02 ? '긍정 반응이 늘어난 것으로 보이고'
      : posDelta < -0.02 ? '긍정 반응이 줄어든 것으로 보이고' : '긍정 반응은 비슷한 수준이고';
    const negPhrase = negDelta > 0.02 ? '부정 반응은 늘어난 것으로 보입니다.'
      : negDelta < -0.02 ? '부정 반응은 줄어든 것으로 보입니다.' : '부정 반응은 비슷한 수준입니다.';
    parts.push(`${curLabel}은 ${prevLabel}보다 ${posPhrase}, ${negPhrase}`);
  }

  // 2) 가장 개선된 이슈
  if (improvedIssues && improvedIssues[0]) {
    const t = improvedIssues[0];
    parts.push(`특히 ${t.categoryLabel} 관련 의견이 ${Math.abs(t.countDelta)}건 줄어든 것으로 보입니다.`);
  }
  // 3) 새로 늘어난 이슈
  if (worsenedIssues && worsenedIssues[0]) {
    const t = worsenedIssues[0];
    parts.push(`반면 ${t.categoryLabel} 관련 의견은 ${t.countDelta}건 늘어난 것으로 보이니, 상세페이지의 관련 안내를 한번 점검해 보세요.`);
  }
  // 4) 데이터 품질 caution
  if (dataQuality && dataQuality.cautionMessage) {
    parts.push(dataQuality.cautionMessage);
  }
  return parts.join(' ');
}

// 메인 진입점.
// products: runAnalysis 결과의 products[]
// options:
//   - planCode: 'free'|'starter'|'pro'|'business' (없으면 'free')
//   - periodComparisonAllowed: 명시적 override (있으면 그대로 사용 — 라우트 권한 체크용)
//   - mode: PERIOD_MODES 값. 기본 RECENT_30_VS_PREVIOUS_30
//   - currentStart/currentEnd/previousStart/previousEnd: CUSTOM 모드 전용 (YYYY-MM-DD)
//
// 반환: periodComparison 응답 객체.
export function buildPeriodComparisonAnalysis(products, options = {}) {
  const allowed = options.periodComparisonAllowed === true
    || options.planCode === 'pro' || options.planCode === 'business';

  // 1) 잠금 (Free/Starter).
  if (!allowed) {
    return {
      available: false,
      locked: true,
      requiredPlan: 'pro',
      reason: 'plan_locked',
      message: '기간별 리뷰 변화 분석은 Pro 이상에서 사용할 수 있어요.',
      defaultMode: PERIOD_MODES.RECENT_30_VS_PREVIOUS_30,
    };
  }

  const all = flattenAllReviews(products);
  const dated = all.filter((r) => r._date);

  // 2) 작성일 데이터가 너무 부족하면 unavailable.
  if (
    dated.length < MIN_DATED_REVIEWS
    || (all.length > 0 && dated.length / all.length < MIN_DATED_RATIO)
  ) {
    return {
      available: false,
      locked: false,
      reason: 'missing_review_dates',
      message: '리뷰 작성일 데이터가 부족해서 기간별 변화를 분석하기 어려워요. 다음 업로드에서 작성일 컬럼을 매핑하면 기간별 리뷰 변화와 개선 추이를 확인할 수 있습니다.',
      defaultMode: PERIOD_MODES.RECENT_30_VS_PREVIOUS_30,
      totalReviews: all.length,
      datedReviews: dated.length,
    };
  }

  // 3) 기간 윈도우 결정.
  const mode = options.mode || PERIOD_MODES.RECENT_30_VS_PREVIOUS_30;
  const latest = maxDate(dated);
  const earliest = minDate(dated);

  let curStart, curEnd, prevStart, prevEnd, curLabel, prevLabel;
  if (mode === PERIOD_MODES.RECENT_90_VS_PREVIOUS_90) {
    curEnd = latest;
    curStart = addDays(latest, -89);
    prevEnd = addDays(curStart, -1);
    prevStart = addDays(prevEnd, -89);
    curLabel = '최근 90일';
    prevLabel = '이전 90일';
  } else if (mode === PERIOD_MODES.CUSTOM) {
    curStart = options.currentStart;
    curEnd = options.currentEnd;
    prevStart = options.previousStart;
    prevEnd = options.previousEnd;
    if (!curStart || !curEnd || !prevStart || !prevEnd) {
      return {
        available: false,
        locked: false,
        reason: 'invalid_custom_range',
        message: '직접 기간 비교는 두 기간의 시작일과 종료일을 모두 입력해 주세요.',
        defaultMode: PERIOD_MODES.RECENT_30_VS_PREVIOUS_30,
      };
    }
    if (curStart > curEnd || prevStart > prevEnd) {
      return {
        available: false,
        locked: false,
        reason: 'invalid_custom_range',
        message: '기간의 시작일이 종료일보다 늦을 수는 없어요.',
        defaultMode: PERIOD_MODES.RECENT_30_VS_PREVIOUS_30,
      };
    }
    curLabel = '선택한 현재 기간';
    prevLabel = '선택한 비교 기간';
  } else if (mode === PERIOD_MODES.MONTHLY_TREND || mode === PERIOD_MODES.WEEKLY_TREND) {
    // 추이 모드 — 비교 페어가 아닌 시계열만 의미가 있다. recent30 데이터를 함께 채워
    // 카드 UI 가 비지 않도록.
    curEnd = latest;
    curStart = addDays(latest, -29);
    prevEnd = addDays(curStart, -1);
    prevStart = addDays(prevEnd, -29);
    curLabel = '최근 30일';
    prevLabel = '이전 30일';
  } else {
    // RECENT_30_VS_PREVIOUS_30 (기본)
    curEnd = latest;
    curStart = addDays(latest, -29);
    prevEnd = addDays(curStart, -1);
    prevStart = addDays(prevEnd, -29);
    curLabel = '최근 30일';
    prevLabel = '이전 30일';
  }

  // 4) 각 기간 잘라내기 + 집계.
  const curReviews = dated.filter((r) => inRange(r, curStart, curEnd));
  const prevReviews = dated.filter((r) => inRange(r, prevStart, prevEnd));
  const curAgg = aggregatePeriod(curReviews);
  const prevAgg = aggregatePeriod(prevReviews);

  // 5) Deltas.
  const deltas = {
    totalReviewsDelta: curAgg.totalReviews - prevAgg.totalReviews,
    positiveRatioDelta: dRatio(curAgg.sentimentRatios.positive, prevAgg.sentimentRatios.positive),
    negativeRatioDelta: dRatio(curAgg.sentimentRatios.negative, prevAgg.sentimentRatios.negative),
    neutralRatioDelta: dRatio(curAgg.sentimentRatios.neutral, prevAgg.sentimentRatios.neutral),
    mixedRatioDelta: dRatio(curAgg.sentimentRatios.mixed, prevAgg.sentimentRatios.mixed),
  };

  // 6) 이슈/상품 변화.
  const issueDeltas = buildIssueDeltas(curAgg, prevAgg);
  const productDeltas = buildProductDeltas(curAgg, prevAgg);

  // 7) 추이 — 항상 함께 채워 둔다 (UI 가 mode toggle 만 바꿔 보여줄 수 있게).
  const monthly = buildTrend(dated, 'monthly');
  const weekly = buildTrend(dated, 'weekly');

  // 8) 데이터 품질.
  const dataQuality = buildDataQuality(curAgg.totalReviews, prevAgg.totalReviews);

  const result = {
    available: true,
    locked: false,
    requestedMode: mode,
    defaultMode: PERIOD_MODES.RECENT_30_VS_PREVIOUS_30,
    dataset: {
      totalReviews: all.length,
      datedReviews: dated.length,
      earliestDate: earliest,
      latestDate: latest,
    },
    currentPeriod: periodShape(curLabel, curStart, curEnd, curAgg),
    previousPeriod: periodShape(prevLabel, prevStart, prevEnd, prevAgg),
    deltas,
    improvedIssues: issueDeltas.improved,
    worsenedIssues: issueDeltas.worsened,
    newIssues: issueDeltas.newIssues,
    resolvedIssues: issueDeltas.resolved,
    improvedProducts: productDeltas.improved,
    worsenedProducts: productDeltas.worsened,
    trend: { monthly, weekly },
    dataQuality,
    summary: null, // LLM/rule 요약은 호출 측에서 채운다.
  };

  // 룰 기반 요약은 항상 기본값으로 채워 두고, LLM 결과가 있으면 호출 측이 덮어쓴다.
  result.summary = buildRuleBasedPeriodSummary(result);
  return result;
}
