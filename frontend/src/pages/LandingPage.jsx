import { useNavigate } from 'react-router-dom';

const FEATURES = [
  {
    icon: '🔎',
    step: 1,
    title: '상품별 반복 불만 자동 분류',
    desc: '사이즈, 색상, 소재, 마감 등 패션 특화 카테고리로 리뷰를 자동 분류합니다.',
  },
  {
    icon: '📝',
    step: 2,
    title: '상세페이지 수정안 제공',
    desc: '어떤 문구를 추가하고 어떤 컷을 넣어야 하는지 구체적인 액션을 제안합니다.',
  },
  {
    icon: '💬',
    step: 3,
    title: 'CS 답글 초안 자동 생성',
    desc: '이슈별로 기본/정중/친근 말투의 답글 초안을 만들어 복사만 하면 됩니다.',
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  return (
    <div className="landing">
      <nav className="landing__nav">
        <div className="landing__brand">
          <span className="landing__logo">R</span>
          리뷰 인사이트
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => navigate('/upload')}>
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
          사이즈, 색상, 소재, 마감 불만을 자동 분류하고 근거 리뷰·상세페이지 수정안·CS 답글 초안까지 한 번에
          제공합니다.
        </p>
        <div className="landing__cta">
          <button className="btn btn--primary" onClick={() => navigate('/upload?sample=1')}>
            샘플 데이터로 체험하기
          </button>
          <button className="btn btn--ghost" onClick={() => navigate('/upload')}>
            리뷰 파일 업로드하기
          </button>
        </div>
        <div className="landing__note">설치·로그인 없이 CSV/XLSX만 올리면 됩니다. 개인정보는 업로드 즉시 자동 마스킹됩니다.</div>
      </header>

      {/* 미니 대시보드 미리보기 */}
      <section className="landing__preview">
        <div className="landing__preview-card">
          <div className="landing__preview-bar">
            <span />
            <span />
            <span />
          </div>
          <div className="landing__preview-stats">
            <div className="landing__pstat">
              <b>60</b>
              <small>전체 리뷰</small>
            </div>
            <div className="landing__pstat">
              <b>27</b>
              <small>부정 리뷰</small>
            </div>
            <div className="landing__pstat">
              <b>45</b>
              <small>개선 이슈 리뷰</small>
            </div>
            <div className="landing__pstat">
              <b>2.93</b>
              <small>평균 별점</small>
            </div>
          </div>
          <div className="landing__pbars">
            {[
              ['사이즈', 92],
              ['소재/두께', 78],
              ['색상/화면', 64],
              ['세탁/내구성', 42],
              ['배송/포장', 28],
            ].map(([label, w]) => (
              <div className="landing__pbar" key={label}>
                <i>{label}</i>
                <em style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing__how">
        <div className="landing__how-title">이렇게 작동해요</div>
        <div className="landing__features">
          {FEATURES.map((f) => (
            <div className="landing__feature" key={f.title}>
              <div className="landing__feature-ico">{f.icon}</div>
              <span className="landing__step-num">{f.step}</span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
