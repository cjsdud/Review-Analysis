// "Google로 계속하기" 버튼.
//
// 동작:
//   1) VITE_GOOGLE_CLIENT_ID 또는 백엔드 GOOGLE_CLIENT_ID 가 없으면 아예 렌더링하지 않는다 (null).
//   2) Google Identity Services script (index.html 에서 async 로 로드됨) 가 준비되면
//      window.google.accounts.id.initialize → renderButton 으로 공식 버튼을 그린다.
//   3) callback 에서 response.credential 을 받아 loginWithGoogle(credential) 호출.
//   4) 성공 시 부모(onSuccess) 가 redirect 처리. 실패 시 onError 로 한국어 메시지 전달.
//
// 보안:
//   - credential 원문을 console.log / state 에 보존하지 않는다 (필요한 시점에 즉시 백엔드로 전송).
//   - script 로딩 지연 대비 — 최대 6초 polling 후 미로딩이면 onError 호출.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { getGoogleLoginConfig } from '../api/authApi.js';

const FRONT_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// google script 가 로드될 때까지 짧게 polling (단순 setInterval 보다 safe).
function waitForGoogleScript(timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    let elapsed = 0;
    const step = 100;
    const timer = setInterval(() => {
      elapsed += step;
      if (window.google?.accounts?.id) {
        clearInterval(timer);
        resolve(window.google.accounts.id);
        return;
      }
      if (elapsed >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('Google 로그인 스크립트 로드에 실패했어요. 네트워크를 확인해 주세요.'));
      }
    }, step);
  });
}

export default function GoogleLoginButton({ onSuccess, onError, text = 'continue_with' }) {
  const { loginWithGoogle } = useAuth();
  const containerRef = useRef(null);
  const [backendReady, setBackendReady] = useState(null); // null=확인 전, true/false=결과
  const [busy, setBusy] = useState(false);

  // 1) 백엔드 설정 확인 — Google Cloud Client ID 가 서버에도 있어야 검증 가능.
  useEffect(() => {
    let cancelled = false;
    if (!FRONT_CLIENT_ID) {
      setBackendReady(false);
      return () => {};
    }
    getGoogleLoginConfig().then((ok) => { if (!cancelled) setBackendReady(ok); });
    return () => { cancelled = true; };
  }, []);

  // 2) backendReady=true 일 때만 버튼 렌더.
  useEffect(() => {
    if (!FRONT_CLIENT_ID) return undefined;
    if (backendReady !== true) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const id = await waitForGoogleScript();
        if (cancelled) return;
        id.initialize({
          client_id: FRONT_CLIENT_ID,
          callback: async ({ credential }) => {
            if (!credential) {
              onError?.('Google 로그인 응답이 비어 있어요. 다시 시도해 주세요.');
              return;
            }
            setBusy(true);
            const result = await loginWithGoogle(credential);
            setBusy(false);
            if (result.ok) {
              onSuccess?.();
            } else {
              onError?.(humanizeGoogleError(result.code, result.error));
            }
          },
          // 사용자가 닫거나 취소해도 silently — 별도 안내 없이 버튼만 유지.
          cancel_on_tap_outside: true,
          auto_select: false,
        });
        if (containerRef.current) {
          id.renderButton(containerRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text,         // 'signin_with' | 'signup_with' | 'continue_with'
            shape: 'pill',
            logo_alignment: 'left',
            width: 280,
          });
        }
      } catch (e) {
        onError?.(e.message || 'Google 로그인 초기화에 실패했어요.');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendReady]);

  // 프론트/백엔드 어느 한쪽이라도 client_id 가 없으면 버튼 자체를 렌더하지 않는다.
  if (!FRONT_CLIENT_ID || backendReady === false) return null;

  return (
    <div className="google-login">
      <div ref={containerRef} className="google-login__button" />
      {busy && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>로그인 처리 중…</div>}
    </div>
  );
}

function humanizeGoogleError(code, fallback) {
  if (code === 'GOOGLE_EMAIL_UNVERIFIED') return '확인되지 않은 Google 계정이에요. 다른 Google 계정으로 시도해 주세요.';
  if (code === 'GOOGLE_LOGIN_FAILED') return 'Google 로그인에 실패했어요. 잠시 후 다시 시도해주세요.';
  if (code === 'GOOGLE_NOT_CONFIGURED') return 'Google 로그인 설정이 완료되지 않았어요.';
  if (code === 'SIGNUP_DISABLED') return '현재 신규 가입이 제한되어 있어요.';
  if (code === 'RATE_LIMITED') return '로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요.';
  return fallback || 'Google 로그인 중 일시적인 문제가 있었어요.';
}
