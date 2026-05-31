import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import LandingPage from './pages/LandingPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import ColumnMappingPage from './pages/ColumnMappingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProductDetailPage from './pages/ProductDetailPage.jsx';
import AnalysisHistoryPage from './pages/AnalysisHistoryPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import SampleReportPage from './pages/SampleReportPage.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import AdminRoute from './auth/AdminRoute.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminDashboardPage from './pages/admin/AdminDashboardPage.jsx';
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx';
import AdminReportsPage from './pages/admin/AdminReportsPage.jsx';
import AdminSettingsPage from './pages/admin/AdminSettingsPage.jsx';
import AdminAnnouncementsPage from './pages/admin/AdminAnnouncementsPage.jsx';
import AdminActionLogsPage from './pages/admin/AdminActionLogsPage.jsx';
import { useAuth } from './auth/AuthContext.jsx';

// / 진입 분기: 로그인 사용자는 분석 히스토리(앱 홈), 비로그인은 랜딩 페이지.
function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/history" replace />;
  return <LandingPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      {/* 공개 샘플 리포트 — 비로그인 접근 가능. 정적 데이터만 사용. */}
      <Route path="/demo/sample-report" element={<SampleReportPage />} />
      <Route element={<Layout />}>
        <Route path="/upload" element={<ProtectedRoute><UploadPage /></ProtectedRoute>} />
        <Route path="/mapping/:uploadId" element={<ProtectedRoute><ColumnMappingPage /></ProtectedRoute>} />
        <Route path="/dashboard/:analysisId" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/products/:analysisId/:productKey" element={<ProtectedRoute><ProductDetailPage /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><AnalysisHistoryPage /></ProtectedRoute>} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="reports" element={<AdminReportsPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
          <Route path="announcements" element={<AdminAnnouncementsPage />} />
          <Route path="action-logs" element={<AdminActionLogsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
