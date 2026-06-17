// 로그인 페이지 — Google 로그인 only.
// 이메일/비밀번호 로그인은 제거되었다. VITE_GOOGLE_CLIENT_ID 또는 백엔드 GOOGLE_CLIENT_ID 가
// 설정되지 않으면 Google 버튼이 자동 숨겨지고 안내 문구만 노출된다.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import BrandTitle from '../components/BrandTitle.jsx';
import GoogleLoginButton from '../components/GoogleLoginButton.jsx';

// next query param 또는 location.state.from 을 우선 이동 경로로 사용.
// 이미 로그인된 사용자가 다시 들어오면 즉시 이동.
export default function LoginPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get('next');
  const from = nextParam || location.state?.from || '/history';

  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  const [err, setErr] = useState('');

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__brand">
          <BrandTitle size="lg" />
        </div>
        <h1 className="auth-card__title">ReviewFit 시작하기</h1>
        <p className="auth-card__sub">
          Google 계정으로 로그인하면 분석 결과를 안전하게 다시 볼 수 있어요.
        </p>

        {err && <div className="error-banner" role="alert">{err}</div>}

        <div className="auth-card__google">
          <GoogleLoginButton
            text="continue_with"
            onSuccess={() => navigate(from, { replace: true })}
            onError={(m) => setErr(m)}
          />
          <p className="auth-card__legal muted">
            계속하면 ReviewFit{' '}
            <Link to="/terms">이용약관</Link>
            {' 및 '}
            <Link to="/privacy">개인정보처리방침</Link>
            에 동의한 것으로 간주됩니다.
          </p>
        </div>

        <div className="auth-card__alt">
          <Link to="/" className="muted">← 홈으로</Link>
        </div>
      </div>
    </div>
  );
}
