import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SummaryCards from '../components/SummaryCards.jsx';
// CategoryChart는 ECharts를 포함해 무거우므로 lazy import — 대시보드 접근 시에만 로드
const CategoryChart = lazy(() => import('../components/CategoryChart.jsx'));
import ProductsTable from '../components/ProductsTable.jsx';
import TopFixTargets, { sortFixTargets } from '../components/TopFixTargets.jsx';
import ReviewHighlightsSection from '../components/ReviewHighlightsSection.jsx';
import ReviewExplorerModal from '../components/ReviewExplorerModal.jsx';
import SentimentBar from '../components/SentimentBar.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import SectionNavigator from '../components/SectionNavigator.jsx';
import { buildProductDetailPath } from '../utils/reportRoutes.js';
import PlanGatedExport, { PrintWatermark } from '../components/PlanGatedExport.jsx';
import AccessError, { errorKind } from '../components/AccessError.jsx';
import { normalizeIssueCategory } from '../utils/issueFilters.js';
import { getAnalysis, getAnalysisStatus, getProducts, exportXlsxUrl } from '../api/analysisApi.js';

export default function DashboardPage() {
  const { analysisId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accessKind, setAccessKind] = useState(null);
  const [error, setError] = useState('');
  // 분석이 아직 진행 중/실패면 jobState 만 받아 안내 화면을 띄운다.
  const [jobState, setJobState] = useState(null);
  const [chartType, setChartType] = useState('bar');
  const [reviewsModalOpen, setReviewsModalOpen] = useState(false);
  const [reviewsModalCategory, setReviewsModalCategory] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const a = await getAnalysis(analysisId);
        // 비동기 job — 아직 진행 중이면 a.status='processing'/'failed' 이고 products 가 없다.
        if (a.status && a.status !== 'completed' && a.status !== 'done') {
          setJobState(a);
        } else {
          const ps = await getProducts(analysisId);
          setSummary(a.summary);
          setProducts(ps);
        }
      } catch (e) {
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

  // 진행 중일 때만 5초마다 status API 만 폴링. completed 가 되면 그제서야 report 데이터를
  // 다시 fetch — 화면 전체 reload 없이 스크롤/UI 상태 유지.
  useEffect(() => {
    if (!analysisId) return;
    if (!jobState) return;
    if (jobState.status === 'completed' || jobState.status === 'failed' || jobState.status === 'error') return;
    let cancelled = false;
    let inFlight = false;
    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const s = await getAnalysisStatus(analysisId);
        if (cancelled || !s) return;
        if (s.status === 'completed' || s.status === 'done') {
          // 완료 — report data 만 다시 fetch 하고 jobState 클리어
          const [a, ps] = await Promise.all([getAnalysis(analysisId), getProducts(analysisId)]);
          if (cancelled) return;
          setSummary(a.summary);
          setProducts(ps);
          setJobState(null);
        } else {
          // 진행 중 — progress / errorMessage 만 갱신 (전체 화면 유지)
          setJobState((prev) => ({ ...prev, status: s.status, progress: s.progress, errorMessage: s.errorMessage }));
        }
      } catch (e) {
        if (!cancelled) console.warn('[dashboard] poll error', e.message);
      } finally {
        inFlight = false;
      }
    }
    const timer = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [analysisId, jobState]);

  function goProduct(productKey) {
    const path = buildProductDetailPath({ analysisId, productKey });
    if (path) navigate(path);
  }

  // 차트(막대/원형) 클릭 → 해당 카테고리의 관련 리뷰 모달 직접 열기.
  // 백엔드 /api/analysis/:id/reviews?category=... 가 detectedIssues 기준 필터.
  function handleCategoryClick(categoryName) {
    const normalized = normalizeIssueCategory(categoryName);
    setReviewsModalCategory(normalized);
    setReviewsModalOpen(true);
  }

  if (loading) return <LoadingState title="리포트를 준비하고 있어요" />;
  if (accessKind) return <AccessError kind={accessKind} />;
  if (jobState && jobState.status !== 'completed' && jobState.status !== 'done') {
    const isFailed = jobState.status === 'failed' || jobState.status === 'error';
    return (
      <div className="state-box">
        <div className="state-box__icon">{isFailed ? '⚠️' : '⏳'}</div>
        <div className="state-box__title">
          {isFailed ? '리뷰 분석에 실패했습니다.' : '리뷰 분석 중입니다.'}
        </div>
        <div className="state-box__desc">
          {isFailed
            ? (jobState.errorMessage || '잠시 후 다시 시도해 주세요.')
            : '분석이 완료되면 자동으로 리포트가 표시됩니다.'}
        </div>
        <div className="page-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn--primary" onClick={() => navigate('/history')}>분석 히스토리로 이동</button>
        </div>
      </div>
    );
  }
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

  // 섹션 네비게이션 항목 — 페이지에 실제 렌더링되는 섹션만.
  const negativeRanking = summary.productRankingByNegative || [];
  const navSections = [
    { id: 'sec-summary', label: '전체 요약' },
    products?.length > 0 ? { id: 'sec-top-products', label: '먼저 고칠 상품 TOP 3' } : null,
    summary.reviewHighlights ? { id: 'sec-review-reaction', label: '전체 리뷰 반응' } : null,
    { id: 'sec-issue-breakdown', label: '반복 이슈' },
    negativeRanking.length > 0 ? { id: 'sec-negative-products', label: '부정 많은 상품' } : null,
    { id: 'sec-product-table', label: '상품별 정리' },
  ].filter(Boolean);


  return (
    <div>
      <PrintWatermark />
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
            <PlanGatedExport xlsxUrl={exportXlsxUrl(analysisId)} />
            <button className="btn btn--primary btn--sm" onClick={() => navigate('/upload')}>
              + 새 분석
            </button>
          </>
        }
      />

      {/* sticky 는 데스크톱만 — 모바일에서 topbar 와 누적되어 본문이 가려지지 않도록 */}
      <SectionNavigator sections={navSections} stickyMode="desktop" enableKeyboard offset={120} />

      {/* 전체 요약 */}
      <section id="sec-summary" className="report-section">
        {summary.aiComment && (
          <div className="ai-comment">
            <span className="ai-comment__ico">📌</span>
            <div className="ai-comment__text">{summary.aiComment}</div>
          </div>
        )}
        <SummaryCards summary={summary} />
      </section>

      {/* 이번에 먼저 고칠 상품 TOP 3 */}
      {products?.length > 0 && (
        <section id="sec-top-products" className="report-section">
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div>
              <div className="page-head__title" style={{ fontSize: 17 }}>
                이번에 먼저 고칠 상품 TOP 3
              </div>
              <div className="page-head__sub">
                부정 비율, 반복 이슈, 리뷰 수를 함께 보고 우선 점검할 상품을 추천합니다.
              </div>
            </div>
          </div>
          <TopFixTargets items={sortFixTargets(products).slice(0, 3)} onSelect={goProduct} />
        </section>
      )}

      {/* 전체 리뷰 반응 요약 — 감성 분포 + 리뷰 내용 요약 한 섹션 */}
      {summary.reviewHighlights && (
        <section id="sec-review-reaction" className="report-section">
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div>
              <div className="page-head__title" style={{ fontSize: 17 }}>
                전체 리뷰 반응 요약
              </div>
              <div className="page-head__sub">
                전체 리뷰의 긍정·중립·부정 비율과 대표 반응을 함께 확인할 수 있어요.
              </div>
            </div>
          </div>

          <div className="review-reaction-summary">
            <div className="review-reaction-summary__sentiment">
              <div className="review-reaction-summary__sentiment-title">감성 분포</div>
              <SentimentBar
                counts={summary.sentimentCounts}
                ratios={summary.sentimentRatios}
                showLegend
              />
              <div className="review-reaction-summary__sentiment-numbers">
                <span>긍정 {summary.sentimentCounts?.positive ?? 0}건</span>
                <span className="muted">·</span>
                <span>중립 {summary.sentimentCounts?.neutral ?? 0}건</span>
                <span className="muted">·</span>
                <span>부정 {summary.sentimentCounts?.negative ?? 0}건</span>
              </div>
              <div className="review-reaction-summary__sentiment-help">
                개선 이슈는 긍정 리뷰 안에서도 발견될 수 있어, 부정 리뷰 수와 다를 수 있습니다.
              </div>
            </div>

            <ReviewHighlightsSection highlights={summary.reviewHighlights} analysisId={analysisId} />
          </div>
        </section>
      )}

      {/* 반복 이슈 — 별도 섹션. (기존엔 dash-grid 우측에 "부정 리뷰가 많은 상품"
          이 같이 있었는데, 정보 성격이 다르므로 아래에 별도 SectionCard 로 분리) */}
      <SectionCard
        id="sec-issue-breakdown"
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
          <CategoryChart
            distribution={summary.categoryDistribution}
            type={chartType}
            onCategoryClick={handleCategoryClick}
          />
        </Suspense>
      </SectionCard>

      {/* 부정 리뷰가 많은 상품 — 별도 섹션.
          "먼저 고칠 상품 TOP 3" 는 부정 비율/이슈/리뷰 수를 합친 종합 우선순위.
          이 섹션은 "감성 기준 부정 반응이 두드러진 상품" — 고객 만족도가 낮은
          상품을 빠르게 확인하는 용도. 두 기준은 의도적으로 다르다. */}
      {negativeRanking.length > 0 && (
        <SectionCard
          id="sec-negative-products"
          title="부정 리뷰가 많은 상품"
          subtitle="전체 만족도가 낮게 나타난 상품입니다. 리뷰가 5건 이상인 상품 중 부정 리뷰가 많은 순으로 정렬됩니다."
        >
          <ul className="negative-product-list">
            {negativeRanking.map((p, i) => (
              <li key={p.productKey} className="negative-product-row">
                <div className="negative-product-row__main">
                  <span className="negative-product-row__rank">{i + 1}</span>
                  <div className="negative-product-row__text">
                    <div
                      className="negative-product-row__name"
                      role="button"
                      tabIndex={0}
                      onClick={() => goProduct(p.productKey)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') goProduct(p.productKey); }}
                      title={p.productName}
                    >
                      {p.productName}
                    </div>
                    <div className="negative-product-row__meta muted">
                      전체 {p.totalReviews}건
                      {p.topNegativeCategory && (
                        <>
                          {' · 주요 카테고리: '}
                          <span className="tag tag--neutral">{p.topNegativeCategory}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="negative-product-row__metrics">
                  <span className="negative-product-row__neg">
                    <strong>{p.negativeReviews}</strong>건
                    <span className="muted"> · {Math.round((p.negativeRatio || 0) * 100)}%</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => goProduct(p.productKey)}
                  >
                    상세 보기 →
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* 상품별 문제 (전체 테이블) */}
      <SectionCard
        id="sec-product-table"
        title="상품별 문제 정리"
        subtitle="상품명을 클릭하면 근거 리뷰와 상세페이지 수정안을 볼 수 있습니다."
      >
        <ProductsTable products={products} onSelect={goProduct} />
      </SectionCard>

      {/* 차트 클릭 시 열리는 카테고리 사전 필터 리뷰 모달 */}
      {/* key=category — 다른 카테고리 클릭마다 fresh state 로 remount (필터 잔재 차단) */}
      <ReviewExplorerModal
        key={reviewsModalCategory || 'closed'}
        open={reviewsModalOpen}
        onClose={() => { setReviewsModalOpen(false); setReviewsModalCategory(''); }}
        analysisId={analysisId}
        initialCategory={reviewsModalCategory}
      />

      {/* 인쇄 전용 — 모달/접힘 안의 데이터까지 전체 출력.
          화면에선 display:none, @media print 에서만 보임. */}
      <PrintOnlyReport summary={summary} products={products} />
    </div>
  );
}

// 인쇄 전용 전체 리포트 — 화면에선 숨겨지고 @media print 에서만 노출.
// AllIssuesModal / ReviewsModal / ReviewExplorerModal 안에만 보이던 데이터를
// 펼쳐서 단순 마크업으로 보여준다. CS 답글 초안, 상품별 모든 이슈, 마스킹
// 리뷰까지 포함해 "현재 화면 일부" 가 아닌 "리포트 전체" 가 인쇄되도록.
function PrintOnlyReport({ summary, products }) {
  if (!summary) return null;
  return (
    <section className="print-only print-report">
      <h2>리뷰핏 분석 리포트 (전체)</h2>
      <p style={{ fontSize: 12, color: '#555' }}>
        리뷰 {summary.totalReviews}건 · 상품 {summary.productCount}개 ·
        긍정 {summary.sentimentCounts?.positive ?? 0} · 중립 {summary.sentimentCounts?.neutral ?? 0} · 부정 {summary.sentimentCounts?.negative ?? 0}
      </p>

      {(products || []).map((p) => (
        <article key={p.productKey} style={{ marginBottom: 16, pageBreakInside: 'avoid' }}>
          <h3>{p.productName}</h3>
          <p style={{ fontSize: 12, color: '#555', margin: '4px 0 8px' }}>
            전체 {p.totalReviews}건 · 평균 ★ {p.averageRating?.toFixed?.(2) ?? '–'} ·
            부정 {p.negativeReviews} ({Math.round((p.negativeRatio || 0) * 100)}%) ·
            개선 이슈 리뷰 {p.issueReviewCount ?? 0}건
          </p>

          {(p.allIssues || p.topIssues || []).length > 0 && (
            <>
              <h4 style={{ fontSize: 13, margin: '8px 0 4px' }}>발견 이슈</h4>
              <ul style={{ fontSize: 12, margin: 0, paddingLeft: 18 }}>
                {(p.allIssues || p.topIssues).map((iss, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <b>[{iss.category}]</b> {iss.issueLabel} — {iss.count}건
                    {iss.recommendedAction ? ` · 조치: ${iss.recommendedAction}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}

          {(p.replyTemplates || []).length > 0 && (
            <>
              <h4 style={{ fontSize: 13, margin: '8px 0 4px' }}>CS 답글 초안</h4>
              {p.replyTemplates.map((rt, i) => (
                <div key={i} style={{ fontSize: 12, margin: '0 0 6px' }}>
                  <b>{rt.issueLabel}</b>
                  {(rt.variants || []).slice(0, 1).map((v, j) => (
                    <div key={j} style={{ color: '#333', marginTop: 2 }}>
                      {v.tone ? `[${v.tone}] ` : ''}{v.template || v.text}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </article>
      ))}

      <p style={{ fontSize: 11, color: '#777', marginTop: 16 }}>
        ※ 모든 리뷰 본문은 마스킹된 데이터입니다. 전체 리뷰 데이터는 엑셀 리포트 내보내기로 받을 수 있습니다.
      </p>
      <div className="print-report-footer">
        ReviewFit · 리뷰 분석 리포트 · 개인정보가 가려진 데이터 기준
      </div>
    </section>
  );
}
