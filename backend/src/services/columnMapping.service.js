import { normalizeKey, isLongText } from '../utils/textUtils.js';
import { looksLikeDate } from '../utils/dateUtils.js';

// 공통(플랫폼 무관) 컬럼명 후보. SOURCE_FIELD_CANDIDATES 와 함께 사용한다.
// 한국어 + 영어(snake_case / camelCase / "Title Case" 모두) 후보를 같이 둔다.
// 비교는 textUtils.normalizeKey 로 소문자/공백/언더스코어/하이픈/괄호를 제거한 뒤 이뤄지므로
// 같은 정규화 결과를 가진 표기는 한 번만 적어도 된다(`product_name` 과 `productName` 은 동일).
// 그래도 가독성을 위해 대표적인 표기는 명시한다.
export const FIELD_CANDIDATES = {
  productName: [
    // ko
    '상품명', '제품명', '상품', '제품', '아이템명', '상품명/옵션', '상품명(옵션)',
    // en
    'product', 'product name', 'productname', 'product_name', 'productTitle', 'product title',
    'item', 'item name', 'itemname', 'item_name',
    'goods', 'goods name', 'goodsname', 'goods_name',
    // 'name' 단독은 의미가 너무 모호해(고객명·옵션명 등과 충돌) 일부러 제외.
    // 셀러는 ColumnMappingTable 에서 직접 선택 가능.
  ],
  optionName: [
    // ko
    '옵션', '옵션명', '옵션정보', '선택옵션', '구매옵션', '상품옵션',
    // en
    'option', 'option name', 'optionname', 'option_name',
    'variant', 'variant name', 'variantname', 'variant_name',
    'sku', 'sku option', 'skuoption', 'sku_option',
  ],
  rating: [
    // ko
    '평점', '별점', '점수', '리뷰평점', '상품평점', '만족도',
    // en
    'rating', 'score', 'stars', 'star', 'star rating', 'starrating', 'star_rating',
    'review rating', 'reviewrating', 'review_rating',
  ],
  title: [
    // ko
    '제목', '리뷰제목', '후기제목',
    // en
    'title', 'review title', 'reviewtitle',
  ],
  content: [
    // ko
    '리뷰내용', '리뷰', '후기', '내용', '구매후기', '상품평', '본문',
    // en
    'review', 'review text', 'reviewtext', 'review_text',
    'review content', 'reviewcontent', 'review_content',
    'comment', 'comments', 'content', 'body', 'message', 'feedback',
    // 'text' 단독은 의미가 너무 모호해 일부러 제외 — 'review text' 는 위 항목으로 커버됨.
  ],
  createdAt: [
    // ko
    '작성일', '등록일', '리뷰작성일', '작성일자', '등록일자', '날짜', '일자',
    // en
    'date', 'review date', 'reviewdate', 'review_date',
    'created at', 'createdat', 'created_at',
    'created date', 'createddate', 'created_date',
    'written date', 'writtendate', 'written_date',
    'registered at', 'registeredat', 'registered_at',
  ],
  replyText: [
    // ko
    '답글', '댓글', '판매자답글', '답변', '관리자답변',
    // en
    'reply', 'response', 'seller reply', 'sellerreply',
  ],
  reviewId: [
    // ko
    '리뷰번호', '후기번호', '게시글번호', '리뷰id', '리뷰 ID',
    // en — 'id' 는 너무 짧아 충돌 위험이 있어 우선순위에서 후순위로 둠 (아래 priority 참조)
    'review id', 'reviewid', 'review_id', 'id', 'article_no',
  ],
  writer: [
    // ko
    '작성자', '아이디', '닉네임', '구매자',
    // en
    'writer', 'user', 'username', 'author', 'reviewer', 'nickname',
  ],
};

export const FIELDS = Object.keys(FIELD_CANDIDATES);

