// 보호된 라우트. 로딩 중에는 스피너, 로그인 안 됨 + 데모 모드 아니면 /login 으로 보낸다.
// 데모 모드(서버가 익명 데모를 허용하는 상황)에서는 user 가 null 이어도 그대로 통과시킨다.
// 데모 모드 여부는 /api/me 가 401 이면 데모 모드일 가능성이 있으므로
// 단순히 user 가 없으면 /login 으로 보내고, 사용자가 "샘플 데이터 체험하기"를 누르면
// 따로 /upload 가 아닌 데모 흐름을 타도록 한다. 본 라우트는 인증 필요 라우트에만 사용.
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import LoadingState from '../components/LoadingState.jsx';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState title="로그인 정보를 확인하는 중..." />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}
