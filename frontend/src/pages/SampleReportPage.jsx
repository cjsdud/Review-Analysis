import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BrandTitle from '../components/BrandTitle.jsx';
import SummaryCards from '../components/SummaryCards.jsx';
import TopFixTargets, { sortFixTargets } from '../components/TopFixTargets.jsx';
import ProductsTable from '../components/ProductsTable.jsx';
import ReviewHighlightsSection from '../components/ReviewHighlightsSection.jsx';
import SectionCard from '../components/SectionCard.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { SAMPLE_SUMMARY, SAMPLE_PRODUCTS } from '../data/sampleReportData.js';

// 공개 샘플 리포트 — 비로그인 사용자가 회원가입 없이 ReviewFit 결과 형태를
// 미리 볼 수 있는 페이지. 실제 분석 API 호출 없이 정적 데이터만 사용한다.
//
// 라우팅: /demo/sample-report (App.jsx 의 공개 라우트, ProtectedRoute 미적용)
//
// 권한:
//   - 비로그인 접근 가능
//   - 내부 데이터는 정적 import — API 호출 없음
//   - "내 리뷰 파일 분석하기" CTA 는 비로그인이면 /login?next=/upload,
//     로그인이면 /upload 로 이동
export default function SampleReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const ctaRef = useRef(null);

  // 비로그인 첫 진입 시 페이지 최상단으로
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // SEO — 페이지 전용 title/description/og 태그. unmount 시 원복.
  // SPA 라 일부 크롤러가 동적 meta 를 완전히 반영하지 못할 수 있음 (한계 문서화).
  useEffect(() => {
    const prevTitle = document.title;
    const TITLE = 'ReviewFit 샘플 리포트 미리보기';
    const DESC = '리뷰 파일을 업로드하면 상품별 반복 이슈, 긍정·중립·부정 리뷰 반응, 근거 리뷰, CS 답글 초안을 어떻게 확인할 수 있는지 샘플 리포트로 미리 확인해 보세요.';
    document.title = TITLE;
    const tags = [
      { selector: 'meta[name="description"]', attrs: { name: 'description', content: DESC } },
      { selector: 'meta[property="og:title"]', attrs: { property: 'og:title', content: TITLE } },
      { selector: 'meta[property="og:description"]', attrs: { property: 'og:description', content: DESC } },
      { selector: 'meta[property="og:type"]', attrs: { property: 'og:type', content: 'website' } },
    ];
    const restoreFns = tags.map(({ selector, attrs }) => {
      let el = document.head.querySelector(selector);
      const created = !el;
      const prevContent = el?.getAttribute('content') || null;
      if (!el) {
        el = document.createElement('meta');
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        document.head.appendChild(el);
      } else {
        el.setAttribute('content', attrs.content);
      }
      return () => {
        if (created) el.parentNode && el.parentNode.removeChild(el);
        else if (prevContent != null) el.setAttribute('content', prevContent);
      };
    });
    return () => {
      document.title = prevTitle;
      restoreFns.forEach((fn) => fn());
    };
  }, []);

  // 가입 CTA 위치로 부드럽게 스크롤 — 감성 카드 "전체 보기" 대체 동작.
  function goToCTA() {
    if (ctaRef.current) ctaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // primary CTA 동작: 비로그인 → 로그인(next=/upload), 로그인 → /upload
  function startAnalysis() {
    if (user) {
      navigate('/upload');
    } else {
      navigate('/login', { state: { from: '/upload' } });
    }
  }
  function goLogin() {
    navigate('/login');
  }
  function goSignup() {
    navigate('/signup?next=/upload');
  }

  return (
    <div className="demo-shell">
      {/* 공개 페이지 전용 상단 — Layout 없이 자체 헤더 */}
      <header className="demo-topbar">
        <div className="demo-topbar__brand">
          <BrandTitle size="md" clickable />
          <span className="tag tag--sample demo-topbar__badge">샘플 데이터</span>
        </div>
        <div className="demo-topbar__actions">
          {user ? (
            <Link to="/history" className="btn btn--ghost btn--sm">앱으로 이동</Link>
          ) : (
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={goLogin}>로그인</button>
              <button type="button" className="btn btn--primary btn--sm" onClick={goSignup}>회원가입</button>
            </>
          )}
        </div>
      </header>

      <main className="demo-main">
        <div className="demo-hero">
          <h1 className="demo-hero__title">샘플 리포트 미리보기</h1>
          <p className="demo-hero__lede">
            리뷰 파일을 업로드하면 이런 방식으로 상품별 문제와 리뷰 반응을 확인할 수 있어요.
          </p>
          <div className="demo-hero__notice">
            <b>샘플 데이터로 생성된 예시 리포트입니다.</b>{' '}
            실제 고객 데이터가 아닌 ReviewFit 기능 설명을 위한 예시이며, 상품명·리뷰 내용·이슈는 모두 가공된 예시 표현입니다.
          </div>
          <div className="demo-hero__cta">
            <button type="button" className="btn btn--primary" onClick={startAnalysis}>
              내 리뷰 파일 분석하기
            </button>
            {!user && (
              <button type="button" className="btn btn--ghost" onClick={goSignup}>
                회원가입하고 시작하기
              </button>
            )}
          </div>
        </div>

        {/* AI 코멘트 */}
        {SAMPLE_SUMMARY.aiComment && (
          <div className="ai-comment">
            <span className="ai-comment__ico">📌</span>
            <div className="ai-comment__text">{SAMPLE_SUMMARY.aiComment}</div>
          </div>
        )}

        {/* 요약 지표 */}
        <SummaryCards summary={SAMPLE_SUMMARY} />

        {/* 이번에 먼저 고칠 상품 TOP 3 */}
        <div className="page-head" style={{ marginBottom: 12, marginTop: 24 }}>
          <div>
            <div className="page-head__title" style={{ fontSize: 17 }}>이번에 먼저 고칠 상품 TOP 3</div>
            <div className="page-head__sub">부정 비율, 반복 이슈, 리뷰 수를 함께 보고 우선 점검할 상품을 추천합니다.</div>
          </div>
        </div>
        <TopFixTargets items={sortFixTargets(SAMPLE_PRODUCTS).slice(0, 3)} onSelect={goToCTA} />

        {/* 리뷰 내용 요약 — 모달 대신 가입 CTA 로 스크롤 */}
        <div className="page-head" style={{ marginBottom: 12, marginTop: 24 }}>
          <div>
            <div className="page-head__title" style={{ fontSize: 17 }}>리뷰 내용 요약</div>
            <div className="page-head__sub">
              고객 리뷰에서 자주 보이는 긍정 의견과 부정 의견을 함께 정리했습니다. 부정 리뷰와 개선 이슈는 별도 개념입니다.
            </div>
          </div>
        </div>
        <ReviewHighlightsSection highlights={SAMPLE_SUMMARY.reviewHighlights} onOpenSentiment={goToCTA} />

        {/* 상품별 문제 정리 */}
        <SectionCard
          title="상품별 문제 정리"
          subtitle="각 상품의 감성 분포, 핵심 지표, 주요 이슈를 한 화면에서 비교합니다."
          className="mt-5"
        >
          <ProductsTable products={SAMPLE_PRODUCTS} onSelect={goToCTA} />
        </SectionCard>

        {/* 회원가입 유도 CTA */}
        <section ref={ctaRef} className="demo-cta">
          <div className="demo-cta__title">우리 상품 리뷰도 이렇게 보고 싶다면?</div>
          <div className="demo-cta__desc">
            지금 회원가입하면 내 리뷰 파일을 그대로 올려 상품별 분석 리포트를 받아볼 수 있어요. 무료 베타로 부담 없이 시작해보세요.
          </div>
          <div className="demo-cta__buttons">
            <button type="button" className="btn btn--primary" onClick={startAnalysis}>
              {user ? '내 리뷰 파일 분석하기' : '무료 베타로 시작하기'}
            </button>
            {!user && (
              <button type="button" className="btn btn--ghost" onClick={goLogin}>이미 계정이 있어요</button>
            )}
          </div>
          <div className="demo-cta__foot muted">
            샘플 리포트는 예시 데이터로 구성되어 있어요. 실제 분석에는 직접 올린 리뷰 파일이 사용됩니다.
          </div>
        </section>
      </main>
    </div>
  );
}
