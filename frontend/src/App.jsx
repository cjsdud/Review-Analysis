import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import LandingPage from './pages/LandingPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import ColumnMappingPage from './pages/ColumnMappingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProductDetailPage from './pages/ProductDetailPage.jsx';
import AnalysisHistoryPage from './pages/AnalysisHistoryPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route element={<Layout />}>
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/mapping/:uploadId" element={<ColumnMappingPage />} />
        <Route path="/dashboard/:analysisId" element={<DashboardPage />} />
        <Route path="/products/:analysisId/:productKey" element={<ProductDetailPage />} />
        <Route path="/history" element={<AnalysisHistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
