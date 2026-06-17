import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import BrandTitle from '../components/BrandTitle.jsx';
import { resolveSharedReportCode } from '../api/shareApi.js';

// 외부 셀러용 공유 코드 입력 페이지.
// 라우팅: /share (App.jsx 의 공개 라우트, ProtectedRoute 미적용)
// 권한: 비로그인 접근 가능. 코드 유효성 확인 후 /share/:code 로 이동.
//
// 에러 메시지는 만료/회수/미존재를 구분하지 않고 동일하게 "공유 코드를 확인할 수 없습니다."
// — 코드 존재 여부조차 외부에 흘리지 않는 정책.
export default function SharePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [code, setCode] = useState(location.state?.code || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!code.trim()) {
      setError('공유 코드를 입력해 주세요.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const data = await resolveSharedReportCode(code.trim());
      navigate(`/share/${data.code}`);
    } catch (err) {
      // 모든 실패는 동일한 사용자 메시지로 통일 — 코드 노출 차단.
      setError('공유 코드를 확인할 수 없습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="demo-shell">
      <header className="demo-topbar">
        <div className="demo-topbar__brand">
          <BrandTitle size="md" clickable />
          <span className="tag tag--neutral demo-topbar__badge">공유 분석</span>
        </div>
      </header>

      <main className="demo-main">
        <div className="demo-hero" style={{ maxWidth: 540, margin: '40px auto 0' }}>
          <h1 className="demo-hero__title">분석 결과 확인</h1>
          <p className="demo-hero__lede">
            전달받은 공유 코드를 입력하면 리뷰 분석 결과를 확인할 수 있습니다.
          </p>

          <form onSubmit={onSubmit} className="share-form" style={{ marginTop: 24 }}>
            <label htmlFor="share-code-input" className="visually-hidden">공유 코드</label>
            <input
              id="share-code-input"
              type="text"
              className="share-form__input"
              placeholder="공유 코드 입력"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={32}
              disabled={submitting}
              aria-invalid={!!error || undefined}
            />
            <button
              type="submit"
              className="btn btn--primary share-form__submit"
              disabled={submitting}
            >
              {submitting ? '확인 중…' : '결과 보기'}
            </button>
          </form>
          {error && (
            <div className="share-form__error" role="alert" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}

          <p className="muted" style={{ marginTop: 32, fontSize: 13, textAlign: 'center' }}>
            공유 코드는 분석을 요청한 셀러에게만 제공됩니다.
          </p>
        </div>
      </main>
    </div>
  );
}
