// 로그인 / 회원가입 페이지 (toggle 방식).
// "Google로 계속하기" 를 최상단 기본 옵션으로, 이메일/비밀번호는 보조 옵션으로 둔다.
// VITE_GOOGLE_CLIENT_ID 또는 백엔드 GOOGLE_CLIENT_ID 미설정 시 Google 버튼이 자동 숨김.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import BrandTitle from '../components/BrandTitle.jsx';
import GoogleLoginButton from '../components/GoogleLoginButton.jsx';

// initialMode='login'  → /login 진입 시 로그인 폼
// initialMode='register' → /signup 진입 시 회원가입 폼
// next query param 또는 location.state.from 을 우선 이동 경로로 사용
// 이미 로그인된 사용자가 다시 들어오면 next 또는 /history 로 즉시 이동.
export default function LoginPage({ initialMode = 'login' }) {
  const { user, login, register } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get('next');
  const from = nextParam || location.state?.from || '/history';

  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  const [mode, setMode] = useState(location.state?.mode || initialMode); // 'login' | 'register'
  // URL 이 /login ↔ /signup 사이를 오갈 때 mode 동기화
  useEffect(() => { setMode(location.state?.mode || initialMode); }, [initialMode, location.state?.mode]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function valid() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '이메일 형식이 올바르지 않습니다.';
    if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
    if (mode === 'register' && password !== password2) return '비밀번호 확인이 일치하지 않습니다.';
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const v = valid();
    if (v) { setErr(v); return; }
    setBusy(true);
    setErr('');
    const result = mode === 'login'
      ? await login(email, password)
      : await register(email, password, name);
    setBusy(false);
    if (!result.ok) {
      setErr(humanize(result.code, result.error));
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__brand">
          <BrandTitle size="lg" />
        </div>
        <h1 className="auth-card__title">
          {mode === 'login' ? '로그인' : '회원가입'}
        </h1>
        <p className="auth-card__sub">
          {mode === 'login'
            ? '이메일로 로그인하고 분석 결과를 다시 볼 수 있어요.'
            : '이메일과 비밀번호만으로 가입할 수 있어요.'}
        </p>

        {err && <div className="error-banner" role="alert">{err}</div>}

        {/* Google로 계속하기 — 가장 위에. 환경 변수 없으면 자동 숨김. */}
        <div className="auth-card__google">
          <GoogleLoginButton
            text={mode === 'login' ? 'signin_with' : 'continue_with'}
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

        <div className="auth-card__divider" aria-hidden="true">
          <span>또는 이메일로 {mode === 'login' ? '로그인' : '가입'}</span>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'register' && (
            <label>
              이름 (선택)
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 김리뷰"
                autoComplete="name"
              />
            </label>
          )}
          <label>
            이메일
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            비밀번호 (8자 이상)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </label>
          {mode === 'register' && (
            <label>
              비밀번호 확인
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? '처리 중…' : mode === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>

        <div className="auth-card__switch">
          {mode === 'login' ? (
            <>
              아직 계정이 없으신가요?{' '}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  setMode('register'); setErr('');
                  // URL 도 /signup 으로 동기화 (next 유지)
                  const q = nextParam ? `?next=${encodeURIComponent(nextParam)}` : '';
                  navigate(`/signup${q}`, { replace: true, state: { from } });
                }}
              >
                회원가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있으신가요?{' '}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  setMode('login'); setErr('');
                  const q = nextParam ? `?next=${encodeURIComponent(nextParam)}` : '';
                  navigate(`/login${q}`, { replace: true, state: { from } });
                }}
              >
                로그인
              </button>
            </>
          )}
        </div>

        <div className="auth-card__alt">
          <Link to="/" className="muted">← 홈으로</Link>
        </div>
      </div>
    </div>
  );
}

// 백엔드 에러 코드를 사용자 메시지로 변환.
// 보안 주의: RESERVED_ACCOUNT_EMAIL 은 admin/tester 구분을 절대 노출하지 않는다.
function humanize(code, msg) {
  if (code === 'RESERVED_ACCOUNT_EMAIL') {
    return '해당 이메일은 베타 테스트용으로 예약된 계정입니다. 운영자에게 문의해 주세요.';
  }
  if (code === 'EMAIL_TAKEN') return '이미 가입된 이메일입니다.';
  if (code === 'INVALID_CREDENTIALS') return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (code === 'INVALID_INPUT') return '입력값을 확인해 주세요.';
  if (code === 'SIGNUP_DISABLED') return '현재 신규 가입이 제한되어 있습니다.';
  if (code === 'RATE_LIMITED') return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
  if (code === 'GOOGLE_EMAIL_UNVERIFIED') return '확인되지 않은 Google 계정이에요. 다른 Google 계정으로 시도해 주세요.';
  if (code === 'GOOGLE_LOGIN_FAILED') return 'Google 로그인에 실패했어요. 잠시 후 다시 시도해주세요.';
  if (code === 'GOOGLE_NOT_CONFIGURED') return 'Google 로그인 설정이 완료되지 않았어요.';
  if (msg) return msg;
  return '요청 중 오류가 발생했습니다.';
}
