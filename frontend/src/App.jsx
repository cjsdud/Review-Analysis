import { Routes, Route } from 'react-router-dom';
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
import ProtectedRoute from './auth/ProtectedRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/upload" element={<ProtectedRoute><UploadPage /></ProtectedRoute>} />
        <Route path="/mapping/:uploadId" element={<ProtectedRoute><ColumnMappingPage /></ProtectedRoute>} />
        <Route path="/dashboard/:analysisId" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/products/:analysisId/:productKey" element={<ProtectedRoute><ProductDetailPage /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><AnalysisHistoryPage /></ProtectedRoute>} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      </Route>
    </Routes>
  );
}
