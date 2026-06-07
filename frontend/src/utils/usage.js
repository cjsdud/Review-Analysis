// 사용자에게 보여줄 사용량 요약 — /api/me 응답을 안전한 형태로 정규화.
//
// 백엔드 buildMeContext (backend/src/services/billing.service.js) 가 이미
// usage.monthlyAnalysisUsed/Limit 등을 제공하므로 여기서는 (1) null 안전,
// (2) 한국어 라벨 / 단위, (3) ratio + status 계산만 한다.
//
// 사용자 UI 에는 raw/row 같은 표현 없이 "이번 달 리뷰 분석" 등 자연스러운 문구.

const PLAN_LABEL = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
};

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// limit 이 null/undefined 이면 "제한 없음" 으로 간주, ratio 와 status 는 normal.
function buildItem({ key, label, used, limit, unit }) {
  const u = Math.max(0, safeNum(used));
  const hasLimit = limit != null && limit !== '' && Number.isFinite(Number(limit));
  const lim = hasLimit ? Math.max(0, safeNum(limit)) : null;
  const remaining = hasLimit ? Math.max(0, lim - u) : null;
  const ratio = hasLimit && lim > 0 ? Math.min(1, u / lim) : 0;
  let status = 'normal';
  if (hasLimit) {
    if (lim === 0) status = 'danger';
    else if (u >= lim) status = 'danger';
    else if (ratio >= 0.8) status = 'warning';
  }
  return { key, label, unit, used: u, limit: lim, remaining, ratio, status, hasLimit };
}

// meResponse: /api/me 응답 객체. null 이면 null 반환.
// 반환:
//   { plan, planCode, planTagline, items: [{key, label, used, limit, remaining, ratio, status, hasLimit, unit}], overallStatus }
export function normalizeUsageSummary(meResponse) {
  if (!meResponse) return null;
  const sub = meResponse.subscription || null;
  const usage = meResponse.usage || {};
  const planCode = (sub?.planCode || 'free').toLowerCase();
  const plan = sub?.planLabel || sub?.planName || PLAN_LABEL[planCode] || 'Free';

  const items = [
    buildItem({
      key: 'monthlyAnalysis',
      label: '이번 달 리뷰 분석',
      used: usage.monthlyAnalysisUsed,
      limit: usage.monthlyAnalysisLimit,
      unit: '회',
    }),
    buildItem({
      key: 'monthlyFile',
      label: '파일 업로드',
      used: usage.monthlyFileUsed,
      limit: usage.monthlyFileLimit,
      unit: '건',
    }),
    buildItem({
      key: 'monthlyCsReply',
      label: 'CS 답글 초안',
      used: usage.monthlyCsReplyUsed,
      limit: usage.monthlyCsReplyLimit,
      unit: '건',
    }),
  ];

  // 전체 상태 — 항목 중 가장 나쁜 상태.
  const overallStatus = items.some((i) => i.status === 'danger') ? 'danger'
    : items.some((i) => i.status === 'warning') ? 'warning'
    : 'normal';

  return {
    plan,
    planCode,
    planTagline: sub?.planTagline || null,
    items,
    overallStatus,
  };
}

// "1,200 / 3,000회" 형태의 짧은 표기. limit 이 없으면 "1,200회" 만.
export function formatUsageLine(item) {
  if (!item) return '';
  const used = item.used.toLocaleString();
  const unit = item.unit || '';
  if (!item.hasLimit) return `${used}${unit}`;
  return `${used} / ${item.limit.toLocaleString()}${unit}`;
}

// 상태 라벨 — "한도 임박" / "한도 도달".
export function usageStatusLabel(status) {
  if (status === 'danger') return '한도 도달';
  if (status === 'warning') return '한도 임박';
  return null;
}
