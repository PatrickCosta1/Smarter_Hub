import { Suspense, lazy, useEffect, useRef } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import LoadingScreen from './components/LoadingScreen';
import { PortalProvider, usePortal } from './portal/context';
import { apiRequestCached, authHeaders } from './portal/api';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

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
const DashboardPage = lazy(() => import('./pages/DashboardPage'));

function AppRoutes() {
  const { isAuthenticated, isLoadingSession, currentUser, hasPermission, isRootAccess, isAccessTotal } = usePortal();
  const isTPeople = currentUser?.username === 't.people';
  const prefetchFingerprintRef = useRef('');
  const currentYear = useRef(new Date().getFullYear()).current;

  const canViewUserList = isRootAccess || hasPermission('view_user_list');
  const canViewTeams = isRootAccess || hasPermission('view_teams') || hasPermission('manage_team_members');
  const canEditUser = isRootAccess || hasPermission('edit_user');
  const canManagePermissions = isRootAccess || hasPermission('manage_permissions');
  const canViewVacations = isRootAccess || hasPermission('request_vacation') || hasPermission('view_own_vacations') || hasPermission('view_all_vacations');
  const canReviewApprovals = isRootAccess || hasPermission('approve_profile_change') || hasPermission('approve_vacation');
  const canManageTrainings = isRootAccess || hasPermission('assign_training') || hasPermission('view_all_trainings');
  const canViewOwnTrainings = isRootAccess || hasPermission('view_trainings') || hasPermission('view_all_trainings');

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const warmChunks = () => {
      void import('./pages/HomePage');
      void import('./pages/NotificationsPage');
      void import('./pages/AccountAccessPage');
      void import('./pages/ProfilePage');
      void import('./pages/RHApprovalsPage');
      void import('./pages/ReceiptsPage');
      void import('./pages/TrainingsPage');
      void import('./pages/VacationsPage');
      void import('./pages/AdminPage');
      void import('./pages/ManagerTeamsPage');
      void import('./pages/CollaboratorsPage');
    };

    const token = window.localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const prefetchFingerprint = [
      token,
      isRootAccess ? 'root' : 'no-root',
      isAccessTotal ? 'access-total' : 'no-access-total',
      canViewUserList ? 'view_user_list' : '-',
      canViewTeams ? 'teams' : '-',
      canEditUser ? 'edit_user' : '-',
      canManagePermissions ? 'manage_permissions' : '-',
      canViewVacations ? 'vacations' : '-',
      canManageTrainings ? 'manage_trainings' : '-',
      canViewOwnTrainings ? 'view_trainings' : '-',
      canReviewApprovals ? 'approvals' : '-',
    ].join('|');

    const safePrefetch = (path: string, ttlMs: number) => apiRequestCached(path, { headers: authHeaders(token) }, ttlMs).catch(() => undefined);

    const warmCriticalData = () => {
      if (!token || prefetchFingerprintRef.current === prefetchFingerprint) {
        return;
      }

      prefetchFingerprintRef.current = prefetchFingerprint;

      const requests: Array<Promise<unknown>> = [
        safePrefetch('/auth/me', 30000),
        safePrefetch('/profile/me', 60000),
        safePrefetch('/notifications/me', 30000),
        safePrefetch('/profile/requests/me', 30000),
      ];

      if (canViewTeams) {
        requests.push(safePrefetch('/teams/me?details=none', 60000));
      }

      if (canViewUserList) {
        requests.push(safePrefetch('/users/collaborators?page=1&pageSize=20&sortBy=updatedAt&sortDirection=desc', 60000));
      }

      if (canEditUser || canManagePermissions) {
        requests.push(safePrefetch('/admin/users', 60000));
      }

      if (canManageTrainings) {
        requests.push(safePrefetch('/trainings/assigned', 60000));
      } else if (canViewOwnTrainings) {
        requests.push(safePrefetch('/trainings/me', 60000));
      }

      if (canViewVacations) {
        requests.push(safePrefetch('/vacations/requests', 60000));
        requests.push(safePrefetch('/vacations/me', 60000));
        requests.push(safePrefetch('/vacations/overview', 60000));
        requests.push(safePrefetch(`/vacations/calendar?year=${currentYear}`, 60000));
        requests.push(safePrefetch('/users/me/teams', 120000));
      }

      if (canReviewApprovals) {
        requests.push(safePrefetch('/profile/requests', 60000));
      }

      if (isRootAccess || isAccessTotal) {
        requests.push(safePrefetch('/users/dashboard-summary', 60000));
      }

      void Promise.allSettled(requests);
    };

    const warmSecondaryData = () => {
      if (!token) {
        return;
      }

      const requests: Array<Promise<unknown>> = [];

      if (canViewTeams) {
        requests.push(safePrefetch('/users/collaborators?page=1&pageSize=250&sortBy=username&sortDirection=asc', 60000));
      }

      if (canViewUserList) {
        requests.push(safePrefetch('/admin/teams', 60000));
        requests.push(safePrefetch('/teams', 60000));
      }

      if (canManagePermissions && currentUser?.id) {
        requests.push(safePrefetch(`/users/${currentUser.id}/permissions`, 60000));
      }

      void Promise.allSettled(requests);
    };

    warmCriticalData();

    const warmEverything = () => {
      warmChunks();
      warmSecondaryData();
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const idleId = idleWindow.requestIdleCallback(warmEverything, { timeout: 1500 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timeoutId = globalThis.setTimeout(warmEverything, 0);
    return () => globalThis.clearTimeout(timeoutId);
  }, [
    canEditUser,
    canManagePermissions,
    canManageTrainings,
    canReviewApprovals,
    canViewOwnTrainings,
    canViewTeams,
    canViewUserList,
    canViewVacations,
    currentUser?.id,
    isAccessTotal,
    isAuthenticated,
    isRootAccess,
  ]);

  if (isLoadingSession) {
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
          <Route path="dashboard" element={<DashboardPage />} />
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
