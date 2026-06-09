// PLAN_FEATURES SSOT API helper.
// /api/plans/features 응답 — { plans, analysisModes }.
// 호출 실패 시 PricingPage 의 fallback 카드가 노출되도록 빈 객체 반환.
import client from './client.js';

export async function getPlanFeatures() {
  try {
    const { data } = await client.get('/plans/features');
    return data || { plans: [], analysisModes: [] };
  } catch {
    return { plans: [], analysisModes: [] };
  }
}
