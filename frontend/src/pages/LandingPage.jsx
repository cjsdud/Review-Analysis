import { useNavigate } from 'react-router-dom';
import BrandTitle from '../components/BrandTitle.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

const PROBLEMS = [
  { icon: '🕒', title: '리뷰를 하나씩 읽기엔 시간이 너무 오래 걸려요', desc: '리뷰가 수백 건 쌓이는데, 어디서부터 봐야 할지 막막합니다.' },
  { icon: '🧩', title: '부정 리뷰가 있어도 상품별 원인 정리가 어려워요', desc: '같은 불만이 반복돼도 한눈에 정리되지 않아 행동으로 옮기기 어렵습니다.' },
  { icon: '🛠️', title: '상세페이지를 어떻게 고쳐야 할지 막막해요', desc: '어떤 컷을 넣고 어떤 문구를 보강해야 할지 판단이 어렵습니다.' },
];

const STEPS = [
  { num: 1, title: '리뷰 엑셀 업로드', desc: '스마트스토어·카페24·쿠팡·자사몰 어디서든 받은 CSV/XLSX 그대로 올리세요.' },
  { num: 2, title: '컬럼 자동 매핑', desc: '상품명·리뷰내용·별점·작성일을 자동 인식. 틀리면 한 번에 수정합니다.' },
  { num: 3, title: '상품별 반복 이슈 분석', desc: '사이즈·색상·소재·마감 등 패션 카테고리로 반복 불만을 자동 분류합니다.' },
  { num: 4, title: '수정안·답글 초안 생성', desc: '상세페이지 수정 체크리스트와 CS 답글 초안을 바로 사용할 수 있게 정리합니다.' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // 로그인 사용자는 분석 히스토리(앱 홈), 비로그인은 로그인 화면으로.
  const startTarget = user ? '/history' : '/login';
  const uploadTarget = user ? '/upload' : '/login';

  return (
    <div className="landing">
      <nav className="landing__nav">
        <div className="landing__brand">
          <BrandTitle size="md" clickable />
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => navigate(startTarget)}>
          시작하기
        </button>
      </nav>

      {/* 1) Hero */}
      <header className="hero">
        <span className="hero__badge">패션 셀러 전용 · 리뷰 기반 상품 개선 리포트</span>
        <h1 className="hero__title">
          리뷰 엑셀만 올리면 상품별 불만 원인과
          <br />
          상세페이지 수정안이 나옵니다
        </h1>
        <p className="hero__subtitle">
          리뷰핏은 패션 셀러를 위한 리뷰 기반 상품 개선 리포트 도구입니다. 사이즈, 색상, 소재, 마감 불만을 자동으로
          분류하고 CS 답글 초안까지 정리합니다.
        </p>
        <div className="hero__cta">
          <button className="btn btn--primary" onClick={() => navigate(user ? '/upload?sample=1' : '/login', { state: user ? undefined : { from: '/upload?sample=1' } })}>
            샘플 데이터로 체험하기
          </button>
          <button className="btn btn--ghost" onClick={() => navigate(uploadTarget, uploadTarget === '/login' ? { state: { from: '/upload' } } : undefined)}>
            리뷰 파일 업로드하기
          </button>
        </div>
        <div className="hero__note">설치·로그인 없이 CSV/XLSX만 올리면 됩니다. 개인정보는 업로드 즉시 자동 마스킹.</div>
      </header>

      {/* 2) 문제 제기 */}
      <section className="l-section">
        <h2 className="l-section__title">리뷰는 쌓이는데, 어디를 고쳐야 할지 모르겠다면</h2>
        <div className="l-section__cards">
          {PROBLEMS.map((p) => (
            <div className="problem-card" key={p.title}>
              <div className="problem-card__icon">{p.icon}</div>
              <div className="problem-card__title">{p.title}</div>
              <div className="problem-card__desc">{p.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 3) 해결 방식 */}
      <section className="l-section">
        <h2 className="l-section__title">리뷰핏은 리뷰를 ‘할 일 목록’으로 바꿉니다</h2>
        <div className="solution-grid">
          {STEPS.map((s) => (
            <div className="solution-step" key={s.num}>
              <span className="solution-step__num">{s.num}</span>
              <div className="solution-step__title">{s.title}</div>
              <div className="solution-step__desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 4) 결과 예시 */}
      <section className="l-section">
        <h2 className="l-section__title">실제로는 이렇게 정리됩니다</h2>
        <div className="example-card">
          <div className="example-card__head">
            <div className="example-card__title">린넨 와이드 팬츠</div>
            <span className="example-card__tag">상품 상세 리포트</span>
          </div>
          <div className="example-card__grid">
            <div className="example-card__panel">
              <h4>주요 이슈</h4>
              <ul>
                <li>허리 사이즈가 작음</li>
                <li>실물 색상이 화면보다 어두움</li>
                <li>원단이 얇고 비침이 있음</li>
              </ul>
            </div>
            <div className="example-card__panel example-card__panel--fix">
              <h4>상세페이지 수정안</h4>
              <ul>
                <li>사이즈표 상단에 “허리 부분은 슬림하게 나온 제품” 문구 추가</li>
                <li>자연광·실내 조명별 색상 비교컷 추가</li>
                <li>원단 두께와 비침 여부를 상세페이지 상단에 안내</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 5) 마무리 CTA */}
      <section className="cta-section">
        <div className="cta-section__title">샘플 데이터로 먼저 확인해보세요</div>
        <div className="cta-section__buttons">
          <button className="btn btn--primary" onClick={() => navigate(user ? '/upload?sample=1' : '/login', { state: user ? undefined : { from: '/upload?sample=1' } })}>
            샘플 데이터로 체험하기
          </button>
          <button className="btn btn--ghost" onClick={() => navigate(uploadTarget, uploadTarget === '/login' ? { state: { from: '/upload' } } : undefined)}>
            리뷰 파일 업로드하기
          </button>
        </div>
      </section>
    </div>
  );
}
