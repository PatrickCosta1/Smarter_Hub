import { Suspense, lazy, useEffect, useRef } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import LoadingScreen from './components/LoadingScreen';
import { PortalProvider, usePortal } from './portal/context';
import { apiRequestCached, authHeaders } from './portal/api';
import { LanguageProvider } from './contexts/LanguageContext';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';
const ENABLE_AGGRESSIVE_PREFETCH = import.meta.env.VITE_ENABLE_AGGRESSIVE_PREFETCH === 'true';

const LoginView = lazy(() => import('./components/LoginView'));
const PortalLayout = lazy(() => import('./layouts/PortalLayout'));
const HomePage = lazy(() => import('./pages/HomePage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const AccountAccessPage = lazy(() => import('./pages/AccountAccessPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const RHApprovalsPage = lazy(() => import('./pages/RHApprovalsPage'));
const TrainingsPage = lazy(() => import('./pages/TrainingsPage'));
const VacationsPage = lazy(() => import('./pages/VacationsPage'));
const HourBankPage = lazy(() => import('./pages/HourBankPage'));
const CareerPlanPage = lazy(() => import('./pages/CareerPlanPage'));
const ManagerTeamsPage = lazy(() => import('./pages/ManagerTeamsPage'));
const CollaboratorsPage = lazy(() => import('./pages/CollaboratorsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const EmployeeAdmissionPage = lazy(() => import('./pages/EmployeeAdmissionPage'));
const AdmissionsPage = lazy(() => import('./pages/AdmissionsPage'));
const WellbeingPage = lazy(() => import('./pages/WellbeingPage'));

function AppRoutes() {
  const { isAuthenticated, isLoadingSession, isLoadingPortalData, currentUser, hasPermission, isRootAccess, isAccessTotal, profile } = usePortal();
  const isTPeople = currentUser?.username === 't.people';
  const prefetchFingerprintRef = useRef('');

  const canViewUserList = isRootAccess || hasPermission('view_user_list');
  const canViewTeams = !isTPeople && (currentUser?.role ?? '') !== 'CONVIDADO';
  const canEditUser = isRootAccess || hasPermission('edit_user');
  const canManagePermissions = isRootAccess || hasPermission('manage_permissions');
  const canViewVacations = isRootAccess || hasPermission('request_vacation') || hasPermission('view_own_vacations') || hasPermission('view_team_vacations') || hasPermission('view_all_vacations');
  const canReviewApprovals = isRootAccess || hasPermission('approve_profile_change') || hasPermission('approve_vacation');
  const canManageTrainings = isRootAccess || hasPermission('assign_training') || hasPermission('view_all_trainings');
  const canViewOwnTrainings = isRootAccess || hasPermission('view_trainings') || hasPermission('view_all_trainings');
  const canUseHourBankAcrossCountries = isTPeople;
  const canUseHourBank =
    (isLoadingPortalData || profile.workCountry === 'BR' || canUseHourBankAcrossCountries)
    && (isRootAccess || isAccessTotal || hasPermission('view_hours_bank') || hasPermission('manage_hours_bank'));

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const isConstrainedNetwork = Boolean(connection?.saveData) || ['slow-2g', '2g'].includes(connection?.effectiveType || '');

    const warmChunks = () => {
      void import('./pages/HomePage');
      void import('./pages/NotificationsPage');
      void import('./pages/AccountAccessPage');
      void import('./pages/ProfilePage');
      void import('./pages/RHApprovalsPage');
      void import('./pages/TrainingsPage');
      void import('./pages/VacationsPage');
      void import('./pages/HourBankPage');
      void import('./pages/CareerPlanPage');
      void import('./pages/ManagerTeamsPage');
      void import('./pages/CollaboratorsPage');
      void import('./pages/DashboardPage');
      void import('./pages/WellbeingPage');
    };

    const token = window.localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const prefetchFingerprint = [
      token,
      ENABLE_AGGRESSIVE_PREFETCH ? 'prefetch-aggressive' : 'prefetch-minimal',
      isConstrainedNetwork ? 'net-constrained' : 'net-normal',
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

    if (prefetchFingerprintRef.current === prefetchFingerprint) {
      return;
    }
    prefetchFingerprintRef.current = prefetchFingerprint;

    const safePrefetch = (path: string, ttlMs: number) => apiRequestCached(path, { headers: authHeaders(token) }, ttlMs).catch(() => undefined);

    const warmSecondaryData = () => {
      if (!token) {
        return;
      }

      if (isConstrainedNetwork) {
        return;
      }

      const requests: Array<Promise<unknown>> = [];

      requests.push(safePrefetch('/notifications/me', 10000));
      requests.push(safePrefetch('/profile/me', 30000));

      if (!ENABLE_AGGRESSIVE_PREFETCH) {
        void Promise.allSettled(requests);
        return;
      }

      if (canViewTeams) {
        requests.push(safePrefetch('/users/collaborators?page=1&pageSize=250&sortBy=username&sortDirection=asc', 60000));
      }

      if (canViewUserList) {
        requests.push(safePrefetch('/admin/teams', 60000));
        requests.push(safePrefetch('/teams', 60000));
      }

      if (isRootAccess || isAccessTotal) {
        requests.push(safePrefetch('/users/dashboard-summary', 45000));
      }

      if (canReviewApprovals) {
        requests.push(safePrefetch('/profile/requests', 45000));
        requests.push(safePrefetch('/vacations/requests', 45000));
      }

      if (canViewVacations) {
        requests.push(safePrefetch('/vacations/me', 30000));
        requests.push(safePrefetch('/vacations/overview', 30000));
      }

      if (canManageTrainings || canViewOwnTrainings) {
        requests.push(safePrefetch('/trainings/me', 60000));
      }

      void Promise.allSettled(requests);
    };

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
          <Route path="/admissao/:token" element={<EmployeeAdmissionPage />} />
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
          <Route path="plano-carreira" element={isTPeople ? <Navigate to="/" replace /> : <CareerPlanPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="aprovacoes" element={<RHApprovalsPage />} />
          <Route path="admissoes" element={<AdmissionsPage />} />
          <Route path="equipas" element={<ManagerTeamsPage />} />
          <Route path="colaboradores" element={<CollaboratorsPage />} />
          <Route path="saude-bem-estar" element={<WellbeingPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="formacoes" element={<TrainingsPage />} />
          <Route path="ferias" element={<VacationsPage />} />
          <Route path="banco-horas" element={canUseHourBank ? <HourBankPage /> : <Navigate to="/" replace />} />
          <Route path="admin" element={<Navigate to="/colaboradores" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <PortalProvider>
        <AppRoutes />
      </PortalProvider>
    </LanguageProvider>
  );
}
