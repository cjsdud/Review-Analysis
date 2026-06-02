// LLM 분석 서비스 통합 진입점.
// 기존 aiClient.service.js 가 이미 provider 전환(mock/openai/gemini/claude) +
// JSON 파싱 + auth-disabled fallback + 재시도 가드 까지 구현되어 있어,
// 이 모듈은 그 위에 다음 spec 의 추가 책임만 얇게 얹는다:
//
//  - PROMPT_VERSION / ANALYSIS_VERSION: 프롬프트 변경 시 캐시 무효화 키
//  - reviewHash(): 같은 리뷰 + 같은 promptVersion 이면 재분석하지 않도록 키 생성
//  - selectLlmMode(planFeatures): 플랜의 llmMode 를 보고 정밀 재분석 여부 결정
//  - shouldReanalyze(classification): 애매한 리뷰 mini 재분석 조건 판단
//
// 실제 OpenAI 호출이나 token usage 로깅은 aiClient.service.js 안에서 이미 일어나며,
// 이 파일은 호출자(productAnalysis 등) 가 한 곳에서 정책을 보도록 모은다.
import crypto from 'node:crypto';
import aiClient from '../aiClient.service.js';
import { resolveLlmPolicy, getPlanFeatures } from '../../constants/plans.js';

// 프롬프트가 바뀌면 올려서 캐시 무효화. 모든 새 reviewHash 가 이 값을 포함한다.
export const PROMPT_VERSION = 'v1.2026.06';
// 분석 기준(룰 + 모델) 자체가 바뀌면 올린다.
export const ANALYSIS_VERSION = 'v2.aspect-vs-issue';

// 리뷰 본문 + promptVersion → SHA-1 hex. 캐시 키 / dedupe 용.
// 같은 리뷰가 두 번 분석 요청되어도 같은 해시면 결과를 재사용할 수 있다.
export function reviewHash(content = '', promptVersion = PROMPT_VERSION) {
  const h = crypto.createHash('sha1');
  h.update(String(content || ''));
  h.update('|');
  h.update(promptVersion);
  return h.digest('hex');
}

// planCode → 실제 호출 정책. PLAN_LLM_POLICY + env override 를 합쳐 반환한다.
// 호출 측은 이 결과로만 "어떤 모델을 / mini 재분석을 켤지" 를 결정해야 한다.
// 관리자 콘솔에서 플랜을 바꾸면 다음 호출부터 즉시 새 정책이 적용됨.
//
// 입력은 planCode (권장) 또는 features 객체(하위 호환). features 만 들어오면
// llmMode 만 보고 비슷한 기본값을 채워 반환.
export function selectLlmMode(planOrFeatures = 'free') {
  // 하위 호환: features 객체가 들어오면 그 안 llmMode 로 plan 추정.
  let planCode = planOrFeatures;
  if (planOrFeatures && typeof planOrFeatures === 'object') {
    const mode = planOrFeatures.llmMode;
    planCode = mode === 'advanced' ? 'business'
      : mode === 'precision' ? 'pro'
      : mode === 'standard' ? 'starter'
      : 'free';
  }
  const policy = resolveLlmPolicy(planCode);
  const features = getPlanFeatures(planCode);
  return {
    planCode,
    mode: policy.llmMode,
    reviewModel: policy.reviewModel,
    summaryModel: policy.summaryModel,
    csReplyModel: policy.csReplyModel,
    precisionModel: policy.precisionModel,
    advancedReportModel: policy.advancedReportModel,
    allowMiniReanalysis: policy.allowMiniReanalysis && Boolean(policy.precisionModel),
    maxMiniReanalysisRatio: policy.maxMiniReanalysisRatio,
    maxCsRepliesPerMonth: policy.maxCsRepliesPerMonth,
    allowBrandToneReply: policy.llmMode === 'advanced' && Boolean(policy.advancedReportModel),
    canUsePrecisionAnalysis: features.canUsePrecisionAnalysis,
    // mock 환경에서는 어떤 모드든 mock 응답으로 fallback (aiClient.aiMode === 'mock').
    realLlm: aiClient.aiMode !== 'mock',
  };
}

// 애매한 리뷰 — mini 재분석을 다시 돌릴지 판단.
// spec PART 6 의 9 가지 조건:
//   1) confidence < 0.70
//   2) sentiment = 'mixed'
//   3) positive 인데 improvementIssues 가 있음
//   4) negative 인데 강한 칭찬 표현 (textOnly 신호) 있음 — 호출자가 sig 를 넘겨야 정확
//   5) ratingReliable=true 인데 rating 과 sentiment 충돌
//   6) high severity issue 보유
//   7) improvementIssues 가 3개 이상
//   8) 반전 표현 — 호출자가 텍스트를 같이 넘기면 검사
//   9) 리뷰가 너무 짧음 (< 6 chars)
// classification: classifyReview() 결과 그대로.
// content: 원본(마스킹 된) 텍스트.
// policy: selectLlmMode(planCode) 결과 — allowMiniReanalysis=false 면 어떤 조건이든 false 반환.
export function shouldReanalyze(classification, content = '', policy = null) {
  if (!classification) return false;
  // 플랜 정책이 mini 재분석을 금지하면 즉시 false — Free/Starter 비용 가드.
  if (policy && policy.allowMiniReanalysis === false) return false;
  const issues = classification.improvementIssues || [];
  const maxConfidence = (classification.categories || [])
    .reduce((m, c) => Math.max(m, c.confidence || 0), 0);
  if (maxConfidence > 0 && maxConfidence < 0.7) return true;
  if (classification.sentiment === 'mixed') return true;
  if (classification.sentiment === 'positive' && issues.length > 0) return true;
  if (classification.ratingReliable && classification.rating != null) {
    const r = Number(classification.rating);
    if (r >= 4 && classification.sentiment === 'negative') return true;
    if (r <= 2 && classification.sentiment === 'positive') return true;
  }
  if (issues.some((i) => i.severity === 'high')) return true;
  if (issues.length >= 3) return true;
  const text = String(content || '');
  if (text.length > 0 && text.length < 6) return true;
  if (/하지만|근데|다만|아쉽|그런데/.test(text)) return true;
  return false;
}

// 실제 LLM 호출은 aiClient.service.js 에서 수행. 호출자는 이 객체를 통해
// "provider 모드 / 정책" 만 확인하고 기존 인터페이스(generate*) 를 그대로 쓰면 된다.
export { aiClient };
