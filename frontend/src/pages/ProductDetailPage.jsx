import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReplyTemplateBox from '../components/ReplyTemplateBox.jsx';
import IssueCard from '../components/IssueCard.jsx';
import SectionCard from '../components/SectionCard.jsx';
import LoadingState from '../components/LoadingState.jsx';
import { getProductDetail } from '../api/analysisApi.js';

export default function ProductDetailPage() {
  const { analysisId, productKey } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 체크리스트 상태는 (analysisId, productKey) 단위로 localStorage 에 저장한다.
  // 백엔드 영속화는 추후 TODO.
  const storageKey = `reviewfit:checklist:${analysisId}:${productKey}`;
  const [checkedIdx, setCheckedIdx] = useState(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
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
        setError(e.message);
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

  function toggleCheck(i) {
    setCheckedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      persistChecked(next);
      return next;
    });
  }

  function resetChecked() {
    const empty = new Set();
    setCheckedIdx(empty);
    persistChecked(empty);
  }

  if (loading) return <LoadingState title="상품 리포트를 준비하고 있어요" />;
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

  // 한 줄 요약: 상품별 운영 코멘트의 첫 문장 또는 자동 생성
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

      {/* 상단 헤더 */}
      <div className="product-header">
        <div className="product-header__title">{product.productName}</div>
        <div className="product-header__lede">{lede}</div>
        <div className="product-header__stats">
          <span className="tag tag--neutral">전체 리뷰 {product.totalReviews}건</span>
          <span className="tag tag--danger">부정 리뷰 {product.negativeReviews}건 · {negPct}%</span>
          <span className="tag">개선 이슈 리뷰 {product.issueReviewCount ?? 0}건</span>
          <span className="tag">총 이슈 {product.totalIssueCount ?? 0}건</span>
          <span className="tag">이슈 비율 {issuePct}%</span>
          {product.averageRating != null && <span className="tag">평균 ★ {product.averageRating.toFixed(2)}</span>}
        </div>
      </div>

      {/* 섹션 1: 이 상품의 핵심 문제 */}
      <SectionCard
        title="이 상품의 핵심 문제"
        subtitle="가장 많이 반복된 불만부터 정리했어요. 각 카드의 ‘분류 수정’으로 직접 다듬을 수도 있습니다."
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
          title="상세페이지 수정 체크리스트"
          subtitle="고치기 좋은 순서로 정리했어요. 체크하며 진행하세요. (체크 상태는 이 브라우저에 저장됩니다)"
          action={
            checkedIdx.size > 0 && (
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
              {product.detailPageActions.map((a, i) => (
                <li
                  key={i}
                  className={checkedIdx.has(i) ? 'is-checked' : ''}
                  onClick={() => toggleCheck(i)}
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
        <SectionCard title="CS 답글 초안" subtitle="복사해서 바로 사용할 수 있어요. 말투(기본/정중/친근)는 카드별로 고를 수 있습니다.">
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
          재고·배송 상황을 함께 확인하세요.
        </div>
      </div>
    </div>
  );
}
