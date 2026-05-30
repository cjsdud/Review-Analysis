// 로그인 / 회원가입 페이지 (toggle 방식).
// 이메일/비밀번호 기반. 로그인 성공 시 from(원래 가려던 곳) 또는 /upload 로 이동.
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import BrandTitle from '../components/BrandTitle.jsx';

export default function LoginPage() {
  const { login, register } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const from = location.state?.from || '/upload';

  const [mode, setMode] = useState('login'); // 'login' | 'register'
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
      setErr(humanize(result.error));
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
              <button type="button" className="linklike" onClick={() => { setMode('register'); setErr(''); }}>
                회원가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있으신가요?{' '}
              <button type="button" className="linklike" onClick={() => { setMode('login'); setErr(''); }}>
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

// 백엔드 에러 코드를 사용자 메시지로 변환
function humanize(msg) {
  if (!msg) return '요청 중 오류가 발생했습니다.';
  if (msg === 'EMAIL_TAKEN') return '이미 가입된 이메일입니다.';
  if (msg === 'INVALID_CREDENTIALS') return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (msg === 'INVALID_INPUT') return '입력값을 확인해 주세요.';
  return msg;
}
