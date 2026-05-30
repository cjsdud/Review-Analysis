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

  const login = useCallback(async (email, password) => {
    setError('');
    try {
      await authApi.login({ email, password });
      await refresh();
      return { ok: true };
    } catch (e) {
      setError(e.message);
      return { ok: false, error: e.message, code: e.code };
    }
  }, [refresh]);

  const register = useCallback(async (email, password, name) => {
    setError('');
    try {
      await authApi.register({ email, password, name });
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
    billingEnforced: !!me?.billingEnforced,
    loading,
    error,
    login,
    register,
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
