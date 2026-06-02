// 요금제(plan) / 구독(subscription) / 사용량(usage_events) 헬퍼.
// 실제 PG 결제는 미연동 — 이번 단계에서는 무료/유료 제한만 사용한다.
//
// BILLING_ENFORCE_LIMITS=true 인 경우에만 제한이 실제로 작동한다.
// 기본값은 false (MVP 개발 편의). 운영 모드에서는 true 로 설정.
import { nanoid } from 'nanoid';
import db from '../db/database.js';
import { getBooleanSetting, getNumberSetting } from './settings.service.js';
import { getPlanFeatures, resolveLlmPolicy, USAGE_EVENT_TYPES } from '../constants/plans.js';

// app_settings 의 billing_enforce_limits 가 환경변수보다 우선. 없으면 env fallback.
const ENV_ENFORCE = String(process.env.BILLING_ENFORCE_LIMITS || 'false').toLowerCase() === 'true';
export function isLimitsEnforced() {
  return getBooleanSetting('billing_enforce_limits', ENV_ENFORCE);
}
// 하위 호환: 기존 코드/테스트 호환 위해 export. 가급적 isLimitsEnforced() 호출 권장.
export const ENFORCE_LIMITS = ENV_ENFORCE;

// 코드/이름 fallback 용 기본값 (DB seed 가 비어 있을 때 안전망).
const DEFAULT_PLANS = {
  free:     { code: 'free',     name: 'Free',     price_krw: 0, monthly_analysis_limit: 1,   max_reviews_per_analysis: 100 },
  starter:  { code: 'starter',  name: 'Starter',  price_krw: 0, monthly_analysis_limit: 10,  max_reviews_per_analysis: 1000 },
  pro:      { code: 'pro',      name: 'Pro',      price_krw: 0, monthly_analysis_limit: 50,  max_reviews_per_analysis: 5000 },
  business: { code: 'business', name: 'Business', price_krw: 0, monthly_analysis_limit: 200, max_reviews_per_analysis: 50000 },
};

// plans 테이블 + app_settings override 를 합쳐 최종 플랜 객체 반환.
export function getPlanByCode(code) {
  if (!code) code = 'free';
  const row = db.prepare('SELECT * FROM plans WHERE code = ? AND is_active = 1').get(code) || DEFAULT_PLANS[code] || DEFAULT_PLANS.free;
  // app_settings 의 {code}_monthly_analysis_limit / {code}_max_reviews_per_analysis 가 있으면 override.
  const monthLimit = getNumberSetting(`${code}_monthly_analysis_limit`, row.monthly_analysis_limit);
  const reviewLimit = getNumberSetting(`${code}_max_reviews_per_analysis`, row.max_reviews_per_analysis);
  return { ...row, monthly_analysis_limit: monthLimit, max_reviews_per_analysis: reviewLimit };
}

export function listPlans() {
  const rows = db.prepare('SELECT * FROM plans WHERE is_active = 1 ORDER BY price_krw ASC').all();
  return rows.length ? rows : Object.values(DEFAULT_PLANS);
}

// 사용자의 활성 구독 조회. 없으면 자동으로 free 구독 생성.
export function getUserSubscription(userId) {
  if (!userId) return null;
  let sub = db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE user_id = ? AND status IN ('active','trialing')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId);
  if (!sub) {
    const id = nanoid();
    db.prepare(
      `INSERT INTO subscriptions (id, user_id, plan_code, status) VALUES (?, ?, 'free', 'active')`,
    ).run(id, userId);
    sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  }
  return sub;
}

// 이번 달(=현재 캘린더 월) 동안의 특정 event_type usage 합계.
export function getMonthlyUsage(userId, eventType) {
  if (!userId) return 0;
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM usage_events
       WHERE user_id = ? AND event_type = ?
         AND created_at >= datetime('now', 'start of month')`,
    )
    .get(userId, eventType);
  return Number(row?.total || 0);
}

// 사용량 이벤트 기록.
export function recordUsage(userId, eventType, { analysisId, uploadId, amount = 1, metadata } = {}) {
  if (!userId) return null;
  const id = nanoid();
  db.prepare(
    `INSERT INTO usage_events (id, user_id, event_type, analysis_id, upload_id, amount, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    eventType,
    analysisId || null,
    uploadId || null,
    amount,
    metadata ? JSON.stringify(metadata) : null,
  );
  return id;
}

// 분석 생성 가능 여부 체크.
// 실패 시 { ok:false, status, body } 를 반환. 라우트에서 res.status().json() 하면 된다.
export function checkCanCreateAnalysis(userId, reviewCount) {
  if (!isLimitsEnforced()) return { ok: true };
  if (!userId) return { ok: true }; // 익명 데모 모드 — billing 적용 안 함
  const sub = getUserSubscription(userId);
  const plan = getPlanByCode(sub?.plan_code || 'free');
  const monthLimit = plan.monthly_analysis_limit;
  const reviewLimit = plan.max_reviews_per_analysis;

  if (reviewLimit != null && reviewCount > reviewLimit) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'REVIEW_LIMIT_EXCEEDED',
        message: `현재 플랜에서는 파일당 최대 ${reviewLimit}개 리뷰까지 분석할 수 있습니다.`,
        planCode: plan.code,
        limit: reviewLimit,
        received: reviewCount,
      },
    };
  }
  if (monthLimit != null) {
    const used = getMonthlyUsage(userId, 'analysis_created');
    if (used >= monthLimit) {
      return {
        ok: false,
        status: 402,
        body: {
          error: 'PLAN_LIMIT_EXCEEDED',
          message: '현재 플랜의 월 분석 횟수를 초과했습니다.',
          planCode: plan.code,
          limit: monthLimit,
          used,
        },
      };
    }
  }
  return { ok: true };
}

