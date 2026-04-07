import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';

type FilterMode = 'all' | 'unread' | 'read';

function buildFriendlyMessage(title: string, message: string) {
  const normalized = `${title} ${message}`.toLowerCase();

  if (normalized.includes('férias') && normalized.includes('aprov')) {
    return {
      title: 'Pedido de férias aprovado',
      message: 'O pedido foi validado pelo RH. Já pode avançar com o planeamento da equipa.',
      tag: 'Férias',
    };
  }

  if (normalized.includes('férias') && normalized.includes('recus')) {
    return {
      title: 'Pedido de férias recusado',
      message: 'O pedido foi recusado. Consulte o motivo e ajuste as datas para nova submissão.',
      tag: 'Férias',
    };
  }

  if (normalized.includes('ficha') && normalized.includes('aprov')) {
    return {
      title: 'Pedido de atualização aprovado',
      message: 'As alterações da ficha foram aprovadas e já se encontram em processamento.',
      tag: 'Ficha',
    };
  }

  if (normalized.includes('ficha') && normalized.includes('recus')) {
    return {
      title: 'Pedido de atualização recusado',
      message: 'Foi necessário recusar o pedido. Reveja os dados e submeta novamente.',
      tag: 'Ficha',
    };
  }

  if (normalized.includes('formação') && normalized.includes('atribu')) {
    return {
      title: 'Nova formação atribuída',
      message: 'Tem uma nova formação atribuída. Consulte os detalhes e planeie a conclusão.',
      tag: 'Formação',
    };
  }

  if (normalized.includes('formação') && normalized.includes('conclu')) {
    return {
      title: 'Formação concluída',
      message: 'A conclusão foi registada com sucesso e enviada para acompanhamento do RH.',
      tag: 'Formação',
    };
  }

  return {
    title: title || 'Atualização interna',
    message: message || 'Tem uma nova atualização no portal.',
    tag: 'Portal',
  };
}

function formatRelativeDate(dateText: string) {
  const value = new Date(dateText).getTime();
  const diffMs = Date.now() - value;

  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return new Date(dateText).toLocaleString('pt-PT');
  }

  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} dia${days === 1 ? '' : 's'}`;

  return new Date(dateText).toLocaleDateString('pt-PT');
}

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
      ? `${unreadNotifications} ${unreadNotifications === 1 ? 'alerta por tratar' : 'alertas por tratar'} na sua caixa interna.`
      : 'Tudo tratado. Não existem alertas pendentes.';

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
            <span>Eventos</span>
            <strong>{notifications.length}</strong>
          </div>
          <div>
            <span>Pendentes</span>
            <strong>{unreadNotifications}</strong>
          </div>
          <div>
            <span>Concluídos</span>
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
            Marcar tudo como tratado
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

        {visibleNotifications.map((notification) => {
          const friendly = buildFriendlyMessage(notification.title, notification.message);

          return (
            <article key={notification.id} className={`notification-card${notification.isRead ? '' : ' is-unread'}`}>
              <div className="notification-card__leading" aria-hidden="true">
                {notification.isRead ? '✓' : '•'}
              </div>

              <div className="notification-card__main">
                <span className="notification-card__tag">{friendly.tag}</span>
                <div className="notification-card__meta">
                  <span>{formatRelativeDate(notification.createdAt)}</span>
                  <strong>{notification.isRead ? 'Tratada' : 'Nova'}</strong>
                </div>
                <h3>{friendly.title}</h3>
                <p>{friendly.message}</p>
              </div>

              <div className="notification-card__actions">
                {!notification.isRead && (
                  <button type="button" onClick={() => void markNotificationRead(notification.id)}>
                    Marcar como tratada
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
