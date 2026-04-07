import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';

type FilterMode = 'all' | 'unread' | 'read';

export default function NotificationsPage() {
  const { notifications, markAllNotificationsRead, markNotificationRead, unreadNotifications } = usePortal();
  const navigate = useNavigate();
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const sortedNotifications = useMemo(
    () => [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notifications],
  );

  const visibleNotifications = useMemo(() => {
    if (filterMode === 'unread') {
      return sortedNotifications.filter((notification) => !notification.isRead);
    }

    if (filterMode === 'read') {
      return sortedNotifications.filter((notification) => notification.isRead);
    }

    return sortedNotifications;
  }, [filterMode, sortedNotifications]);

  const readCount = notifications.length - unreadNotifications;
  const headlineText =
    unreadNotifications > 0
      ? `Tens ${unreadNotifications} ${unreadNotifications === 1 ? 'notificação por ler' : 'notificações por ler'}.`
      : 'Caixa de entrada limpa.';

  return (
    <section className="notifications-shell">
      <header className="notifications-hero">
        <div className="notifications-title-wrap">
          <p className="hero-kicker">Central de notificações</p>
          <h2>Notificações</h2>
          <p className="notifications-subtitle">{headlineText}</p>
        </div>

        <div className="notifications-stats">
          <div>
            <span>Total</span>
            <strong>{notifications.length}</strong>
          </div>
          <div>
            <span>Por ler</span>
            <strong>{unreadNotifications}</strong>
          </div>
          <div>
            <span>Lidas</span>
            <strong>{readCount}</strong>
          </div>
        </div>
      </header>

      <div className="notifications-toolbar">
        <div className="notifications-filters" role="tablist" aria-label="Filtro de notificações">
          <button className={`notification-filter${filterMode === 'all' ? ' is-active' : ''}`} type="button" onClick={() => setFilterMode('all')}>
            Todas
          </button>
          <button className={`notification-filter${filterMode === 'unread' ? ' is-active' : ''}`} type="button" onClick={() => setFilterMode('unread')}>
            Por ler
          </button>
          <button className={`notification-filter${filterMode === 'read' ? ' is-active' : ''}`} type="button" onClick={() => setFilterMode('read')}>
            Lidas
          </button>
        </div>

        <div className="home-actions">
          <button className="cta-button cta-primary" type="button" onClick={() => void markAllNotificationsRead()}>
            Marcar todas como lidas
          </button>
          <button className="cta-button cta-ghost" type="button" onClick={() => navigate('/')}>
            Voltar à home
          </button>
        </div>
      </div>

      <div className="notifications-list">
        {visibleNotifications.length === 0 && (
          <article className="notification-card notification-card--empty">
            <h3>Sem notificações neste filtro</h3>
            <p>Quando surgirem novas mensagens, vais vê-las aqui automaticamente.</p>
          </article>
        )}

        {visibleNotifications.map((notification) => (
          <article key={notification.id} className={`notification-card${notification.isRead ? '' : ' is-unread'}`}>
            <div className="notification-card__leading" aria-hidden="true">
              {notification.isRead ? '✓' : '•'}
            </div>

            <div className="notification-card__main">
              <div className="notification-card__meta">
                <span>{new Date(notification.createdAt).toLocaleString('pt-PT')}</span>
                <strong>{notification.isRead ? 'Lida' : 'Nova'}</strong>
              </div>
              <h3>{notification.title}</h3>
              <p>{notification.message}</p>
            </div>

            <div className="notification-card__actions">
              {!notification.isRead && (
                <button type="button" onClick={() => void markNotificationRead(notification.id)}>
                  Marcar como lida
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
