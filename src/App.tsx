import { Navigate, Route, Routes } from 'react-router-dom';
import LoginView from './components/LoginView';
import LoadingScreen from './components/LoadingScreen';
import PortalLayout from './layouts/PortalLayout';
import HomePage from './pages/HomePage';
import NotificationsPage from './pages/NotificationsPage';
import AccountAccessPage from './pages/AccountAccessPage';
import ProfilePage from './pages/ProfilePage';
import RHApprovalsPage from './pages/RHApprovalsPage';
import ReceiptsPage from './pages/ReceiptsPage';
import TrainingsPage from './pages/TrainingsPage';
import VacationsPage from './pages/VacationsPage';
import AdminPage from './pages/AdminPage';
import ManagerTeamsPage from './pages/ManagerTeamsPage';
import { PortalProvider, usePortal } from './portal/context';

function AppRoutes() {
  const { isAuthenticated, isLoadingSession } = usePortal();

  if (isLoadingSession) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="*" element={<LoginView />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<PortalLayout />}>
        <Route index element={<HomePage />} />
        <Route path="perfil" element={<AccountAccessPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="aprovacoes" element={<RHApprovalsPage />} />
        <Route path="equipas" element={<ManagerTeamsPage />} />
        <Route path="formacoes" element={<TrainingsPage />} />
        <Route path="ferias" element={<VacationsPage />} />
        <Route path="recibos" element={<ReceiptsPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <PortalProvider>
      <AppRoutes />
    </PortalProvider>
  );
}
