// CS 답글 초안 — 서버 측 in-memory 캐시.
//
// 적용 배경:
//   feat/cs-reply-tone-pipeline 이후 답글은 (issueLabel, category, tone) 기반의 1톤만 생성한다.
//   prompt 는 raw 리뷰 본문 / 이메일 / 주문번호 등 PII 를 포함하지 않으므로,
//   같은 비식별 조합이 반복 요청되면 동일한 답글이 나와도 안전하다.
//
// 안전 원칙 (개인정보가 캐시 키/값에 들어가지 않게):
//   - cache key 는 enum-like 비식별 조합만 사용.
//     (category, issueLabel, tone, severity, polarity) — 영문/한글 라벨 모두 비식별.
//   - 요청 body 에 review content / customer name / email / orderId / userId 등 개인화
//     필드가 들어오면 캐시 자체를 우회한다 (cacheable=false).
//   - cache value 는 답글 template 문자열이며, 본문에 user 식별자가 들어가지 않는
//     prompt 결과만 들어온다.
//   - 비정상적으로 긴 issueLabel/category (>120자) 도 캐시 거부 — 비정상 입력 방어.
//
// 정책:
//   - 기본 TTL 24시간 (env override 가능: CS_REPLY_CACHE_TTL_MS).
//   - 기본 max size 500 (env override 가능: CS_REPLY_CACHE_MAX_SIZE).
//   - LRU 가 아닌 단순 insertion-order 기반 — 가득 차면 가장 먼저 들어온 키부터 제거.
//     CS reply 호출 규모에서 충분히 효과적이고 코드 복잡도 낮음.
//   - fallback(빈 배열, 또는 정책상 차단) 결과는 캐시하지 않는다 — 일시적 LLM 실패가
//     장기 캐시로 굳어지는 것을 방지.

import { REPLY_TONES, normalizeReplyTone, DEFAULT_PRECOMPUTED_TONE } from '../constants/replyTones.js';

const VERSION = 'v1';
const MAX_LABEL_LEN = 120;

// 개인화 필드 — 들어오면 캐시 자체를 우회 (반대 list 라 false-negative 가능성 ↑ 안전).
const PERSONALIZED_FIELDS = ['content', 'reviewContent', 'review_text', 'customerName', 'orderId', 'email', 'phone'];

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DEFAULT_TTL_MS = envInt('CS_REPLY_CACHE_TTL_MS', 24 * 60 * 60 * 1000);
const DEFAULT_MAX_SIZE = envInt('CS_REPLY_CACHE_MAX_SIZE', 500);

// 공백/개행/탭 정규화 — "허리가  작게 나옴" 과 "허리가 작게 나옴" 이 다른 키로 분리되지 않게.
function normalizeForKey(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// 입력이 캐시 키 후보로 적합한지 검사 (PII / 길이 / 필수값).
// 적합하지 않으면 cacheable=false 로 호출 측이 캐시를 건너뛰게 한다.
export function isCacheableReplyRequest(input) {
  if (!input || typeof input !== 'object') return false;
  for (const f of PERSONALIZED_FIELDS) {
    if (input[f] != null && String(input[f]).trim() !== '') return false;
  }
  const issueLabel = normalizeForKey(input.issueLabel);
  if (!issueLabel || issueLabel.length > MAX_LABEL_LEN) return false;
  const category = normalizeForKey(input.category);
  if (category.length > MAX_LABEL_LEN) return false;
  // tone 자체는 라우트의 zod 가 enum 검증을 끝낸 뒤 들어오므로 여기선 별도 검증 X.
  // (normalizeReplyTone 은 모르는 값은 default 로 떨어뜨려 항상 valid 가 됨.)
  return true;
}

// 키 생성 — 모든 컴포넌트는 정규화된 비식별 값.
//   tone        : enum (5 종)
//   severity    : 기본 'medium' — 강한 사과 여부에 영향
//   polarity    : 기본 'negative'
//   category    : 한국어 라벨 그대로 (빈 문자열 허용)
//   issueLabel  : 정규화된 라벨
export function buildReplyCacheKey(input) {
  const tone = normalizeReplyTone(input?.tone, DEFAULT_PRECOMPUTED_TONE);
  const severity = ['low', 'medium', 'high'].includes(input?.severity) ? input.severity : 'medium';
  const polarity = ['positive', 'negative', 'mixed', 'neutral'].includes(input?.polarity) ? input.polarity : 'negative';
  const category = normalizeForKey(input?.category);
  const issueLabel = normalizeForKey(input?.issueLabel);
  return `cs_reply:${VERSION}:${category}:${issueLabel}:${tone}:${severity}:${polarity}`;
}

// 단일 in-memory store. 프로세스 단위 — Render free instance 가 sleep 후 다시 깨어나면
// 캐시는 비어 있는 상태에서 시작 (괜찮음 — 비용이 살짝 더 들 뿐 정확성 영향 없음).
const store = new Map(); // key → { value, expiresAt, createdAt }
const stats = { hits: 0, misses: 0, sets: 0, evictions: 0, expirations: 0 };

export function getCachedReplyTemplate(key) {
  if (!key) return null;
  const entry = store.get(key);
  if (!entry) {
    stats.misses++;
    return null;
  }
  const now = Date.now();
  if (entry.expiresAt <= now) {
    store.delete(key);
    stats.expirations++;
    stats.misses++;
    return null;
  }
  stats.hits++;
  return entry.value;
}

export function setCachedReplyTemplate(key, value, ttlMs = DEFAULT_TTL_MS, maxSize = DEFAULT_MAX_SIZE) {
  if (!key) return;
  // 빈 결과는 캐시하지 않음 — 일시적 LLM 실패 보호.
  if (!value || (Array.isArray(value) && value.length === 0)) return;

  // max size 초과 시 가장 먼저 들어온 키 제거 (insertion-order).
  while (store.size >= maxSize) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
    stats.evictions++;
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs, createdAt: Date.now() });
  stats.sets++;
}

// 만료 항목 일괄 정리 — 주기 호출이 아니더라도 get 때마다 lazy 만료 처리되므로 필수는 아님.
// 운영 진단/테스트용으로 export.
export function clearExpiredReplyCache() {
  const now = Date.now();
  let removed = 0;
  for (const [k, v] of store.entries()) {
    if (v.expiresAt <= now) {
      store.delete(k);
      removed++;
    }
  }
  return removed;
}

export function getReplyCacheStats() {
  return { ...stats, size: store.size, ttlMs: DEFAULT_TTL_MS, maxSize: DEFAULT_MAX_SIZE };
}

// 테스트 전용 — 캐시 전체 비움.
export function _resetReplyCacheForTests() {
  store.clear();
  stats.hits = stats.misses = stats.sets = stats.evictions = stats.expirations = 0;
}
