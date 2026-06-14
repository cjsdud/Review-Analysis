// CS 답글 초안 — 지원 말투(tone) 단일 출처. 프론트/백엔드 모두 이 파일 또는
// frontend/src/constants/replyTones.js (동일 키/라벨) 를 참조한다.
//
// tone key 5개 고정. legacy 한글 키(기본/정중/친근 …) 는 normalizeReplyTone 에서 흡수.

export const REPLY_TONES = ['polite', 'friendly', 'concise', 'empathetic', 'professional'];

// 사용자에게 노출되는 짧은 라벨 (segmented 버튼 본문).
export const REPLY_TONE_SHORT_LABEL = {
  polite: '정중',
  friendly: '친근',
  concise: '간결',
  empathetic: '공감',
  professional: '전문',
};

// 응답에 함께 실어 보내는 자연어 라벨 — 엑셀 export / 상세 UI 가 사용.
export const REPLY_TONE_FULL_LABEL = {
  polite: '정중한 말투',
  friendly: '친근한 말투',
  concise: '간결한 말투',
  empathetic: '공감형 말투',
  professional: '전문적인 말투',
};

// 분석 시점에 미리 만들어 저장하는 기본 tone — 나머지 4개는 사용자가 탭을 누를 때
// /api/ai/reply-templates 로 lazy fetch 한다. polite 가 가장 광범위하게 적합.
export const DEFAULT_PRECOMPUTED_TONE = 'polite';

// 플랜별 사용 가능한 CS 답글 톤.
//   - free      : 정중(polite) 1개만. 나머지 4개는 잠금 (Starter 이상 안내).
//   - starter+  : 5개 전부.
// 분석 시점 정중 톤은 모든 플랜에서 미리 생성되므로 free 도 정중 답글은 바로 본다.
export function allowedReplyTonesForPlan(planCode) {
  const p = String(planCode || 'free').trim().toLowerCase();
  if (p === 'free') return ['polite'];
  return [...REPLY_TONES];
}
export function isReplyToneAllowedForPlan(planCode, tone) {
  return allowedReplyTonesForPlan(planCode).includes(tone);
}

// 유효성 검사 + 정규화.
export function isValidReplyTone(value) {
  return typeof value === 'string' && REPLY_TONES.includes(value);
}

// legacy 한글 라벨(기본/정중/친근 …) 도 흡수 — 이전 분석으로 만들어진 데이터 호환.
const LEGACY_KO_TO_KEY = {
  기본: 'polite',
  정중: 'polite',
  친근: 'friendly',
  간결: 'concise',
  공감: 'empathetic',
  전문: 'professional',
};

export function normalizeReplyTone(value, fallback = DEFAULT_PRECOMPUTED_TONE) {
  if (!value) return fallback;
  const raw = String(value).trim();
  if (isValidReplyTone(raw)) return raw;
  const lower = raw.toLowerCase();
  if (isValidReplyTone(lower)) return lower;
  if (LEGACY_KO_TO_KEY[raw]) return LEGACY_KO_TO_KEY[raw];
  return fallback;
}
