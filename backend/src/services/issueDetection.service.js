// 세부 이슈 자동 생성: 규칙 기반 issueLabel → 못 만들면 LLM 묶음 이름
// 향후 임베딩 클러스터링으로 교체 가능하도록 분리.
import { safeStr, tokenize, jaccard } from '../utils/textUtils.js';

// 규칙: [카테고리, 포함조건(any), 라벨]
const ISSUE_RULES = [
  ['사이즈', ['허리'], ['작', '끼', '타이트'], '허리 사이즈가 작음'],
  ['사이즈', ['기장', '길이'], ['김', '길', '길어'], '기장이 김'],
  ['사이즈', ['기장', '길이'], ['짧'], '기장이 짧음'],
  ['사이즈', ['어깨'], ['좁', '작'], '어깨가 좁음'],
  ['사이즈', ['소매', '팔'], ['길', '짧', '좁'], '소매 길이/품이 안 맞음'],
  ['사이즈', [], ['작', '낑', '껴', '타이트'], '전체적으로 사이즈가 작음'],
  ['사이즈', [], ['크', '헐렁'], '전체적으로 사이즈가 큼'],
  ['핏/실루엣', [], ['부해', '부함'], '핏이 부해 보임'],
  ['핏/실루엣', [], ['핏', '라인', '실루엣'], '핏/실루엣이 기대와 다름'],
  ['색상/화면 차이', ['사진', '화면', '실물'], ['어둡'], '실물 색상이 화면보다 어두움'],
  ['색상/화면 차이', ['사진', '화면', '실물'], ['밝'], '실물 색상이 화면보다 밝음'],
  ['색상/화면 차이', [], ['색', '톤', '차이'], '색상이 화면과 차이가 있음'],
  ['소재/두께', [], ['얇', '비침'], '원단이 얇고 비침이 있음'],
  ['소재/두께', [], ['두껍'], '원단이 두꺼움'],
  ['소재/두께', [], ['까슬', '까끌'], '소재가 까슬함'],
  ['마감/불량', ['실밥'], [], '실밥/마감 처리가 아쉬움'],
  ['마감/불량', ['지퍼', '단추'], [], '지퍼/단추 등 부자재 불량'],
  ['마감/불량', [], ['불량', '터짐', '구멍', '뜯'], '제품 불량(터짐/구멍 등)'],
  ['마감/불량', [], ['마감', '박음질'], '마감 상태가 아쉬움'],
  ['착용감', [], ['따가', '까끌', '가려'], '착용 시 따갑거나 가려움'],
  ['착용감', [], ['답답', '불편'], '착용감이 불편함'],
  ['세탁/내구성', [], ['보풀'], '세탁 후 보풀이 생김'],
  ['세탁/내구성', [], ['줄어', '수축'], '세탁 후 줄어듦'],
  ['세탁/내구성', [], ['늘어', '변형'], '세탁 후 늘어남/변형'],
  ['세탁/내구성', [], ['물빠짐'], '세탁 시 물빠짐'],
  ['배송/포장', [], ['늦'], '배송이 지연됨'],
  ['배송/포장', [], ['구김', '포장', '박스'], '포장 상태가 아쉬움(구김 등)'],
  ['배송/포장', [], ['누락'], '구성품 누락'],
  ['가격/가성비', [], ['비싸', '퀄리티 대비'], '가격 대비 품질 아쉬움'],
];

function ruleIssueLabel(category, text) {
  for (const [cat, anyA, anyB, label] of ISSUE_RULES) {
    if (cat !== category) continue;
    const okA = anyA.length === 0 || anyA.some((w) => text.includes(w));
    const okB = anyB.length === 0 || anyB.some((w) => text.includes(w));
    if (okA && okB) return label;
  }
  return null;
}

// 같은 상품·카테고리 안에서 리뷰를 이슈로 묶음
// items: [{ reviewId, content }]
function clusterByLabel(items) {
  // 1) 규칙 라벨로 우선 그룹화
  const clusters = new Map(); // label -> { label, reviewIds, contents }
  const unlabeled = [];

  for (const it of items) {
    const text = safeStr(it.content);
    const label = ruleIssueLabel(it.category, text);
    if (label) {
      if (!clusters.has(label)) clusters.set(label, { label, source: 'rule', reviewIds: [], contents: [] });
      const c = clusters.get(label);
      c.reviewIds.push(it.reviewId);
      c.contents.push(text);
    } else {
      unlabeled.push(it);
    }
  }

  // 2) 라벨 없는 건 자카드 유사도로 단순 묶기
  const used = new Array(unlabeled.length).fill(false);
  for (let i = 0; i < unlabeled.length; i++) {
    if (used[i]) continue;
    const baseTokens = tokenize(unlabeled[i].content);
    const group = { label: null, source: 'cluster', reviewIds: [unlabeled[i].reviewId], contents: [unlabeled[i].content] };
    used[i] = true;
    for (let j = i + 1; j < unlabeled.length; j++) {
      if (used[j]) continue;
      if (jaccard(baseTokens, tokenize(unlabeled[j].content)) >= 0.25) {
        group.reviewIds.push(unlabeled[j].reviewId);
        group.contents.push(unlabeled[j].content);
        used[j] = true;
      }
    }
    clusters.set(`__cluster_${i}`, group);
  }

  return [...clusters.values()];
}

// 상품·카테고리별 이슈 클러스터 생성. LLM으로 라벨 보강.
// classifications: classifyReview 결과 배열, reviewMap: id->review
export async function buildIssueClusters(classifications, reviewMap, aiClient) {
  // (productName, category) -> items. 긍정 리뷰는 불만 클러스터에서 제외.
  const grouped = new Map();
  for (const c of classifications) {
    if (c.sentiment === 'positive') continue;
    for (const cat of c.categories) {
      const key = `${c.productName}||${cat.name}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({
        reviewId: c.reviewId,
        category: cat.name,
        content: reviewMap.get(c.reviewId)?.content || cat.evidence || '',
      });
    }
  }

  const result = []; // { productName, category, label, source, count, reviewIds, evidenceReviews }
  const needLabel = [];

  for (const [key, items] of grouped.entries()) {
    const [productName, category] = key.split('||');
    const clusters = clusterByLabel(items);
    for (const cl of clusters) {
      const entry = {
        productName,
        category,
        label: cl.label,
        source: cl.source,
        count: cl.reviewIds.length,
        reviewIds: cl.reviewIds,
        evidenceReviews: cl.contents.slice(0, 5),
      };
      result.push(entry);
      if (!cl.label) needLabel.push(entry);
    }
  }

  // 라벨 없는 클러스터는 LLM으로 묶음 이름 생성
  if (needLabel.length > 0 && aiClient) {
    for (const entry of needLabel) {
      try {
        const label = await aiClient.generateIssueLabel(entry.category, entry.evidenceReviews);
        entry.label = label || `${entry.category} 관련 의견`;
        entry.source = 'llm';
      } catch {
        entry.label = `${entry.category} 관련 의견`;
      }
    }
  } else {
    for (const entry of needLabel) entry.label = `${entry.category} 관련 의견`;
  }

  return result;
}
