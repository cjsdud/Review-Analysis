import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReplyTemplateBox from '../components/ReplyTemplateBox.jsx';
import IssueCard from '../components/IssueCard.jsx';
import SectionCard from '../components/SectionCard.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SentimentBar from '../components/SentimentBar.jsx';
import ProductStatusBadge from '../components/ProductStatusBadge.jsx';
import AllIssuesModal from '../components/AllIssuesModal.jsx';
import ReviewsModal from '../components/ReviewsModal.jsx';
import ReviewHighlightsSection from '../components/ReviewHighlightsSection.jsx';
import SectionNavigator from '../components/SectionNavigator.jsx';
import AccessError from '../components/AccessError.jsx';
import { getProductDetail } from '../api/analysisApi.js';
import { getReviewsForIssue } from '../utils/getReviewsForIssue.js';

export default function ProductDetailPage() {
  const { analysisId, productKey } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessKind, setAccessKind] = useState(null);
  const [error, setError] = useState('');

  // 모달 상태
  const [allIssuesOpen, setAllIssuesOpen] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [selectedIssueFilter, setSelectedIssueFilter] = useState(null);

  // 체크리스트는 action 문자열 자체로 저장 (인덱스 충돌 방지).
  const storageKey = `reviewfit:checklist:${analysisId}:${productKey}`;
  const [checkedActions, setCheckedActions] = useState(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set((Array.isArray(parsed) ? parsed : []).filter((x) => typeof x === 'string'));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    (async () => {
      try {
        const data = await getProductDetail(analysisId, productKey);
        setProduct(data);
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
  }, [analysisId, productKey]);

  function persistChecked(set) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...set]));
    } catch {
      /* private mode 등 무시 */
    }
  }

  function toggleCheck(actionText) {
    setCheckedActions((prev) => {
      const next = new Set(prev);
      if (next.has(actionText)) next.delete(actionText);
      else next.add(actionText);
      persistChecked(next);
      return next;
    });
  }

  function resetChecked() {
    const empty = new Set();
    setCheckedActions(empty);
    persistChecked(empty);
  }

  function handleViewRelatedReviews(issue) {
    setSelectedIssueFilter(issue);
    setAllIssuesOpen(false);
    setReviewsOpen(true);
  }

  function handleOpenAllReviews() {
    setSelectedIssueFilter(null);
    setReviewsOpen(true);
  }

  // 리뷰 모달용 필터된 리뷰 목록. (Rules of Hooks: early return 전에 호출)
  //   - selectedIssueFilter 가 있으면 getReviewsForIssue 로 사전 필터
  //     (대시보드/샘플과 동일 유틸)
  //   - 없으면 전체 리뷰
  // ReviewsModal 의 내부 initialIssueFilter 는 더 이상 의존하지 않음 — 같은
  // 매칭 기준을 여러 곳에서 다르게 구현하지 않도록 페이지 레벨에서 한 번에 결정.
  const modalReviews = useMemo(() => {
    const all = product?.reviews || [];
    if (!selectedIssueFilter) return all;
    return getReviewsForIssue(all, selectedIssueFilter);
  }, [product, selectedIssueFilter]);

  if (loading) return <LoadingState title="상품 리포트를 준비하고 있어요" />;
  if (accessKind) return <AccessError kind={accessKind} />;
  if (error)
    return (
      <div>
        <div className="error-banner">리포트를 불러오는 중 문제가 생겼어요: {error}</div>
        <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/dashboard/${analysisId}`)}>
          ← 대시보드로 돌아가기
        </button>
      </div>
    );
  if (!product) return null;

  const negPct = product.totalReviews ? Math.round((product.negativeReviews / product.totalReviews) * 100) : 0;
  const issuePct = Math.round((product.issueRatio ?? 0) * 100);
  const counts = product.sentimentCounts || {
    positive: product.positiveReviews || 0,
    neutral: product.neutralReviews || 0,
    negative: product.negativeReviews || 0,
  };
  const ratios = product.sentimentRatios || {};

  const lede =
    product.summary ||
    `리뷰 ${product.totalReviews}건 중 ${product.issueReviewCount ?? 0}건에서 개선 이슈가 발견됐습니다.`;

  return (
    <div>
      <span
        className="back-link"
        onClick={() => navigate(`/dashboard/${analysisId}`)}
        style={{ cursor: 'pointer' }}
      >
        ← 대시보드로 돌아가기
      </span>

      <SectionNavigator
        sections={[
          { id: 'sec-product-summary', label: '상품 요약' },
          product.reviewHighlights ? { id: 'sec-product-review-reaction', label: '리뷰 반응' } : null,
          { id: 'sec-product-core-issues', label: '핵심 문제' },
          { id: 'sec-product-detail-actions', label: '수정 체크리스트' },
          (product.replyTemplates || []).length > 0 ? { id: 'sec-product-replies', label: 'CS 답글 초안' } : null,
        ].filter(Boolean)}
        stickyMode="desktop"
        enableKeyboard
        offset={120}
      />

      {/* 상단 헤더 */}
      <div id="sec-product-summary" className="product-header report-section">
        <div className="product-header__title">
          {product.productName}
          {product.productStatus && (
            <span style={{ marginLeft: 10 }}>
              <ProductStatusBadge status={product.productStatus} />
            </span>
          )}
        </div>
        <div className="product-header__lede">{lede}</div>
        <div className="product-header__stats">
          <span className="tag tag--neutral">전체 리뷰 {product.totalReviews}건</span>
          <span className="tag tag--success">긍정 {counts.positive}건</span>
          <span className="tag tag--neutral">중립 {counts.neutral}건</span>
          <span className="tag tag--danger">부정 {counts.negative}건 · {negPct}%</span>
          <span className="tag">개선 이슈 리뷰 {product.issueReviewCount ?? 0}건</span>
          <span className="tag">총 이슈 {product.totalIssueCount ?? 0}건</span>
          <span className="tag">이슈 비율 {issuePct}%</span>
          {product.averageRating != null && <span className="tag">평균 ★ {product.averageRating.toFixed(2)}</span>}
        </div>
        <div style={{ marginTop: 12 }}>
          <SentimentBar counts={counts} ratios={ratios} />
        </div>
        {product.productInsight && (
          <div className="product-header__insight">{product.productInsight}</div>
        )}
      </div>

      {/* 섹션: 이 상품의 리뷰 반응 (긍정/중립/부정) */}
      {product.reviewHighlights && (
        <SectionCard
          id="sec-product-review-reaction"
          title="이 상품의 리뷰 반응"
          subtitle="해당 상품 리뷰에서 많이 보이는 긍정·중립·부정 의견을 정리했습니다. 각 카드의 ‘전체 보기’로 이 상품의 마스킹된 리뷰 데이터를 감성별로 확인할 수 있어요."
          className="mb-5"
        >
          <ReviewHighlightsSection
            highlights={product.reviewHighlights}
            analysisId={analysisId}
            initialProductName={product.productName}
          />
        </SectionCard>
      )}

      {/* 섹션 1: 이 상품의 핵심 문제 */}
      <SectionCard
        id="sec-product-core-issues"
        title="이 상품의 핵심 문제"
        subtitle="실제 불편/개선 신호가 있는 리뷰만 모아 정리했어요. 긍정 리뷰나 ‘문제 없음’ 표현은 핵심 문제에서 제외됩니다. 각 카드의 ‘분류 수정’으로 직접 다듬을 수도 있습니다."
        action={
          <div className="page-actions" style={{ gap: 8 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => setAllIssuesOpen(true)}>
              전체 이슈 보기
            </button>
            <button className="btn btn--ghost btn--sm" onClick={handleOpenAllReviews}>
              리뷰 데이터 보기
            </button>
          </div>
        }
        className="mb-5"
      >
        {product.topIssues.length === 0 ? (
          <div className="muted">두드러진 반복 불만이 발견되지 않았습니다. 👍 긍정 리뷰를 상세페이지에 노출해 보세요.</div>
        ) : (
          product.topIssues.map((iss, i) => (
            <IssueCard key={i} issue={iss} analysisId={analysisId} productKey={productKey} />
          ))
        )}
      </SectionCard>

      <div className="dash-grid">
        {/* 섹션 2: 상세페이지 수정 체크리스트 */}
        <SectionCard
          id="sec-product-detail-actions"
          title="상세페이지 수정 체크리스트"
          subtitle="고치기 좋은 순서로 정리했어요. 체크하며 진행하세요. (체크 상태는 이 브라우저에 저장됩니다)"
          action={
            checkedActions.size > 0 && (
              <button className="btn btn--ghost btn--sm" onClick={resetChecked}>
                체크 초기화
              </button>
            )
          }
        >
          {product.detailPageActions.length === 0 ? (
            <div className="muted">아직 제안할 수정안이 없어요.</div>
          ) : (
            <ul className="checklist">
              {product.detailPageActions.map((a) => (
                <li
                  key={a}
                  className={checkedActions.has(a) ? 'is-checked' : ''}
                  onClick={() => toggleCheck(a)}
                  role="button"
                  tabIndex={0}
                >
                  <span className="checklist__box">✓</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* 섹션 3: CS 답글 초안 */}
        <SectionCard
          id="sec-product-replies"
          title="CS 답글 초안"
          subtitle="복사해서 바로 사용할 수 있어요. 말투(기본/정중/친근)는 카드별로 고를 수 있습니다."
        >
          {product.replyTemplates.length === 0 ? (
            <div className="muted">답글 초안이 없어요.</div>
          ) : (
            product.replyTemplates.map((rt, i) => (
              <ReplyTemplateBox key={i} issueLabel={rt.issueLabel} variants={rt.variants} />
            ))
          )}
        </SectionCard>
      </div>

      {/* 섹션 4: 운영 메모 */}
      <div className="ops-note">
        <span className="ops-note__ico">ℹ️</span>
        <div>
          리뷰핏의 제안은 고객 리뷰에서 반복되는 표현을 기반으로 생성됩니다. 실제 상세페이지 수정 전에는 상품 특성과
          재고·배송 상황을 함께 확인하세요. CS 답글 초안은 셀러가 최종 확인하신 후 등록하시는 것을 권장합니다.
        </div>
      </div>

      <AllIssuesModal
        open={allIssuesOpen}
        onClose={() => setAllIssuesOpen(false)}
        allIssues={product.allIssues || product.topIssues || []}
        onViewRelatedReviews={handleViewRelatedReviews}
      />
      <ReviewsModal
        open={reviewsOpen}
        onClose={() => {
          setReviewsOpen(false);
          setSelectedIssueFilter(null);
        }}
        reviews={modalReviews}
        productName={product.productName}
      />
    </div>
  );
}
