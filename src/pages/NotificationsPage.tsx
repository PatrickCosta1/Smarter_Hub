import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';

export default function NotificationsPage() {
  const { markAllNotificationsRead } = usePortal();
  const navigate = useNavigate();

  useEffect(() => {
    markAllNotificationsRead();
  }, [markAllNotificationsRead]);

  return (
    <section className="profile-card profile-card--full">
      <h2>Notificações</h2>
      <p className="home-note">Módulo de notificações preparado. Na próxima etapa ligamos a API e listagem real por perfil.</p>
      <div className="home-actions">
        <button className="cta-button cta-primary" type="button" onClick={markAllNotificationsRead}>
          Marcar todas como lidas
        </button>
        <button className="cta-button cta-ghost" type="button" onClick={() => navigate('/')}>
          Voltar à home
        </button>
      </div>
    </section>
  );
}
