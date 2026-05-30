// 요금제 카드 페이지. 실제 결제는 미연동 — "결제 준비 중" 버튼만 표시한다.
import { useEffect, useState } from 'react';
import { getPlans } from '../api/authApi.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import LoadingState from '../components/LoadingState.jsx';

function formatPrice(krw) {
  if (krw == null) return '문의';
  if (krw === 0) return '무료';
  return `${krw.toLocaleString('ko-KR')}원/월`;
}

function PlanCard({ plan, currentCode }) {
  const isCurrent = plan.code === currentCode;
  return (
    <div className={`pricing-card${isCurrent ? ' is-current' : ''}`}>
      <div className="pricing-card__name">{plan.name}</div>
      <div className="pricing-card__price">
        {plan.priceKrw === 0 ? formatPrice(0) : <span className="muted">가격 준비 중</span>}
      </div>
      <ul className="pricing-card__features">
        <li>월 분석 {plan.monthlyAnalysisLimit ?? '무제한'}회</li>
        <li>파일당 최대 리뷰 {plan.maxReviewsPerAnalysis?.toLocaleString('ko-KR') ?? '무제한'}개</li>
        {plan.features && <li className="muted">{plan.features}</li>}
      </ul>
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

export default function PricingPage() {
  const { subscription } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getPlans();
        setPlans(Array.isArray(data) ? data : []);
      } catch {
        setPlans([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingState title="요금제 정보를 불러오는 중..." />;

  return (
    <div>
      <PageHeader
        title="요금제"
        subtitle="실제 결제 연동은 준비 중입니다. 현재는 모든 신규 계정이 Free 플랜으로 시작합니다."
      />

      <SectionCard
        title="플랜 비교"
        subtitle="월 분석 횟수와 파일당 리뷰 수가 플랜별로 다릅니다."
      >
        <div className="pricing-grid">
          {plans.map((p) => (
            <PlanCard key={p.code} plan={p} currentCode={subscription?.planCode} />
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
