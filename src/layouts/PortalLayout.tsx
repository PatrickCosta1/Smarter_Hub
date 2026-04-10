import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleLabels } from '../portal/data';
import { usePortal } from '../portal/context';
import { MenuItem } from '../portal/types';

export default function PortalLayout() {
  const { userRole, unreadNotifications, logout, hasPermission, isRootAccess, currentUser } = usePortal();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuQuery, setMenuQuery] = useState('');
  const isTPeople = currentUser?.username === 't.people';

  const roleMenus = useMemo(() => {
    const can = (code: string) => isRootAccess || hasPermission(code);

    const menu: MenuItem[] = [
      { id: 'home', label: 'Home', path: '/' },
      ...(!isTPeople ? [{ id: 'profile', label: 'A Minha Ficha', path: '/profile' }] : []),
      ...(can('view_teams') || can('manage_team_members') ? [{ id: 'equipas', label: 'Equipas', path: '/equipas' }] : []),
      ...(can('view_user_list') ? [{ id: 'colaboradores', label: 'Colaboradores', path: '/colaboradores' }] : []),
      ...(can('edit_user') || can('create_team') || can('edit_team') || can('delete_team')
        ? [{ id: 'admin', label: 'Administração', path: '/admin' }]
        : []),
      ...(can('approve_profile_change') || can('approve_vacation') || can('reject_vacation') || can('view_all_vacations')
        ? [{ id: 'aprovacoes', label: 'Aprovações', path: '/aprovacoes' }]
        : []),
      ...(can('view_trainings') || can('view_all_trainings') || can('request_training') || can('assign_training')
        ? [{ id: 'formacoes', label: 'Formações', path: '/formacoes' }]
        : []),
      ...(!isTPeople && (can('request_vacation') || can('view_own_vacations') || can('view_all_vacations'))
        ? [{ id: 'ferias', label: 'Férias', path: '/ferias' }]
        : []),
      ...(can('view_receipts') || can('view_all_receipts') ? [{ id: 'recibos', label: 'Recibos', path: '/recibos' }] : []),
    ];

    return menu;
  }, [hasPermission, isRootAccess, isTPeople]);

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

  return (
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
            <img src="/logo.png" alt="Tlantic" />
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
            {filteredMenu.map((item) => (
              <NavLink key={item.id} className={({ isActive }) => `portal-nav__link${isActive ? ' is-active' : ''}`} to={item.path}>
                {item.label}
              </NavLink>
            ))}
            {filteredMenu.length === 0 && <p className="portal-nav__empty">Sem áreas para essa pesquisa.</p>}
          </nav>
        </aside>

        <section className="portal-content">
          <header className="portal-header">
            <div className="portal-header__meta">
              <p className="portal-breadcrumb">Portal / {roleLabels[userRole]} / {currentMenu?.label || 'Início'}</p>
              <h2>{currentMenu?.label || 'Início'}</h2>
            </div>

            <div className="portal-header__actions">
              <span className="portal-header__chip">{globalInfoLabel}</span>
              <button
                className={`icon-button icon-button--header${unreadNotifications > 0 ? ' has-unread' : ''}${location.pathname === '/notifications' ? ' is-active' : ''}`}
                type="button"
                onClick={() => navigate('/notifications')}
                aria-label="Notificações"
                title="Notificações"
              >
                <span aria-hidden="true">🔔</span>
                {unreadNotifications > 0 && <span className="icon-badge">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
              </button>
              <button
                className={`icon-button icon-button--header${location.pathname === '/perfil' ? ' is-active' : ''}`}
                type="button"
                onClick={() => navigate(isTPeople ? '/colaboradores' : '/perfil')}
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
  );
}
