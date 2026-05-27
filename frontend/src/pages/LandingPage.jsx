import { useNavigate } from 'react-router-dom';

const FEATURES = [
  {
    icon: '🔎',
    title: '상품별 반복 불만 자동 분류',
    desc: '사이즈, 색상, 소재, 마감 등 패션 특화 카테고리로 리뷰를 자동 분류합니다.',
  },
  {
    icon: '📝',
    title: '상세페이지 수정안 제공',
    desc: '어떤 문구를 추가하고 어떤 컷을 넣어야 하는지 구체적인 액션을 제안합니다.',
  },
  {
    icon: '💬',
    title: 'CS 답글 초안 자동 생성',
    desc: '이슈별로 기본/정중/친근 말투의 답글 초안을 만들어 복사만 하면 됩니다.',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  return (
    <div className="landing">
      <nav className="landing__nav">
        <div className="landing__brand">리뷰 인사이트</div>
        <button className="btn btn--ghost btn--sm" onClick={() => navigate('/upload')}>
          시작하기
        </button>
      </nav>

      <header className="landing__hero">
        <span className="landing__badge">패션 셀러 전용 · 리뷰 기반 상품 개선 리포트</span>
        <h1 className="landing__title">
          리뷰 엑셀만 올리면 상품별 불만 원인과
          <br />
          상세페이지 수정안을 자동으로 정리합니다.
        </h1>
        <p className="landing__subtitle">
          패션 셀러를 위한 리뷰 기반 상품 개선 리포트. 사이즈, 색상, 소재, 마감 불만을 자동 분류하고 CS 답글
          초안까지 제공합니다.
        </p>
        <div className="landing__cta">
          <button className="btn btn--primary" onClick={() => navigate('/upload?sample=1')}>
            샘플 데이터로 체험하기
          </button>
          <button className="btn btn--ghost" onClick={() => navigate('/upload')}>
            리뷰 파일 업로드하기
          </button>
        </div>
      </header>

      <section className="landing__features">
        {FEATURES.map((f) => (
          <div className="card landing__feature" key={f.title}>
            <div className="landing__feature-ico">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
