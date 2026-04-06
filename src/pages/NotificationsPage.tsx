import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';

export default function NotificationsPage() {
  const { notifications, markAllNotificationsRead, markNotificationRead } = usePortal();
  const navigate = useNavigate();

  useEffect(() => {
    void markAllNotificationsRead();
  }, [markAllNotificationsRead]);

  return (
    <section className="profile-card profile-card--full">
      <h2>Notificações</h2>
      <p className="home-note">Notificações reais carregadas da API.</p>

      <div className="profile-fields">
        {notifications.length === 0 && <p>Sem notificações por agora.</p>}
        {notifications.map((notification) => (
          <article key={notification.id} className="home-card">
            <p>{new Date(notification.createdAt).toLocaleString('pt-PT')}</p>
            <h3>{notification.title}</h3>
            <small>{notification.message}</small>
            {!notification.isRead && (
              <button type="button" onClick={() => void markNotificationRead(notification.id)}>
                Marcar como lida
              </button>
            )}
          </article>
        ))}
      </div>

      <div className="home-actions">
        <button className="cta-button cta-primary" type="button" onClick={() => void markAllNotificationsRead()}>
          Marcar todas como lidas
        </button>
        <button className="cta-button cta-ghost" type="button" onClick={() => navigate('/')}>
          Voltar à home
        </button>
      </div>
    </section>
  );
}
