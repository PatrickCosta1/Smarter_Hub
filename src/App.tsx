import { Navigate, Route, Routes } from 'react-router-dom';
import LoginView from './components/LoginView';
import PortalLayout from './layouts/PortalLayout';
import HomePage from './pages/HomePage';
import NotificationsPage from './pages/NotificationsPage';
import ProfilePage from './pages/ProfilePage';
import { PortalProvider, usePortal } from './portal/context';

function AppRoutes() {
  const { isAuthenticated, isLoadingSession } = usePortal();

  if (isLoadingSession) {
    return <main className="login-shell">A carregar sessão...</main>;
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
        <Route path="profile" element={<ProfilePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
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
