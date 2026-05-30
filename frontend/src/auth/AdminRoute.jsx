import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import LoadingState from '../components/LoadingState.jsx';
import AccessError from '../components/AccessError.jsx';

// 관리자 라우트 가드. 로딩→로그인→권한 순으로 분기.
export default function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState title="권한을 확인하는 중..." />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (user.role !== 'admin') {
    return (
      <AccessError
        kind="FORBIDDEN"
        detail="관리자 권한이 필요한 페이지입니다."
      />
    );
  }
  return children;
}
