import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleLabels, roleMenus } from '../portal/data';
import { usePortal } from '../portal/context';

export default function PortalLayout() {
  const { userRole, unreadNotifications, logout } = usePortal();
  const navigate = useNavigate();
  const location = useLocation();

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

      <section className="app-layout">
        <header className="topbar topbar-portal">
          <div className="topbar-brand">
            <img src="src\public\logo.png" alt="Tlantic" />
            <div>
              <strong>Smarter Hub</strong>
              <span>{roleLabels[userRole]}</span>
            </div>
          </div>

          <nav className="topbar-nav" aria-label="Menu principal">
            {roleMenus[userRole].map((item) => (
              <NavLink key={item.id} className={({ isActive }) => `menu-link${isActive ? ' is-active' : ''}`} to={item.path}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-actions">
            <button
              className={`icon-button${unreadNotifications > 0 ? ' has-unread' : ''}${location.pathname === '/notifications' ? ' is-active' : ''}`}
              type="button"
              onClick={() => navigate('/notifications')}
              aria-label="Notificações"
              title="Notificações"
            >
              <span aria-hidden="true">🔔</span>
              {unreadNotifications > 0 && <span className="icon-badge">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
            </button>
            <button
              className={`icon-button${location.pathname === '/profile' ? ' is-active' : ''}`}
              type="button"
              onClick={() => navigate('/profile')}
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

        <Outlet />
      </section>
    </main>
  );
}
