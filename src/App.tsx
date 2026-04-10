import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import LoadingScreen from './components/LoadingScreen';
import { PortalProvider, usePortal } from './portal/context';

const LoginView = lazy(() => import('./components/LoginView'));
const PortalLayout = lazy(() => import('./layouts/PortalLayout'));
const HomePage = lazy(() => import('./pages/HomePage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const AccountAccessPage = lazy(() => import('./pages/AccountAccessPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const RHApprovalsPage = lazy(() => import('./pages/RHApprovalsPage'));
const ReceiptsPage = lazy(() => import('./pages/ReceiptsPage'));
const TrainingsPage = lazy(() => import('./pages/TrainingsPage'));
const VacationsPage = lazy(() => import('./pages/VacationsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ManagerTeamsPage = lazy(() => import('./pages/ManagerTeamsPage'));
const CollaboratorsPage = lazy(() => import('./pages/CollaboratorsPage'));

function AppRoutes() {
  const { isAuthenticated, isLoadingSession, isLoadingPortalData, currentUser } = usePortal();
  const isTPeople = currentUser?.username === 't.people';

  if (isLoadingSession || isLoadingPortalData) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="*" element={<LoginView />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<PortalLayout />}>
          <Route index element={<HomePage />} />
          <Route path="perfil" element={<AccountAccessPage />} />
          <Route path="profile" element={isTPeople ? <Navigate to="/" replace /> : <ProfilePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="aprovacoes" element={<RHApprovalsPage />} />
          <Route path="equipas" element={<ManagerTeamsPage />} />
          <Route path="colaboradores" element={<CollaboratorsPage />} />
          <Route path="formacoes" element={<TrainingsPage />} />
          <Route path="ferias" element={isTPeople ? <Navigate to="/" replace /> : <VacationsPage />} />
          <Route path="recibos" element={<ReceiptsPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <PortalProvider>
      <AppRoutes />
    </PortalProvider>
  );
}