// 플랫폼별 컬럼명 후보. 공통 후보에 추가로 매칭될 경우 가산점을 준다.
// 양식은 판매자센터 설정/다운로드 메뉴에 따라 달라질 수 있으므로 자동 매핑 후 사용자 확인 권장.
export const SOURCE_FIELD_CANDIDATES = {
  smartstore: {
    productName: ['상품명', '상품명/옵션', '주문상품명', '판매상품명', '상품정보', '상품', '제품명', '상품명(옵션)', '상품주문명'],
    optionName: ['옵션', '옵션명', '옵션정보', '상품옵션', '선택옵션', '구매옵션', '구매옵션명', '옵션내용', '옵션 조합'],
    rating: ['평점', '별점', '구매자평점', '리뷰평점', '상품평점', '만족도', '평가점수'],
    title: ['제목', '리뷰제목', '후기제목', '상품평제목'],
    content: ['리뷰내용', '리뷰상세내용', '후기내용', '구매후기', '상품평', '상품평내용', '내용', '리뷰', '후기'],
    createdAt: ['작성일', '작성일시', '등록일', '등록일시', '리뷰작성일', '작성일자', '등록일자'],
    replyText: ['답글', '답변', '판매자답글', '판매자답변', '관리자답변', '관리자답변내용', '댓글'],
    reviewId: ['리뷰번호', '리뷰ID', '후기번호', '게시글번호', '주문번호', '상품주문번호'],
    writer: ['작성자', '구매자', '구매자명', '닉네임', '아이디', '회원ID', '작성자ID'],
  },
  cafe24: {
    productName: ['상품명', '상품정보', '관련상품', '제품명', '상품', '상품명/옵션', '상품명(옵션)'],
    optionName: ['옵션', '옵션명', '옵션정보', '상품옵션', '선택옵션', '옵션내용'],
    rating: ['평점', '별점', '상품평점', '리뷰평점', '만족도', '평가'],
    title: ['제목', '글제목', '게시글제목', '리뷰제목', '후기제목'],
    content: ['내용', '글내용', '본문', '후기내용', '리뷰내용', '상품후기', '상품사용후기', '게시글내용', '상품평내용'],
    createdAt: ['작성일', '작성일시', '등록일', '등록일시', '게시일', '게시일시'],
    replyText: ['답변', '답변내용', '관리자답변', '관리자답변내용', '댓글', '답글', '운영자답변'],
    reviewId: ['게시글번호', '글번호', '번호', 'article_no', '리뷰번호', '후기번호'],
    writer: ['작성자', '작성자명', '회원ID', '아이디', '닉네임', '구매자'],
  },
  coupang: {
    productName: ['상품명', '노출상품명', '판매상품명', '제품명', '상품', '상품명/옵션', '등록상품명'],
    optionName: ['옵션', '옵션명', '구매옵션', '구매옵션명', '선택옵션', '옵션정보', '옵션내용'],
    rating: ['평점', '별점', '상품평점', '리뷰평점', '만족도', '평가점수'],
    title: ['제목', '리뷰제목', '상품평제목', '후기제목'],
    content: ['상품평', '상품평내용', '리뷰내용', '리뷰상세내용', '구매후기', '후기내용', '내용', '리뷰'],
    createdAt: ['상품평작성일', '작성일', '작성일시', '등록일', '등록일시', '리뷰작성일'],
    replyText: ['판매자답글', '판매자답변', '답글', '답변', '댓글'],
    reviewId: ['리뷰번호', '상품평번호', '후기번호', 'review_id', 'id'],
    writer: ['구매자', '구매자명', '작성자', '닉네임', '아이디'],
  },
  custom: {},
};

// 컬럼 헤더와 후보 간 이름 점수 (0 / 70 / 90 / 100)
function nameScore(header, candidate) {
  const h = normalizeKey(header);
  const c = normalizeKey(candidate);
  if (!h || !c) return 0;
  if (header.trim() === candidate.trim()) return 100; // 정확 일치
  if (h === c) return 90; // 공백/기호 제거 후 일치
  if (h.includes(c) || c.includes(h)) return 70; // 포함 관계
  return 0;
}

// 데이터 패턴 가산점
function dataBonus(field, values) {
  const samples = values.filter((v) => v !== '' && v != null).slice(0, 30);
  if (samples.length === 0) return 0;

  if (field === 'rating') {
    const nums = samples
      .map((v) => Number(String(v).replace(/[^\d.]/g, '')))
      .filter((n) => !Number.isNaN(n));
    if (nums.length && nums.every((n) => n >= 1 && n <= 5)) return 20;
  }
  if (field === 'createdAt') {
    const ok = samples.filter((v) => looksLikeDate(v)).length;
    if (ok / samples.length >= 0.5) return 20;
  }
  if (field === 'content') {
    const longCount = samples.filter((v) => isLongText(v)).length;
    if (longCount / samples.length >= 0.4) return 20;
  }
  return 0;
}

// 한 필드의 전체 후보 어휘. 공통 + 플랫폼별을 중복 제거해 합친다.
// source 가 알 수 없으면 공통만 사용 (자사몰/custom 처리).
function candidatesForField(field, source) {
  const common = FIELD_CANDIDATES[field] || [];
  const src = SOURCE_FIELD_CANDIDATES[source]?.[field] || [];
  return Array.from(new Set([...common, ...src]));
}

