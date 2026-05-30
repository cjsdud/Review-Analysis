import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SummaryCards from '../components/SummaryCards.jsx';
// CategoryChart는 ECharts를 포함해 무거우므로 lazy import — 대시보드 접근 시에만 로드
const CategoryChart = lazy(() => import('../components/CategoryChart.jsx'));
import ProductsTable from '../components/ProductsTable.jsx';
import TopFixTargets from '../components/TopFixTargets.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import AccessError, { errorKind } from '../components/AccessError.jsx';
import { getAnalysis, getProducts, exportCsvUrl } from '../api/analysisApi.js';

export default function DashboardPage() {
  const { analysisId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accessKind, setAccessKind] = useState(null); // 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | null
  const [error, setError] = useState('');
  const [chartType, setChartType] = useState('bar');

  useEffect(() => {
    (async () => {
      try {
        const [a, ps] = await Promise.all([getAnalysis(analysisId), getProducts(analysisId)]);
        setSummary(a.summary);
        setProducts(ps);
      } catch (e) {
        // 권한/존재 에러는 AccessError 로 분기
        const status = e.status;
        if (status === 401) setAccessKind('AUTH_REQUIRED');
        else if (status === 403) setAccessKind('FORBIDDEN');
        else if (status === 404) setAccessKind('NOT_FOUND');
        else setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [analysisId]);

  function goProduct(productKey) {
    navigate(`/products/${analysisId}/${encodeURIComponent(productKey)}`);
  }

  if (loading) return <LoadingState title="리포트를 준비하고 있어요" />;
  if (accessKind) return <AccessError kind={accessKind} />;
  if (error)
    return (
      <div>
        <div className="error-banner">분석 결과를 불러오는 중 문제가 생겼어요: {error}</div>
        <button className="btn btn--primary" onClick={() => navigate('/upload')}>
          처음으로 돌아가기
        </button>
      </div>
    );
  if (!summary || summary.totalReviews === 0)
    return (
      <EmptyState
        title="아직 분석할 리뷰가 없어요"
        desc="리뷰 파일을 업로드하면 분석 리포트가 여기에 표시됩니다."
        actionLabel="리뷰 업로드하기"
        actionTo="/upload"
      />
    );

  return (
    <div>
      {summary.isSample && (
        <div className="sample-banner">
          <span className="sample-banner__badge">샘플 데이터 분석 결과</span>
          <span className="sample-banner__text">
            실제 셀러 파일을 업로드하면 상품명과 리뷰 내용에 맞춰 결과가 달라집니다.
          </span>
        </div>
      )}
      <PageHeader
        title="리뷰 분석 리포트"
        subtitle="상품별 반복 불만과 개선 우선순위를 확인하세요."
        actions={
          <>
            <a className="btn btn--ghost btn--sm" href={exportCsvUrl(analysisId)}>
              ⬇️ CSV 내보내기
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

      {/* 요약 지표 */}
      <SummaryCards summary={summary} />

      {/* 이번에 먼저 고칠 상품 (TOP 3) */}
      {summary.productRankingByIssues?.length > 0 && (
        <>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div>
              <div className="page-head__title" style={{ fontSize: 17 }}>
                이번에 먼저 고칠 상품 TOP 3
              </div>
              <div className="page-head__sub">개선 이슈가 가장 많은 상품부터 손대면 효과가 빠릅니다.</div>
            </div>
          </div>
          <TopFixTargets ranking={summary.productRankingByIssues} products={products} onSelect={goProduct} />
        </>
      )}

      {/* 카테고리 차트 + 부정 리뷰 순위 */}
      <div className="dash-grid">
        <SectionCard
          title="어떤 문제가 가장 많이 반복되었나요?"
          subtitle={
            summary.otherCount > 0
              ? `포괄 분류 '기타' ${summary.otherCount}건은 보조 항목으로 차트에서 제외했습니다.`
              : '리뷰에서 발견된 불만을 카테고리별로 모았습니다.'
          }
          action={
            <div className="segmented">
              <button
                className={`segmented__btn${chartType === 'bar' ? ' is-active' : ''}`}
                onClick={() => setChartType('bar')}
              >
                막대
              </button>
              <button
                className={`segmented__btn${chartType === 'pie' ? ' is-active' : ''}`}
                onClick={() => setChartType('pie')}
              >
                원형
              </button>
            </div>
          }
        >
          <Suspense fallback={<div className="muted" style={{ padding: 40, textAlign: 'center' }}>차트 로딩 중…</div>}>
            <CategoryChart distribution={summary.categoryDistribution} type={chartType} />
          </Suspense>
        </SectionCard>

        <SectionCard title="부정 리뷰가 많은 상품" subtitle="별점·감성 기준으로 부정 리뷰가 많은 상품입니다.">
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th>상품명</th>
                  <th style={{ width: 130 }}>부정 리뷰</th>
                </tr>
              </thead>
              <tbody>
                {(summary.productRankingByNegative || []).map((p, i) => (
                  <tr key={p.productKey} onClick={() => goProduct(p.productKey)}>
                    <td>
                      <span className="rank">{i + 1}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {p.productName}
                      <span className="muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                        / 전체 {p.totalReviews}건
                      </span>
                    </td>
                    <td>
                      <strong>{p.negativeReviews}</strong>건
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* 상품별 문제 (전체 테이블) */}
      <SectionCard
        title="상품별 문제 정리"
        subtitle="상품명을 클릭하면 근거 리뷰와 상세페이지 수정안을 볼 수 있습니다."
      >
        <ProductsTable products={products} onSelect={goProduct} />
      </SectionCard>
    </div>
  );
}
