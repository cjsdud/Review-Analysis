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
import SharePage from './pages/SharePage.jsx';
import SharedReportPage from './pages/SharedReportPage.jsx';
import TermsPage from './pages/TermsPage.jsx';
import PrivacyPage from './pages/PrivacyPage.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import AdminRoute from './auth/AdminRoute.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminDashboardPage from './pages/admin/AdminDashboardPage.jsx';
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx';
import AdminReportsPage from './pages/admin/AdminReportsPage.jsx';
import AdminSettingsPage from './pages/admin/AdminSettingsPage.jsx';
import AdminAnnouncementsPage from './pages/admin/AdminAnnouncementsPage.jsx';
import AdminActionLogsPage from './pages/admin/AdminActionLogsPage.jsx';
import AdminLlmLogsPage from './pages/admin/AdminLlmLogsPage.jsx';
import AdminSharesPage from './pages/admin/AdminSharesPage.jsx';
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
      {/* /signup 은 Google 로그인 only 전환으로 의미가 없어졌다 — 로그인 페이지로 리다이렉트.
          기존 booklet/DM 링크가 깨지지 않도록 라우트 자체는 유지. next 쿼리도 보존. */}
      <Route path="/signup" element={<Navigate to="/login" replace />} />
      {/* 공개 샘플 리포트 — 비로그인 접근 가능. 정적 데이터만 사용. */}
      <Route path="/demo/sample-report" element={<SampleReportPage />} />
      {/* 외부 셀러용 공유 코드 입력 + 공유 분석 결과 — 비로그인 접근 가능. */}
      <Route path="/share" element={<SharePage />} />
      <Route path="/share/:code" element={<SharedReportPage />} />
      {/* 법적 페이지 — 비로그인 사용자도 접근 가능. Layout 의 user.role 참조를 피하기 위해 별도 라우트. */}
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
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
          <Route path="llm-logs" element={<AdminLlmLogsPage />} />
          <Route path="shares" element={<AdminSharesPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