// 헤더 ↔ 한 필드 점수: 이름 점수 + (source 후보 매칭 시 +10 가산점)
// source 가 custom/unknown 이면 sourceBoost=0.
function fieldScoreForHeader(field, source, header) {
  const commonBest = Math.max(0, ...(FIELD_CANDIDATES[field] || []).map((c) => nameScore(header, c)));
  const sourceList = SOURCE_FIELD_CANDIDATES[source]?.[field] || [];
  const sourceBest = Math.max(0, ...sourceList.map((c) => nameScore(header, c)));
  const nameBest = Math.max(commonBest, sourceBest);
  // source 후보와 매칭된 경우만 가산점 (+10). 단, 공통 후보로도 잡힌 경우와 중복 부여하지 않는다.
  const sourceBonus = sourceBest > 0 ? 10 : 0;
  // matchedFrom: 어떤 후보 묶음에서 매칭됐는지 (응답 reason 용)
  let matchedFrom = null;
  if (nameBest > 0) {
    if (sourceBest >= commonBest && sourceBest > 0) matchedFrom = source;
    else if (commonBest > 0) matchedFrom = 'common';
  }
  return { nameBest, sourceBonus, matchedFrom };
}

// 헤더 목록 + 샘플 행 + source 로 필드별 최적 컬럼 후보를 점수화해 산출한다.
// 입력: headers(string[]), rows(object[] — 마스킹된 행이어도 무방), source('smartstore'|'cafe24'|'coupang'|'custom'|기타)
// 출력: { field: { column, score, reason, matchedFrom } }
//   - score: 이름 점수 + source 가산점(있을 때) + dataBonus
//   - reason: 한국어 한 줄 설명 (소스 매칭/공통 매칭/데이터 패턴 등)
//   - matchedFrom: 'smartstore'|'cafe24'|'coupang'|'common'|null
// source 가 비어 있거나 SOURCE_FIELD_CANDIDATES 에 없으면 'custom' 처리(공통 후보만).
export function autoMapColumns(headers, rows, source = 'custom') {
  const sourceKey = source && SOURCE_FIELD_CANDIDATES[source] ? source : 'custom';
  const columnValues = {};
  for (const h of headers) columnValues[h] = rows.map((r) => r[h]);

  // 1) 각 필드별 모든 헤더 점수 계산
  const scored = {};
  for (const field of FIELDS) {
    scored[field] = headers.map((header) => {
      const { nameBest, sourceBonus, matchedFrom } = fieldScoreForHeader(field, sourceKey, header);
      const bonus = nameBest > 0 ? dataBonus(field, columnValues[header]) : 0;
      return {
        header,
        nameBest,
        sourceBonus,
        dataBonus: bonus,
        score: nameBest + sourceBonus + bonus,
        matchedFrom,
      };
    });
  }

  // 2) 우선순위에 따라 1:1 배정 (충돌 방지)
  //    content(리뷰 내용) > rating(별점) > productName > createdAt > optionName 순.
  //    'product rating' 처럼 두 후보에 겹치는 헤더가 있을 때 rating 이 먼저 가져가도록.
  const priority = ['content', 'rating', 'productName', 'createdAt', 'optionName', 'title', 'replyText', 'reviewId', 'writer'];
  const result = {};
  const usedHeaders = new Set();
  for (const field of priority) {
    const candidates = scored[field]
      .filter((c) => c.score > 0 && !usedHeaders.has(c.header))
      .sort((a, b) => b.score - a.score);
    const top = candidates[0];
    if (top && top.score >= 60) {
      const parts = [];
      if (top.matchedFrom && top.matchedFrom !== 'common') {
        parts.push(`${platformLabel(top.matchedFrom)} 후보 컬럼명과 일치`);
      } else if (top.matchedFrom === 'common') {
        parts.push('공통 후보와 일치');
      }
      if (top.dataBonus > 0) parts.push('데이터 패턴 일치');
      result[field] = {
        column: top.header,
        score: top.score,
        reason: parts.join(' · ') || '이름 점수 기반 매칭',
        matchedFrom: top.matchedFrom,
      };
      usedHeaders.add(top.header);
    } else {
      result[field] = {
        column: null,
        score: top ? top.score : 0,
        reason: null,
        matchedFrom: null,
      };
    }
  }

  return result; // { field: { column, score, reason, matchedFrom } }
}

function platformLabel(key) {
  switch (key) {
    case 'smartstore': return '스마트스토어';
    case 'cafe24': return '카페24';
    case 'coupang': return '쿠팡';
    default: return key;
  }
}

// 매핑 객체 검증: content(리뷰 내용) + rating(별점) 은 필수.
// rating 이 없으면 긍정/부정 감성 신호의 큰 축이 사라져 분석 품질이 급격히 떨어지므로 차단한다.
export function isMappingValid(mapping) {
  return Boolean(mapping && mapping.content && mapping.rating);
}

// 필수 필드 누락 검사 — UI 가 동일한 한글 라벨을 쓰도록 라벨도 같이 반환.
export const REQUIRED_FIELD_LABELS = { content: '리뷰 내용', rating: '별점' };
export function missingRequiredFieldLabels(mapping) {
  const missing = [];
  for (const [field, label] of Object.entries(REQUIRED_FIELD_LABELS)) {
    if (!mapping?.[field]) missing.push(label);
  }
  return missing;
}

// 외부에서도 확인할 수 있도록 노출 (REPL/디버깅 용)
export { candidatesForField };
