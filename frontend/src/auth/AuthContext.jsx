// 전역 인증/구독 컨텍스트.
// 페이지 로드 시 /api/me 호출로 현재 사용자 확인.
// /api/me 가 401 이면 로그인 안 됨 상태로 둔다(데모 모드에서는 보호 라우트가 인앱 분기로 처리).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as authApi from '../api/authApi.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null); // { user, subscription, usage, billingEnforced } | null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const data = await authApi.getMe();
      setMe(data);
    } catch (e) {
      // 401 등 — 미인증 상태로 처리
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Google ID Token credential → 백엔드 /api/auth/google 호출 → /api/me refresh.
  // 결과 shape: { ok, error?, code? }.
  // (이메일/비밀번호 login/register 는 더 이상 지원하지 않는다 — Google 로그인 only.)
  const loginWithGoogle = useCallback(async (credential) => {
    setError('');
    try {
      await authApi.googleLogin(credential);
      await refresh();
      return { ok: true };
    } catch (e) {
      setError(e.message);
      return { ok: false, error: e.message, code: e.code };
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    setMe(null);
  }, []);

  const value = {
    user: me?.user || null,
    subscription: me?.subscription || null,
    usage: me?.usage || null,
    // 플랜 기능 플래그 + LLM 정책 — 프론트가 export 버튼 disable / 워터마크 표시 등에 사용.
    // /api/me 가 미인증 등으로 me=null 이면 기본 free 플랜 동작.
    features: me?.features || null,
    llmPolicy: me?.llmPolicy || null,
    billingEnforced: !!me?.billingEnforced,
    loading,
    error,
    loginWithGoogle,
    logout,
    refresh,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
