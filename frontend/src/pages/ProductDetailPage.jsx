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

  if (loading) return <LoadingState title="상품 리포트를 불러오는 중..." />;
  if (error) return <div className="error-banner">{error}</div>;
  if (!product) return null;

  const negRatio = product.totalReviews ? Math.round((product.negativeReviews / product.totalReviews) * 100) : 0;

  return (
    <div>
      <span className="back-link" onClick={() => navigate(`/dashboard/${analysisId}`)} style={{ cursor: 'pointer' }}>
        ← 대시보드로 돌아가기
      </span>

      <div className="product-header">
        <div>
          <div className="product-header__title">{product.productName}</div>
          <div className="page-actions" style={{ marginTop: 8 }}>
            <span className="tag tag--neutral">전체 리뷰 {product.totalReviews}건</span>
            <span className="tag tag--danger">부정 리뷰 {product.negativeReviews}건 ({negRatio}%)</span>
            <span className="tag">개선 이슈 리뷰 {product.issueReviewCount ?? 0}건</span>
            <span className="tag">총 이슈 {product.totalIssueCount ?? 0}건</span>
            <span className="tag">이슈 비율 {Math.round((product.issueRatio ?? 0) * 100)}%</span>
            {product.averageRating != null && <span className="tag">평균 ★ {product.averageRating.toFixed(2)}</span>}
          </div>
        </div>
      </div>

      {product.summary && (
        <div className="ai-comment">
          <span className="ai-comment__ico">📌</span>
          <div className="ai-comment__text">{product.summary}</div>
        </div>
      )}

      {/* 주요 이슈 */}
      <SectionCard
        title={`주요 이슈 TOP ${Math.min(product.topIssues.length, 5)}`}
        subtitle="각 카드에서 분류를 직접 수정할 수 있습니다."
        className="mb-5"
      >
        {product.topIssues.length === 0 && <div className="muted">두드러진 반복 불만이 발견되지 않았습니다. 👍</div>}
        {product.topIssues.map((iss, i) => (
          <IssueCard key={i} issue={iss} analysisId={analysisId} productKey={productKey} />
        ))}
      </SectionCard>

      <div className="dash-grid">
        <SectionCard title="상세페이지 개선 체크리스트">
          {product.detailPageActions.length === 0 ? (
            <div className="muted">제안할 개선 액션이 없습니다.</div>
          ) : (
            <ul className="checklist">
              {product.detailPageActions.map((a, i) => (
                <li key={i}>
                  <span className="checklist__check">✓</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="CS 답글 초안">
          {product.replyTemplates.length === 0 ? (
            <div className="muted">답글 초안이 없습니다.</div>
          ) : (
            product.replyTemplates.map((rt, i) => (
              <ReplyTemplateBox key={i} issueLabel={rt.issueLabel} variants={rt.variants} />
            ))
          )}
        </SectionCard>
      </div>
    </div>
  );
}
