// 세부 이슈 클러스터링 + 근거 리뷰 선별.
// 분류 단계에서 이미 (카테고리, 세부이슈 라벨, 액션)을 만들었으므로 여기서는
// 같은 이슈끼리 묶고, 가장 대표성 있는 근거 리뷰를 골라낸다.
// 라벨이 없는 묶음만 유사도 클러스터링 후 LLM으로 이름을 붙인다.
import { tokenize, jaccard, safeStr } from '../utils/textUtils.js';
import { CATEGORY_ACTIONS } from './fashionLexicon.js';

const NULL = '__NULL__';

// 문장 경계에서 자연스럽게 자르기
function trimText(text, max = 140) {
  const s = safeStr(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastEnd >= max * 0.5) return cut.slice(0, lastEnd + 1).trim();
  return cut.trim() + '…';
}

const sentimentRank = { negative: 0, neutral: 1, positive: 2 };

// 근거 리뷰 선별: 부정/강도/적정길이 우선, 유사 중복 제거
function pickEvidence(items, max = 4) {
  const ranked = [...items].sort((a, b) => {
    const sr = (sentimentRank[a.sentiment] ?? 1) - (sentimentRank[b.sentiment] ?? 1);
    if (sr !== 0) return sr;
    if (b.strength !== a.strength) return b.strength - a.strength;
    const lenPen = (x) => {
      const L = x.clause.length;
      if (L < 12) return 12 - L;
      if (L > 130) return L - 130;
      return 0;
    };
    const lp = lenPen(a) - lenPen(b);
    if (lp !== 0) return lp;
    return (a.rating ?? 3) - (b.rating ?? 3);
  });

  const chosen = [];
  const chosenTokens = [];
  for (const it of ranked) {
    const tks = tokenize(it.clause);
    if (chosenTokens.some((ct) => jaccard(ct, tks) >= 0.8)) continue; // 거의 동일한 문장 제거
    chosen.push(it);
    chosenTokens.push(tks);
    if (chosen.length >= max) break;
  }
  return chosen;
}

