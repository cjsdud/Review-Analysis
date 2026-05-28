import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SummaryCards from '../components/SummaryCards.jsx';
import CategoryChart from '../components/CategoryChart.jsx';
import ProductIssueTable from '../components/ProductIssueTable.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import { getAnalysis, exportCsvUrl } from '../api/analysisApi.js';

export default function DashboardPage() {
  const { analysisId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chartType, setChartType] = useState('bar');

  useEffect(() => {
    (async () => {
      try {
        const data = await getAnalysis(analysisId);
        setSummary(data.summary);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [analysisId]);

  function goProduct(productKey) {
    navigate(`/products/${analysisId}/${encodeURIComponent(productKey)}`);
  }

  if (loading) return <LoadingState title="분석 결과를 불러오는 중..." />;
  if (error) return <div className="error-banner">{error}</div>;
  if (!summary || summary.totalReviews === 0)
    return <EmptyState title="분석된 리뷰가 없습니다" actionLabel="리뷰 업로드하기" actionTo="/upload" />;

  const modeLabel = summary.aiMode === 'mock' ? '규칙 기반 + Mock AI' : `규칙 기반 + ${summary.aiMode}`;

  return (
    <div>
      <PageHeader
        title="분석 대시보드"
        subtitle={`분석 방식: ${modeLabel}`}
        actions={
          <>
            <a className="btn btn--ghost btn--sm" href={exportCsvUrl(analysisId)}>
              ⬇️ CSV
            </a>
            <button className="btn btn--ghost btn--sm" onClick={() => window.print()}>
              🖨️ 인쇄 / PDF
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => navigate('/upload')}>
              + 새 분석
            </button>
          </>
        }
      />

      {summary.aiComment && (
        <div className="ai-comment">
          <span className="ai-comment__ico">📌</span>
          <div className="ai-comment__text">{summary.aiComment}</div>
        </div>
      )}

      <SummaryCards summary={summary} />

      <div className="dash-grid">
        <SectionCard
          title="카테고리별 불만 분포"
          subtitle={
            summary.otherCount > 0
              ? `'기타' ${summary.otherCount}건은 보조 항목으로 차트에서 제외했습니다.`
              : undefined
          }
          action={
            <div className="segmented">
              <button className={`segmented__btn${chartType === 'bar' ? ' is-active' : ''}`} onClick={() => setChartType('bar')}>
                막대
              </button>
              <button className={`segmented__btn${chartType === 'pie' ? ' is-active' : ''}`} onClick={() => setChartType('pie')}>
                원형
              </button>
            </div>
          }
        >
          <CategoryChart distribution={summary.categoryDistribution} type={chartType} />
        </SectionCard>

        <SectionCard title="부정 리뷰가 많은 상품 TOP 10" subtitle="별점·감성 기준으로 부정적인 리뷰 수입니다.">
          <ProductIssueTable
            valueLabel="부정 리뷰 수"
            rows={(summary.productRankingByNegative || []).map((p) => ({
              productKey: p.productKey,
              productName: p.productName,
              value: p.negativeReviews,
              sub: `/ ${p.totalReviews}건`,
            }))}
            onSelect={goProduct}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="개선 이슈가 많은 상품 TOP 10"
        subtitle="분석으로 발견된 불만 항목(사이즈·색상·소재 등)이 1개 이상 있는 리뷰 수 — 위 부정 리뷰 수와는 다른 개념입니다. 클릭하면 상세 리포트로 이동합니다."
      >
        <ProductIssueTable
          valueLabel="개선 이슈 발견 리뷰"
          rows={(summary.productRankingByIssues || []).map((p) => ({
            productKey: p.productKey,
            productName: p.productName,
            value: p.issueReviewCount,
            sub: `· 총 이슈 ${p.totalIssueCount}개`,
          }))}
          onSelect={goProduct}
        />
      </SectionCard>
    </div>
  );
}