// /api/me 응답용 — user + subscription + 이번 달 사용량 + 플랜 기능 플래그.
export function buildMeContext(user) {
  if (!user) return null;
  const sub = getUserSubscription(user.id);
  const plan = getPlanByCode(sub?.plan_code || 'free');
  const features = getPlanFeatures(plan.code);
  const monthlyAnalysisUsed = getMonthlyUsage(user.id, USAGE_EVENT_TYPES.ANALYSIS_CREATED);
  const monthlyFileUsed = getMonthlyUsage(user.id, USAGE_EVENT_TYPES.FILE_UPLOADED);
  const monthlyCsReplyUsed = getMonthlyUsage(user.id, USAGE_EVENT_TYPES.CS_REPLY_GENERATED);
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    subscription: sub
      ? {
          planCode: sub.plan_code,
          planName: plan.name,
          planLabel: features.label,
          planTagline: features.tagline,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end,
        }
      : null,
    usage: {
      monthlyAnalysisUsed,
      monthlyAnalysisLimit: plan.monthly_analysis_limit,
      maxReviewsPerAnalysis: plan.max_reviews_per_analysis,
      monthlyFileUsed,
      monthlyFileLimit: features.monthlyFileLimit,
      monthlyCsReplyUsed,
      monthlyCsReplyLimit: features.monthlyCsReplyLimit,
      monthlyReviewLimit: features.monthlyReviewLimit,
      maxProductsPerFile: features.maxProductsPerFile,
      dataRetentionDays: features.dataRetentionDays,
    },
    // 프론트가 disable/show 결정에 쓰는 기능 플래그. UI 에는 "Free 플랜이라
    // 안 됩니다" 같은 안내 + 상위 플랜 CTA 를 띄우면 된다.
    features: {
      canExportFullExcel: features.canExportFullExcel,
      canPrintFullReport: features.canPrintFullReport,
      printWatermark: features.printWatermark,
      canViewAllRelatedReviews: features.canViewAllRelatedReviews,
      canUsePrecisionAnalysis: features.canUsePrecisionAnalysis,
      llmMode: features.llmMode,
    },
    // 플랜의 LLM 정책 — 관리자가 플랜을 바꾸면 다음 /api/me 호출부터 곧장 새 값으로
    // 갱신된다 (영구 캐시 없음). 모델명 자체는 운영 ENV override 가 우선.
    llmPolicy: (() => {
      const p = resolveLlmPolicy(plan.code);
      return {
        mode: p.llmMode,
        reviewModel: p.reviewModel,
        summaryModel: p.summaryModel,
        csReplyModel: p.csReplyModel,
        precisionModel: p.precisionModel,
        advancedReportModel: p.advancedReportModel,
        allowMiniReanalysis: p.allowMiniReanalysis && Boolean(p.precisionModel),
        maxMiniReanalysisRatio: p.maxMiniReanalysisRatio,
      };
    })(),
    billingEnforced: isLimitsEnforced(),
  };
}

// CS 답글 생성 가능 여부 — 플랜의 월 CS 답글 한도 검사.
export function checkCanGenerateCsReply(userId, count = 1) {
  if (!isLimitsEnforced()) return { ok: true };
  if (!userId) return { ok: true };
  const sub = getUserSubscription(userId);
  const features = getPlanFeatures(sub?.plan_code || 'free');
  const used = getMonthlyUsage(userId, USAGE_EVENT_TYPES.CS_REPLY_GENERATED);
  if (used + count > features.monthlyCsReplyLimit) {
    return {
      ok: false,
      status: 402,
      body: {
        error: 'CS_REPLY_LIMIT_EXCEEDED',
        message: `현재 플랜의 월 CS 답글 초안 한도(${features.monthlyCsReplyLimit}건)를 초과했습니다.`,
        planCode: sub?.plan_code || 'free',
        limit: features.monthlyCsReplyLimit,
        used,
      },
    };
  }
  return { ok: true };
}

// 파일 업로드 가능 여부 — 플랜의 월 파일 한도 검사.
export function checkCanUploadFile(userId) {
  if (!isLimitsEnforced()) return { ok: true };
  if (!userId) return { ok: true };
  const sub = getUserSubscription(userId);
  const features = getPlanFeatures(sub?.plan_code || 'free');
  const used = getMonthlyUsage(userId, USAGE_EVENT_TYPES.FILE_UPLOADED);
  if (used >= features.monthlyFileLimit) {
    return {
      ok: false,
      status: 402,
      body: {
        error: 'FILE_LIMIT_EXCEEDED',
        message: `현재 플랜의 월 파일 업로드 한도(${features.monthlyFileLimit}건)를 초과했습니다.`,
        planCode: sub?.plan_code || 'free',
        limit: features.monthlyFileLimit,
        used,
      },
    };
  }
  return { ok: true };
}

// 관리자 콘솔 — 특정 사용자의 이번 달 사용량 모두 초기화.
// (테스트/디버그 용 — 운영에서는 신중히 사용)
export function resetMonthlyUsage(userId) {
  if (!userId) return 0;
  const r = db.prepare(
    `DELETE FROM usage_events WHERE user_id = ?
     AND created_at >= datetime('now', 'start of month')`,
  ).run(userId);
  return r.changes || 0;
}
