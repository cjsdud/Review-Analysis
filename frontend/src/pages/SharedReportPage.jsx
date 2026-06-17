import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BrandTitle from '../components/BrandTitle.jsx';
import SummaryCards from '../components/SummaryCards.jsx';
import SectionCard from '../components/SectionCard.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SentimentBar from '../components/SentimentBar.jsx';
import ProductStatusBadge from '../components/ProductStatusBadge.jsx';
import TopFixTargets, { sortFixTargets } from '../components/TopFixTargets.jsx';
import ReviewHighlightsSection from '../components/ReviewHighlightsSection.jsx';
import { getSharedReport } from '../api/shareApi.js';

// 외부 셀러용 읽기 전용 공유 분석 리포트.
// 라우팅: /share/:code (App.jsx 의 공개 라우트)
// 권한: 비로그인 접근 가능. /api/shared-reports/:code 가 PII 마스킹된 데이터만 반환.
//
// ※ 노출 금지 — 절대 추가하지 말 것:
//   - 원본 파일 다운로드 / 엑셀 / CSV / 인쇄 리포트
//   - 삭제 / 재분석 / 새 파일 업로드
//   - 관리자 페이지 이동 / 다른 분석 목록 / 계정/결제 정보
//   - 사용자 분류 수정(saveCorrection) UI
//   - 내부 로그 / analysis_id / user_id 같은 식별자 표시
export default function SharedReportPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getSharedReport(code);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) {
          // 만료/회수/미존재 모두 동일한 generic 메시지로 통일.
          setError('공유 코드를 확인할 수 없습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  // 페이지 진입 시 항상 상단부터.
  useEffect(() => { window.scrollTo(0, 0); }, [code]);

  if (loading) {
    return (
      <div className="demo-shell">
        <SharedTopbar />
        <main className="demo-main">
          <LoadingState title="공유 리포트를 불러오는 중입니다." />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="demo-shell">
        <SharedTopbar />
        <main className="demo-main">
          <div className="state-box" style={{ marginTop: 48 }}>
            <div className="state-box__icon">🔎</div>
            <div className="state-box__title">공유 코드를 확인할 수 없습니다.</div>
            <div className="state-box__desc muted">
              만료되었거나, 회수되었거나, 잘못된 코드일 수 있어요. 분석을 요청한 셀러에게 다시 문의해 주세요.
            </div>
            <div className="page-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn btn--primary" onClick={() => navigate('/share')}>
                다른 공유 코드 입력
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return <SharedReportView data={data} />;
}

function SharedTopbar() {
  return (
    <header className="demo-topbar">
      <div className="demo-topbar__brand">
        <BrandTitle size="md" clickable={false} />
        <span className="tag tag--neutral demo-topbar__badge">공유 분석</span>
      </div>
    </header>
  );
}

function SharedReportView({ data }) {
  const summary = data.summary || {};
  const products = data.products || [];
  // 우선 점검 TOP — 분석 시점 ranking 우선, 없으면 즉석 계산.
  const top3 = useMemo(() => sortFixTargets(products).slice(0, 3), [products]);

  return (
    <div className="demo-shell">
      <SharedTopbar />
      <main className="demo-main">
        <div className="demo-hero">
          <h1 className="demo-hero__title">샘플 분석 리포트</h1>
          <p className="demo-hero__lede">의류 리뷰 분석 결과</p>
          <div className="demo-hero__notice">
            <b>공유용 읽기 전용 리포트입니다.</b>{' '}
            분석을 요청한 셀러에게 ReviewFit 이 만들어 드린 베타 샘플 리포트로, 원본 파일/리뷰 데이터는 다운로드할 수 없어요.
            모든 리뷰 인용은 개인정보가 가려진 데이터입니다.
          </div>
        </div>

        {summary.aiComment && (
          <div className="ai-comment">
            <span className="ai-comment__ico">📌</span>
            <div className="ai-comment__text">{summary.aiComment}</div>
          </div>
        )}

        <SummaryCards summary={summary} />

        {top3.length > 0 && (
          <>
            <div className="page-head" style={{ marginBottom: 12, marginTop: 24 }}>
              <div>
                <div className="page-head__title" style={{ fontSize: 17 }}>이번에 먼저 고칠 상품 TOP 3</div>
                <div className="page-head__sub">부정 비율, 반복 이슈, 리뷰 수를 함께 보고 우선 점검할 상품을 추천합니다.</div>
              </div>
            </div>
            {/* onSelect 미지정 — 클릭해도 동작 없음 (읽기 전용) */}
            <TopFixTargets items={top3} />
          </>
        )}

        {summary.reviewHighlights && (
          <SectionCard
            title="이번 분석의 리뷰 반응"
            subtitle="고객 리뷰에서 자주 보이는 긍정·중립·부정 의견을 정리했습니다."
            className="mt-5"
          >
            {/* onOpenSentiment 미지정 — '전체 보기' 클릭 시 동작 없음 */}
            <ReviewHighlightsSection highlights={summary.reviewHighlights} />
          </SectionCard>
        )}

        <SectionCard
          title="상품별 반복 이슈"
          subtitle="상품마다 어떤 의견이 반복되는지, 개선 힌트와 CS 답글 초안까지 한 화면에서 확인할 수 있어요."
          className="mt-5"
        >
          {products.length === 0 ? (
            <div className="muted" style={{ padding: 16 }}>분석된 상품이 없습니다.</div>
          ) : (
            <div className="shared-product-list">
              {products.map((p) => (
                <SharedProductBlock key={p.productKey} product={p} />
              ))}
            </div>
          )}
        </SectionCard>

        <section className="demo-cta" style={{ marginTop: 32 }}>
          <div className="demo-cta__title">더 많은 상품을 분석하고 싶다면?</div>
          <div className="demo-cta__desc">
            의류 리뷰 분석 무료 베타 모집 중이에요. 메시지로 <b>'리뷰핏 베타'</b>를 보내주세요.
          </div>
          <div className="demo-cta__buttons">
            <Link to="/demo/sample-report" className="btn btn--ghost">샘플 리포트 더 보기</Link>
          </div>
          <div className="demo-cta__foot muted">
            이 페이지는 공유용 읽기 전용 리포트입니다. 원본 파일/리뷰 데이터는 다운로드할 수 없습니다.
          </div>
        </section>
      </main>
    </div>
  );
}

// 상품 1개 블록 — 요약 + 이슈 카드 + 마스킹 리뷰 인용 + CS 답글 초안(있을 때).
function SharedProductBlock({ product: p }) {
  const counts = p.sentimentCounts || {
    positive: p.positiveReviews || 0,
    neutral: p.neutralReviews || 0,
    negative: p.negativeReviews || 0,
  };
  const ratios = p.sentimentRatios || {};
  const issues = (p.topIssues || []).slice(0, 5);
  const actions = (p.detailPageActions || []).slice(0, 6);
  // 분석 시점에 미리 만들어진 polite 답글만 보여준다 — 다른 톤은 로그인 사용자만 lazy fetch.
  const replyTemplates = (p.replyTemplates || []).slice(0, 5);

  return (
    <article className="shared-product">
      <header className="shared-product__head">
        <div>
          <div className="shared-product__title">
            {p.productName}
            {p.productStatus && (
              <span style={{ marginLeft: 8 }}>
                <ProductStatusBadge status={p.productStatus} />
              </span>
            )}
          </div>
          <div className="shared-product__meta muted">
            리뷰 {p.totalReviews ?? 0}건
            {' · '}부정 {Math.round((p.negativeRatio || 0) * 100)}%
            {p.averageRating != null && <> · 평균 ★ {p.averageRating.toFixed(2)}</>}
          </div>
        </div>
      </header>

      <SentimentBar counts={counts} ratios={ratios} compact showLegend />

      {issues.length > 0 && (
        <div className="shared-product__section">
          <div className="shared-product__sec-label">반복 이슈</div>
          <ul className="shared-issue-list">
            {issues.map((iss, i) => (
              <li key={i} className="shared-issue">
                <div className="shared-issue__head">
                  <span className="tag tag--neutral">[{iss.category}]</span>
                  <span className="shared-issue__label">{iss.issueLabel}</span>
                  <span className="muted shared-issue__count">{iss.count}건</span>
                </div>
                {iss.recommendedAction && (
                  <div className="shared-issue__action">💡 {iss.recommendedAction}</div>
                )}
                {(iss.evidence || []).slice(0, 2).map((ev, ei) => (
                  <blockquote key={ei} className="shared-issue__evi">"{ev}"</blockquote>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions.length > 0 && (
        <div className="shared-product__section">
          <div className="shared-product__sec-label">상세페이지 보완 힌트</div>
          <ul className="shared-action-list">
            {actions.map((a, i) => (<li key={i}>{a}</li>))}
          </ul>
        </div>
      )}

      {replyTemplates.length > 0 && (
        <div className="shared-product__section">
          <div className="shared-product__sec-label">CS 답글 초안</div>
          <ul className="shared-reply-list">
            {replyTemplates.map((rt, i) => {
              const v = (rt.variants || [])[0];
              if (!v?.template) return null;
              return (
                <li key={i} className="shared-reply">
                  <div className="shared-reply__head muted">"{rt.issueLabel}" · 정중한 말투</div>
                  <div className="shared-reply__body">{v.template}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}
