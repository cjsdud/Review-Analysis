// 요금제 카드 페이지. 실제 결제는 미연동 — "결제 준비 중" 버튼만 표시.
//
// 데이터 출처: GET /api/plans/features (PLAN_FEATURES SSOT).
// 백엔드 PLAN_FEATURES 가 바뀌면 프론트 표시도 자동으로 따라간다.
// API 실패 시 안전한 fallback 카드(기본 4 플랜) 노출.
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { getPlanFeatures } from '../api/plansApi.js';

const FALLBACK_PLANS = [
  { code: 'free',     name: 'Free',     label: 'Free',     tagline: '가볍게 체험하기', priceKrw: 0, limits: {}, features: {} },
  { code: 'starter',  name: 'Starter',  label: 'Starter',  tagline: '소규모 셀러용',   priceKrw: 0, limits: {}, features: {} },
  { code: 'pro',      name: 'Pro',      label: 'Pro',      tagline: '리뷰가 많은 셀러용', priceKrw: 0, limits: {}, features: {} },
  { code: 'business', name: 'Business', label: 'Business', tagline: '브랜드/팀 운영용', priceKrw: 0, limits: {}, features: {} },
];

function formatNum(n) {
  if (n == null) return '제한 없음';
  return Number(n).toLocaleString('ko-KR');
}
function formatPrice(krw) {
  if (krw == null) return '문의';
  if (krw === 0) return '무료';
  return `${krw.toLocaleString('ko-KR')}원/월`;
}
function boolMark(v) { return v ? '✓' : '—'; }

function PlanCard({ plan, currentCode, modesByMinPlan }) {
  const isCurrent = plan.code === currentCode;
  const limits = plan.limits || {};
  const features = plan.features || {};
  const enabledModes = modesByMinPlan?.[plan.code] || [];

  return (
    <div className={`pricing-card${isCurrent ? ' is-current' : ''}`}>
      <div className="pricing-card__name">{plan.label || plan.name}</div>
      {plan.tagline && <div className="pricing-card__tagline muted">{plan.tagline}</div>}
      <div className="pricing-card__price">
        {plan.priceKrw === 0 ? formatPrice(0) : <span className="muted">가격 준비 중</span>}
      </div>

      <ul className="pricing-card__features">
        <li>월 리뷰 분석 <b>{formatNum(limits.monthlyAnalysisLimit)}회</b></li>
        <li>파일당 최대 리뷰 <b>{formatNum(limits.maxReviewsPerAnalysis)}개</b></li>
        <li>월 파일 업로드 <b>{formatNum(limits.monthlyFileLimit)}건</b></li>
        <li>
          CS 답글 말투{' '}
          <b>{plan.code === 'free' ? '정중한 말투만' : '5종 전부'}</b>
        </li>
        <li>파일당 상품 <b>{formatNum(limits.maxProductsPerFile)}개</b></li>
        <li>데이터 보관 <b>{limits.dataRetentionDays != null ? `${limits.dataRetentionDays}일` : '—'}</b></li>
        <li className="pricing-card__feat">엑셀 전체 다운로드 {boolMark(features.canExportFullExcel)}</li>
        <li className="pricing-card__feat">인쇄 리포트 {boolMark(features.canPrintFullReport)}{features.printWatermark ? <span className="muted"> · 워터마크</span> : ''}</li>
        <li className="pricing-card__feat">정밀 분석 {boolMark(features.canUsePrecisionAnalysis)}</li>
        <li className="pricing-card__feat">기간별 리뷰 변화 {boolMark(features.periodComparison)}</li>
      </ul>

      {enabledModes.length > 0 && (
        <div className="pricing-card__modes">
          <div className="pricing-card__modes-label">사용 가능한 분석 방식</div>
          <div>
            {enabledModes.map((m) => (
              <span key={m.id} className="tag tag--neutral pricing-card__mode-tag">{m.label}</span>
            ))}
          </div>
        </div>
      )}

      {isCurrent ? (
        <button className="btn btn--ghost" disabled>현재 플랜</button>
      ) : plan.code === 'free' ? (
        <button className="btn btn--ghost" disabled>기본 플랜</button>
      ) : (
        <button className="btn btn--primary" disabled title="실제 결제는 곧 제공됩니다">
          결제 준비 중
        </button>
      )}
    </div>
  );
}

// minPlan 기준으로 각 plan 에서 사용 가능한 모든 분석 모드를 누적.
// 예: starter 는 free 의 quick + starter 의 standard/batch 모두 가능.
function buildModesByMinPlan(modes) {
  const order = { free: 0, starter: 1, pro: 2, business: 3 };
  const result = { free: [], starter: [], pro: [], business: [] };
  for (const planCode of Object.keys(result)) {
    const planRank = order[planCode];
    result[planCode] = modes.filter((m) => order[m.minPlan] <= planRank);
  }
  return result;
}

export default function PricingPage() {
  const { subscription } = useAuth();
  const [plans, setPlans] = useState([]);
  const [analysisModes, setAnalysisModes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const data = await getPlanFeatures();
      if (Array.isArray(data.plans) && data.plans.length) {
        setPlans(data.plans);
        setAnalysisModes(Array.isArray(data.analysisModes) ? data.analysisModes : []);
      } else {
        // 백엔드 응답 비어 있거나 실패 → fallback 카드 표시 + 안내.
        setPlans(FALLBACK_PLANS);
        setError('요금제 정보를 불러올 수 없어 기본 비교만 표시했어요.');
      }
      setLoading(false);
    })();
  }, []);

  const modesByMinPlan = analysisModes.length ? buildModesByMinPlan(analysisModes) : null;

  if (loading) return <LoadingState title="요금제 정보를 불러오는 중..." />;

  return (
    <div>
      <PageHeader
        title="요금제"
        subtitle="실제 결제 연동은 준비 중입니다. 현재는 모든 신규 계정이 Free 플랜으로 시작합니다."
      />

      {error && (
        <div className="hint-banner" style={{ marginBottom: 12 }}>{error}</div>
      )}

      <SectionCard
        title="플랜 비교"
        subtitle="월 분석 횟수, 파일 업로드 한도, 기능 차이를 함께 비교합니다."
      >
        <div className="pricing-grid">
          {plans.map((p) => (
            <PlanCard
              key={p.code}
              plan={p}
              currentCode={subscription?.planCode}
              modesByMinPlan={modesByMinPlan}
            />
          ))}
        </div>
      </SectionCard>

      <div className="ops-note">
        <span className="ops-note__ico">ℹ️</span>
        <div>
          구독 결제는 추후 PG(토스페이먼츠/포트원) 연동 후 제공될 예정입니다. 자세한 계획은
          {' '}<code>docs/billing-integration-plan.md</code> 참고.
        </div>
      </div>
    </div>
  );
}
