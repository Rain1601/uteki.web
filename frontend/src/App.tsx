import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import AdminPage from './pages/AdminPage';
import AgentChatPage from './pages/AgentChatPage';
import LoginPage from './pages/LoginPage';
import NewsTimelinePage from './pages/NewsTimelinePage';
import FOMCCalendarPage from './pages/FOMCCalendarPage';
import SnbTradingPage from './pages/SnbTradingPage';
import IndexAgentPage from './pages/IndexAgentPage';
import CompanyAgentPage from './pages/CompanyAgentPage';

import AgentDashboardPage from './pages/AgentDashboardPage';
import MarketDashboardPage from './pages/MarketDashboardPage';


function App() {
  return (
    <Routes>
      {/* 登录页面 - 不受保护 */}
      <Route path="/login" element={<LoginPage />} />

      {/* 受保护的路由 */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/agent" replace />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="agent" element={<AgentChatPage />} />
        <Route path="news-timeline" element={<NewsTimelinePage />} />
        <Route path="macro/fomc-calendar" element={<FOMCCalendarPage />} />
        <Route path="macro/market-dashboard" element={<MarketDashboardPage />} />
        <Route path="trading/snb" element={<SnbTradingPage />} />
        <Route path="agent-dashboard" element={<AgentDashboardPage />} />
        <Route path="index-agent" element={<IndexAgentPage />} />
        <Route path="company-agent" element={<CompanyAgentPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
