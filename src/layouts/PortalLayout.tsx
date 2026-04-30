import { useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleLabels } from '../portal/data';
import { usePortal } from '../portal/context';
import { MenuItem } from '../portal/types';
import { apiRequestCached, authHeaders } from '../portal/api';
import ChatbotWidget from '../components/ChatbotWidget';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

export default function PortalLayout() {
  const { userRole, unreadNotifications, logout, hasPermission, isRootAccess, isAccessTotal, currentUser } = usePortal();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuQuery, setMenuQuery] = useState('');
  const prefetchedRoutesRef = useRef<Set<string>>(new Set());
  const isTPeople = currentUser?.username === 't.people';
  const canManageTrainings = isRootAccess || hasPermission('assign_training') || hasPermission('view_all_trainings');

  const roleMenus = useMemo(() => {
    const can = (code: string) => isRootAccess || hasPermission(code);

    const menu: MenuItem[] = [
      { id: 'home', label: 'Home', path: '/' },
      ...(isRootAccess || isAccessTotal ? [{ id: 'dashboard', label: 'Dashboard', path: '/dashboard' }] : []),
      ...(!isTPeople ? [{ id: 'profile', label: 'A Minha Ficha', path: '/profile' }] : []),
      ...((currentUser?.role ?? '') !== 'CONVIDADO' ? [{ id: 'equipas', label: 'Equipas', path: '/equipas' }] : []),
      ...(can('view_user_list') ? [{ id: 'colaboradores', label: 'Colaboradores', path: '/colaboradores' }] : []),
      ...(can('approve_profile_change') || can('approve_vacation') || can('reject_vacation') || can('view_all_vacations')
        ? [{ id: 'aprovacoes', label: 'Aprovações', path: '/aprovacoes' }]
        : []),
      ...(can('view_trainings') || can('view_all_trainings') || can('request_training') || can('assign_training')
        ? [{ id: 'formacoes', label: 'Formações', path: '/formacoes' }]
        : []),
      ...((can('request_vacation') || can('view_own_vacations') || can('view_all_vacations') || can('manage_vacation_rules'))
        ? [{ id: 'ferias', label: 'Férias / Ausências', path: '/ferias' }]
        : []),
      ...((can('view_hours_bank') || can('manage_hours_bank') || isRootAccess || isAccessTotal)
        ? [{ id: 'banco-horas', label: 'Banco de Horas', path: '/banco-horas' }]
        : []),
    ];

    return menu;
  }, [currentUser?.role, hasPermission, isAccessTotal, isRootAccess, isTPeople]);

  const currentMenu = useMemo(
    () => roleMenus.find((item) => item.path === location.pathname),
    [location.pathname, roleMenus],
  );

  const filteredMenu = useMemo(() => {
    const normalized = menuQuery.trim().toLowerCase();

    if (!normalized) {
      return roleMenus;
    }

    return roleMenus.filter((item) => item.label.toLowerCase().includes(normalized));
  }, [menuQuery, roleMenus]);

  const personalMenu = useMemo(() => {
    const personalIds = new Set(['home', 'profile', 'equipas', 'formacoes', 'ferias', 'notifications']);
    return filteredMenu.filter((item) => personalIds.has(item.id));
  }, [filteredMenu]);

  const managementMenu = useMemo(() => {
    const managementIds = new Set(['dashboard', 'colaboradores', 'aprovacoes', 'banco-horas', 'admin']);
    return filteredMenu.filter((item) => managementIds.has(item.id));
  }, [filteredMenu]);

  const todayLabel = useMemo(
    () => new Intl.DateTimeFormat('pt-PT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()),
    [],
  );

  const globalInfoLabel = useMemo(() => {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const start = new Date(Date.UTC(utcYear, 0, 1));
    const days = Math.floor((Date.UTC(utcYear, utcMonth, utcDate) - start.getTime()) / 86400000) + 1;
    const week = Math.ceil(days / 7);

    return `${todayLabel}`;
  }, [todayLabel]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function prefetchRoute(path: string) {
    if (prefetchedRoutesRef.current.has(path)) {
      return;
    }

    prefetchedRoutesRef.current.add(path);

    switch (path) {
      case '/equipas':
        void import('../pages/ManagerTeamsPage');
        break;
      case '/colaboradores':
        void import('../pages/CollaboratorsPage');
        break;
      case '/aprovacoes':
        void import('../pages/RHApprovalsPage');
        break;
      case '/formacoes':
        void import('../pages/TrainingsPage');
        break;
      case '/ferias':
        void import('../pages/VacationsPage');
        break;
      case '/banco-horas':
        void import('../pages/HourBankPage');
        break;
      case '/profile':
        void import('../pages/ProfilePage');
        break;
      default:
        break;
    }

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    if (!token) {
      return;
    }

    const headers = authHeaders(token);
    const safePrefetch = (endpoint: string, ttlMs: number) => apiRequestCached(endpoint, { headers }, ttlMs).catch(() => undefined);

    if (path === '/dashboard' && (isRootAccess || isAccessTotal)) {
      void safePrefetch('/users/dashboard-summary', 45000);
      return;
    }

    if (path === '/equipas') {
      void safePrefetch('/teams/me?details=none', 45000);
      return;
    }

    if (path === '/colaboradores') {
      void safePrefetch('/users/collaborators?page=1&pageSize=20&sortBy=updatedAt&sortDirection=desc', 30000);
      return;
    }

    if (path === '/aprovacoes') {
      void Promise.allSettled([
        safePrefetch('/profile/requests', 45000),
        safePrefetch('/vacations/requests', 45000),
      ]);
      return;
    }

    if (path === '/formacoes') {
      void safePrefetch('/trainings/me', 45000);
      return;
    }

    if (path === '/ferias') {
      void Promise.allSettled([
        safePrefetch('/vacations/me', 30000),
        safePrefetch('/vacations/overview', 30000),
      ]);
      return;
    }

    if (path === '/banco-horas') {
      void Promise.allSettled([
        safePrefetch('/hours-bank/me', 30000),
        safePrefetch('/hours-bank/overview?page=1&pageSize=50&workCountry=BR', 30000),
      ]);
    }
  }

  return (
    <>
    <main className="app-shell">
      <div className="login-background" aria-hidden="true">
        <span className="shape shape-left" />
        <span className="shape shape-right" />
        <span className="shape shape-bottom" />
        <span className="orbs orb-a" />
        <span className="orbs orb-b" />
        <span className="grid" />
      </div>

      <section className="app-layout app-layout--modern">
        <aside className="portal-sidebar" aria-label="Navegação principal">
          <div className="portal-sidebar__brand">
            <img src="/logo.png" alt="Tlantic" width={1123} height={651} decoding="async" />
          </div>

          <label className="portal-sidebar__search">
            <span>Ir para</span>
            <input
              type="search"
              placeholder="Pesquisar área..."
              value={menuQuery}
              onChange={(event) => setMenuQuery(event.target.value)}
            />
          </label>

          <nav className="portal-nav" aria-label="Menu principal">
            {personalMenu.length > 0 && (
              <div className="portal-nav__group">
                <p className="portal-nav__group-label">Colaborador</p>
                {personalMenu.map((item) => (
                  <NavLink
                    key={item.id}
                    className={({ isActive }) => `portal-nav__link${isActive ? ' is-active' : ''}`}
                    to={item.path}
                    onMouseEnter={() => prefetchRoute(item.path)}
                    onFocus={() => prefetchRoute(item.path)}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}

            {managementMenu.length > 0 && (
              <div className="portal-nav__group">
                <p className="portal-nav__group-label">Gestão RH</p>
                {managementMenu.map((item) => (
                  <NavLink
                    key={item.id}
                    className={({ isActive }) => `portal-nav__link${isActive ? ' is-active' : ''}`}
                    to={item.path}
                    onMouseEnter={() => prefetchRoute(item.path)}
                    onFocus={() => prefetchRoute(item.path)}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}

            {filteredMenu.length === 0 && <p className="portal-nav__empty">Sem áreas para essa pesquisa.</p>}
          </nav>
        </aside>

        <section className="portal-content">
          <header className="portal-header">
            <div className="portal-header__meta">
              <p className="portal-breadcrumb">Portal do Colaborador</p>
              <h2>{currentMenu?.label || 'Início'}</h2>
            </div>

            <div className="portal-header__actions">
              <span className="portal-header__chip">{globalInfoLabel}</span>
              <button
                className={`icon-button icon-button--header${unreadNotifications > 0 ? ' has-unread' : ''}${location.pathname === '/notifications' ? ' is-active' : ''}`}
                type="button"
                onClick={() => navigate('/notifications')}
                aria-label="Notificações"
                title={unreadNotifications > 0 ? `${unreadNotifications} notificação${unreadNotifications === 1 ? '' : 's'} por ler` : 'Notificações'}
              >
                <span className="icon-button__ping" aria-hidden="true" />
                <span aria-hidden="true">🔔</span>
                {unreadNotifications > 0 && <span className="icon-badge">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
              </button>
              <button
                className={`icon-button icon-button--header${location.pathname === '/profile' ? ' is-active' : ''}`}
                type="button"
                onClick={() => navigate(isTPeople ? '/colaboradores' : '/profile')}
                aria-label="Perfil"
                title="Perfil"
              >
                <span aria-hidden="true">👤</span>
              </button>
              <button className="topbar-link" type="button" onClick={handleLogout}>
                Sair
              </button>
            </div>
          </header>

          <div className="portal-page">
            <Outlet />
          </div>
        </section>

      </section>
    </main>
    <ChatbotWidget />
    </>
  );
}
