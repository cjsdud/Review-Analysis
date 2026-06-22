import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import BrandTitle from '../components/BrandTitle.jsx';
import SummaryCards from '../components/SummaryCards.jsx';
import CompactStatStrip from '../components/CompactStatStrip.jsx';
import SectionCard from '../components/SectionCard.jsx';
import SectionNavigator from '../components/SectionNavigator.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SentimentBar from '../components/SentimentBar.jsx';
import ProductStatusBadge from '../components/ProductStatusBadge.jsx';
import TopFixTargets, { sortFixTargets } from '../components/TopFixTargets.jsx';
import ReviewHighlightsSection from '../components/ReviewHighlightsSection.jsx';
import Disclosure from '../components/Disclosure.jsx';
import MobilePager from '../components/MobilePager.jsx';
import { getSharedReport } from '../api/shareApi.js';

// 외부 셀러용 읽기 전용 공유 분석 리포트.
// 라우팅: /share/:code (App.jsx 의 공개 라우트)
//
// UI 원칙:
//   1) 상단 sticky SectionNavigator 로 현재 위치를 항상 알 수 있게 한다.
//   2) 상품을 한 화면에 나열하지 않는다 — 셀렉터 chips + 선택된 1개 상품 상세.
//      (분석된 상품이 8개+ 인 경우 세로 나열은 정보 과부하)
//   3) 죽은 링크 없음 — "전체 보기" / 상품 카드 클릭 / 다음·이전 상품 모두 동작 연결.
//
// ※ 노출 금지 (절대 추가하지 말 것):
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
  // 우선 점검 순으로 정렬 — top3 + 상품 셀렉터 둘 다 같은 우선순위 사용.
  const sortedProducts = useMemo(() => sortFixTargets(products), [products]);
  const top3 = sortedProducts.slice(0, 3);

  // 선택된 상품 — 기본은 우선순위 가장 높은 1개.
  const [selectedKey, setSelectedKey] = useState(() => sortedProducts[0]?.productKey || null);
  const selectedIndex = sortedProducts.findIndex((p) => p.productKey === selectedKey);
  const selectedProduct = selectedIndex >= 0 ? sortedProducts[selectedIndex] : sortedProducts[0];

  // 외부 트리거 — TopFixTargets / 셀렉터 chip 등에서 상품 점프 시 사용.
  // ① 그 상품을 선택, ② '상품별 분석' 섹션으로 부드럽게 스크롤.
  function jumpToProduct(productKey) {
    setSelectedKey(productKey);
    requestAnimationFrame(() => {
      const el = document.getElementById('shared-sec-products');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // CTA 섹션 ref — '전체 보기' 등 죽은 링크 대신 베타 안내 CTA 로 부드럽게 스크롤.
  const ctaRef = useRef(null);
  function scrollToCta() {
    if (ctaRef.current) ctaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // SectionNavigator 섹션 목록 — 데이터에 따라 동적으로 구성.
  const navSections = [
    { id: 'shared-sec-summary', label: '한 줄 요약' },
    sortedProducts.length > 0 ? { id: 'shared-sec-top-fix', label: '먼저 고칠 상품' } : null,
    summary.reviewHighlights ? { id: 'shared-sec-highlights', label: '리뷰 반응' } : null,
    sortedProducts.length > 0 ? { id: 'shared-sec-products', label: '상품별 분석' } : null,
  ].filter(Boolean);

  return (
    <div className="demo-shell shared-shell">
      <SharedTopbar />
      <SectionNavigator
        sections={navSections}
        stickyMode="always"
        enableKeyboard
        offset={120}
      />
      <main className="demo-main">
        {/* Hero — 짧게, 분석 메타 (분석 시각 / 상품 수 / 리뷰 수) 노출해 어떤 분석인지 한눈에 */}
        <div className="demo-hero shared-hero">
          <span className="tag tag--neutral shared-hero__chip">공유 분석 리포트 · 읽기 전용</span>
          <h1 className="demo-hero__title">의류 리뷰 분석 결과</h1>
          <div className="shared-hero__meta muted">
            상품 <b>{summary.productCount ?? products.length}개</b>
            {' · '}리뷰 <b>{(summary.totalReviews ?? 0).toLocaleString('ko-KR')}건</b> 분석
            {data.analysis?.createdAt && (
              <> · 분석일 {formatDate(data.analysis.createdAt)}</>
            )}
          </div>
          <div className="demo-hero__notice">
            분석을 요청한 셀러에게 ReviewFit 이 만들어 드린 베타 샘플 리포트입니다.
            원본 파일·리뷰 데이터는 다운로드할 수 없으며, 모든 리뷰 인용은 개인정보가 가려진 데이터입니다.
          </div>
        </div>

        {/* ── § 한 줄 요약 ──────────────────────────── */}
        <section id="shared-sec-summary" className="report-section">
          {summary.aiComment && (
            <div className="ai-comment">
              <span className="ai-comment__ico">📌</span>
              <div className="ai-comment__text">{summary.aiComment}</div>
            </div>
          )}
          {/* desktop: 6장 그리드 카드 / mobile: 4개 핵심 chip 가로 스크롤. CSS 가 분기. */}
          <div className="desktop-only">
            <SummaryCards summary={summary} />
          </div>
          <CompactStatStrip summary={summary} />
        </section>

        {/* ── § 먼저 고칠 상품 — 카드 클릭하면 상품별 분석으로 점프 ──── */}
        {top3.length > 0 && (
          <section id="shared-sec-top-fix" className="report-section">
            <div className="page-head" style={{ marginBottom: 12, marginTop: 24 }}>
              <div>
                <div className="page-head__title" style={{ fontSize: 17 }}>이번에 먼저 고칠 상품 TOP 3</div>
                <div className="page-head__sub">
                  부정 비율, 반복 이슈, 리뷰 수를 함께 보고 우선 점검할 상품을 추천합니다.
                  카드를 클릭하면 해당 상품의 상세 분석으로 이동합니다.
                </div>
              </div>
            </div>
            <TopFixTargets items={top3} onSelect={jumpToProduct} />
          </section>
        )}

        {/* ── § 리뷰 반응 — '전체 보기' 는 CTA 섹션으로 안내 스크롤 ──── */}
        {summary.reviewHighlights && (
          <section id="shared-sec-highlights" className="report-section">
            <SectionCard
              title="이번 분석의 리뷰 반응"
              subtitle="고객 리뷰에서 자주 보이는 긍정·중립·부정 의견을 정리했습니다. 전체 리뷰 데이터 탐색은 정식 분석에서 제공됩니다."
              className="mt-5"
            >
              {/* onOpenSentiment 를 명시 — 공유 페이지에서는 분석 API 호출 권한이 없으므로
                  모달을 열지 않고 CTA 로 안내 스크롤. 죽은 빈 모달 노출 차단. */}
              <ReviewHighlightsSection
                highlights={summary.reviewHighlights}
                onOpenSentiment={scrollToCta}
              />
            </SectionCard>
          </section>
        )}

        {/* ── § 상품별 분석 — 셀렉터 chips + 선택된 1개 상품 상세 ──── */}
        {sortedProducts.length > 0 && (
          <section id="shared-sec-products" className="report-section">
            <SectionCard
              title="상품별 분석"
              subtitle="아래 상품 칩에서 보고 싶은 상품을 선택하세요. 한 상품씩 반복 이슈와 CS 답글 초안을 확인할 수 있어요."
              className="mt-5"
            >
              <ProductSelector
                products={sortedProducts}
                selectedKey={selectedProduct?.productKey}
                onSelect={(k) => setSelectedKey(k)}
              />
              {selectedProduct && (
                <SharedProductBlock product={selectedProduct} />
              )}
              <MobilePager
                index={Math.max(0, selectedIndex)}
                total={sortedProducts.length}
                prevLabel="이전 상품"
                nextLabel="다음 상품"
                onPrev={() => {
                  const prev = sortedProducts[Math.max(0, (selectedIndex || 0) - 1)];
                  if (prev) setSelectedKey(prev.productKey);
                }}
                onNext={() => {
                  const next = sortedProducts[Math.min(sortedProducts.length - 1, (selectedIndex || 0) + 1)];
                  if (next) setSelectedKey(next.productKey);
                }}
              />
            </SectionCard>
          </section>
        )}

        {/* ── § CTA ──────────────────────────────── */}
        <section ref={ctaRef} className="demo-cta" style={{ marginTop: 32 }}>
          <div className="demo-cta__title">더 많은 상품을 분석하고 싶다면?</div>
          <div className="demo-cta__desc">
            의류 리뷰 분석 무료 베타 모집 중이에요. 메시지로 <b>'리뷰핏 베타'</b>를 보내주세요.
          </div>
          <div className="demo-cta__buttons">
            <Link to="/demo/sample-report" className="btn btn--ghost">샘플 리포트 더 보기</Link>
          </div>
          <div className="demo-cta__foot muted">
            이 페이지는 공유용 읽기 전용 리포트입니다. 원본 파일·리뷰 데이터는 다운로드할 수 없습니다.
          </div>
        </section>
      </main>
    </div>
  );
}

// 상품 셀렉터 — 모바일에서 wrap 대신 가로 스크롤(h-scroll-snap)로 한 줄. 부정 비율 chip.
// 활성 상품은 스크롤 위치도 자동 보정해 항상 화면 가운데로.
function ProductSelector({ products, selectedKey, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const el = root.querySelector('.is-active');
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [selectedKey]);

  return (
    <div
      ref={ref}
      className="shared-selector h-scroll-snap"
      role="tablist"
      aria-label="분석된 상품 선택"
    >
      {products.map((p) => {
        const isActive = p.productKey === selectedKey;
        const negPct = Math.round((p.negativeRatio || 0) * 100);
        return (
          <button
            key={p.productKey}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`shared-selector__chip${isActive ? ' is-active' : ''}`}
            onClick={() => onSelect(p.productKey)}
            title={`${p.productName} — 리뷰 ${p.totalReviews ?? 0}건 · 부정 ${negPct}%`}
          >
            <span className="shared-selector__name">{p.productName}</span>
            <span className="shared-selector__count muted">{p.totalReviews ?? 0}건</span>
            {negPct >= 25 && (
              <span className="shared-selector__neg" aria-label={`부정 ${negPct}%`}>{negPct}%</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// 선택된 상품 1개 상세 — 헤더 + 감성바 + 반복 이슈 + 보완 힌트 + CS 답글 초안.
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
          {/* 반복 이슈는 가장 중요한 정보 — mobile 에서도 default 펼침 */}
          <Disclosure title="반복 이슈" meta={`${issues.length}건`} defaultOpen>
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
          </Disclosure>
        </div>
      )}

      {actions.length > 0 && (
        <div className="shared-product__section">
          {/* 보완 힌트는 부가 정보 — mobile default 접힘 (desktop 에선 강제 펼침) */}
          <Disclosure title="상세페이지 보완 힌트" meta={`${actions.length}개`}>
            <ul className="shared-action-list">
              {actions.map((a, i) => (<li key={i}>{a}</li>))}
            </ul>
          </Disclosure>
        </div>
      )}

      {replyTemplates.length > 0 && (
        <div className="shared-product__section">
          <Disclosure title="CS 답글 초안" meta={`${replyTemplates.length}개`}>
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
          </Disclosure>
        </div>
      )}
    </article>
  );
}

// ISO timestamp → "2026-06-17" 형식으로 짧게.
function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch { return ''; }
}
