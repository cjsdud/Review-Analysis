import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SummaryCards from '../components/SummaryCards.jsx';
import CategoryChart from '../components/CategoryChart.jsx';
import ProductIssueTable from '../components/ProductIssueTable.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
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

  return (
    <div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}
      >
        <div>
          <h2 style={{ fontSize: 20 }}>분석 대시보드</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            분석 방식: {summary.aiMode === 'mock' ? '규칙 기반 + Mock AI' : `규칙 기반 + ${summary.aiMode}`}
          </span>
        </div>
        <div className="page-actions">
          <a className="btn btn--ghost btn--sm" href={exportCsvUrl(analysisId)}>
            ⬇️ CSV 다운로드
          </a>
          <button className="btn btn--ghost btn--sm" onClick={() => window.print()}>
            🖨️ 인쇄 / PDF
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => navigate('/upload')}>
            새 분석
          </button>
        </div>
      </div>

      {summary.aiComment && (
        <div className="ai-comment">
          <span className="ai-comment__ico">📌</span>
          <div className="ai-comment__text">{summary.aiComment}</div>
        </div>
      )}

      <SummaryCards summary={summary} />

      <div className="dash-grid">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              카테고리별 불만 분포
            </div>
            <div className="reply-box__tones" style={{ marginBottom: 0 }}>
              <button className={`reply-box__tone${chartType === 'bar' ? ' active' : ''}`} onClick={() => setChartType('bar')}>
                막대
              </button>
              <button className={`reply-box__tone${chartType === 'pie' ? ' active' : ''}`} onClick={() => setChartType('pie')}>
                원형
              </button>
            </div>
          </div>
          <CategoryChart distribution={summary.categoryDistribution} type={chartType} />
        </div>

        <div className="card">
          <div className="section-title">부정 리뷰가 많은 상품 TOP 10</div>
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
        </div>
      </div>

      <div className="card">
        <div className="section-title">반복 이슈가 많은 상품 TOP 10</div>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12, fontSize: 12 }}>
          상품명을 클릭하면 주요 이슈, 근거 리뷰, 상세페이지 수정안, CS 답글 초안을 볼 수 있습니다.
        </p>
        <ProductIssueTable
          valueLabel="반복 이슈 건수"
          rows={(summary.productRankingByIssues || []).map((p) => ({
            productKey: p.productKey,
            productName: p.productName,
            value: p.issueTotal,
          }))}
          onSelect={goProduct}
        />
      </div>
    </div>
  );
}