// 분류 결과를 (상품·카테고리·세부이슈) 단위로 묶고 대표 근거 리뷰를 선별한다.
// 입력: classifications(ReviewClassification[]), reviewMap(id→ReviewNormalized), aiClient
// 출력: 클러스터 배열 [{ productName, category, issueLabel, action, source, count, reviewIds, evidenceReviews, avgConfidence }]
export async function buildIssueClusters(classifications, reviewMap, aiClient) {
  // key: product||category||label  ->  items[]
  const groups = new Map();

  for (const c of classifications) {
    for (const cat of c.categories) {
      // 긍정/중립(문제 없음) 표현은 핵심 문제 클러스터에서 제외.
      if (cat.isActionableIssue === false) continue;
      if (cat.issuePolarity === 'positive') continue;
      const labelKey = cat.issue || NULL;
      const key = `${c.productName}||${cat.name}||${labelKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        reviewId: c.reviewId,
        label: cat.issue,
        action: cat.action,
        strength: cat.strength ?? 1,
        confidence: cat.confidence ?? 0.5,
        severity: cat.severity || 'medium',
        polarity: cat.issuePolarity || 'negative',
        sentiment: c.sentiment,
        rating: c.rating,
        clause: cat.evidence || '',
        content: reviewMap.get(c.reviewId)?.content || cat.evidence || '',
        source: cat.source,
      });
    }
  }

  // 라벨 있는 클러스터는 그대로, NULL 은 product+category 단위로 모아 유사도 클러스터링
  const nullBuckets = new Map(); // product||category -> items
  const labeled = [];

  for (const [key, items] of groups.entries()) {
    const [productName, category, labelKey] = key.split('||');
    if (labelKey === NULL) {
      const bk = `${productName}||${category}`;
      if (!nullBuckets.has(bk)) nullBuckets.set(bk, []);
      nullBuckets.get(bk).push(...items);
    } else {
      labeled.push({ productName, category, label: labelKey, items, source: items[0]?.source || 'rule' });
    }
  }

  const clusters = [];
  const needLabel = [];

  for (const c of labeled) {
    // source 우선순위: correction > user > llm > rule
    const src = c.items.some((i) => i.source === 'correction')
      ? 'correction'
      : c.items.some((i) => i.source === 'user')
        ? 'user'
        : c.items.some((i) => i.source === 'llm')
          ? 'llm'
          : 'rule';
    clusters.push(makeCluster(c.productName, c.category, c.label, c.items, src));
  }

  // NULL 버킷 유사도 클러스터링
  for (const [bk, items] of nullBuckets.entries()) {
    const [productName, category] = bk.split('||');
    const subClusters = clusterBySimilarity(items);
    for (const sub of subClusters) {
      const cl = makeCluster(productName, category, null, sub, 'cluster');
      clusters.push(cl);
      needLabel.push(cl);
    }
  }

  // 라벨 없는 묶음 → LLM 으로 이름 생성(없으면 카테고리 기본 라벨).
  // 호출마다 issue_label usage row 1건 기록 (provider/model/token 추적).
  const { recordLlmUsage } = await import('./ai/usage.service.js');
  const { PROMPT_VERSION, ANALYSIS_VERSION } = await import('./ai/index.js');
  for (const cl of needLabel) {
    if (aiClient) {
      try {
        const label = await aiClient.generateIssueLabel(cl.category, cl.evidenceReviews);
        const status = aiClient.lastCallStatus;
        recordLlmUsage({
          provider: aiClient.aiMode,
          model: aiClient.lastCallModel || aiClient.modelForRole?.('summary') || null,
          promptVersion: PROMPT_VERSION,
          analysisVersion: ANALYSIS_VERSION,
          requestType: 'issue_label',
          usage: aiClient.lastUsage || {},
          openaiCalled: aiClient.aiMode === 'openai' && status === 'ok',
          fallbackUsed: status === 'fallback' || (aiClient.aiMode !== 'openai' && status !== 'skipped'),
          fallbackProvider: status === 'fallback' ? 'mock' : null,
          error: status === 'fallback' ? aiClient.lastCallError : null,
        });
        cl.issueLabel = label || `${cl.category} 관련 의견`;
        cl.source = 'llm';
        continue;
      } catch {
        /* fallthrough */
      }
    }
    cl.issueLabel = `${cl.category} 관련 의견`;
  }

  return clusters;
}

const SEV_RANK = { low: 1, medium: 2, high: 3 };

function aggregateSeverity(items) {
  // 항목별 severity max → count 로 한 번 더 부스트
  let best = 'low';
  for (const it of items) {
    const s = it.severity || 'medium';
    if (SEV_RANK[s] > SEV_RANK[best]) best = s;
  }
  const count = new Set(items.map((i) => i.reviewId)).size;
  // count >=5 → high 보장, count >=3 → medium 이상 보장
  if (count >= 5) return 'high';
  if (count >= 3 && SEV_RANK[best] < SEV_RANK.medium) return 'medium';
  return best;
}

function makeCluster(productName, category, label, items, source) {
  const uniqueReviewIds = [...new Set(items.map((i) => i.reviewId))];
  const evidence = pickEvidence(items).map((i) => trimText(i.content));
  const avgConfidence =
    items.reduce((s, i) => s + (i.confidence || 0), 0) / Math.max(items.length, 1);
  // 클러스터 polarity: mixed 가 1건 이상이면 mixed, 아니면 negative
  const polarities = new Set(items.map((i) => i.polarity || 'negative'));
  const clusterPolarity = polarities.has('negative')
    ? polarities.has('mixed') || polarities.has('positive')
      ? 'mixed'
      : 'negative'
    : polarities.has('mixed')
      ? 'mixed'
      : 'neutral';
  return {
    productName,
    category,
    issueLabel: label, // null 이면 이후 LLM 라벨링
    action: (label && items[0]?.action) || CATEGORY_ACTIONS[category] || CATEGORY_ACTIONS['기타'],
    source,
    count: uniqueReviewIds.length,
    reviewIds: uniqueReviewIds,
    evidenceReviews: evidence,
    avgConfidence: Number(avgConfidence.toFixed(2)),
    severity: aggregateSeverity(items),
    polarity: clusterPolarity,
  };
}

// 라벨 없는 항목을 절 유사도로 묶기
function clusterBySimilarity(items) {
  const used = new Array(items.length).fill(false);
  const groups = [];
  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue;
    const base = tokenize(items[i].clause);
    const group = [items[i]];
    used[i] = true;
    for (let j = i + 1; j < items.length; j++) {
      if (used[j]) continue;
      if (jaccard(base, tokenize(items[j].clause)) >= 0.25) {
        group.push(items[j]);
        used[j] = true;
      }
    }
    groups.push(group);
  }
  return groups;
}
