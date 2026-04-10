import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';

type FilterMode = 'all' | 'unread' | 'read';

type NotificationAction = {
  label: string;
  path: string;
};

type NotificationDetails = {
  title: string;
  message: string;
  tag: string;
  action?: NotificationAction;
};

function buildFriendlyMessage(title: string, message: string) {
  const normalized = `${title} ${message}`.toLowerCase();

  if (normalized.includes('férias') && normalized.includes('aprov')) {
    return {
      title: 'Pedido de férias aprovado',
      message: 'O pedido foi validado pelo RH.',
      tag: 'Férias',
    };
  }

  if (normalized.includes('férias') && normalized.includes('recus')) {
    return {
      title: 'Pedido de férias recusado',
      message: 'O pedido foi recusado.',
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

  if (normalized.includes('pedido de alteração submetido')) {
    return {
      title: 'Pedido de alteração submetido',
      message: 'O teu pedido de alteração de ficha foi enviado para validação.',
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

const technicalFieldLabels: Record<string, string> = {
  primeiroNome: 'Primeiro nome',
  apelido: 'Apelido',
  nomeAbreviado: 'Nome abreviado',
  habilitacoesLiterarias: 'Habilitações literárias',
  dataInicioContrato: 'Data de início do contrato',
  dataFimContrato: 'Data de fim do contrato',
  tipoContrato: 'Tipo de contrato',
  regimeHorario: 'Regime horário',
  cargo: 'Cargo',
  funcao: 'Função',
  emailPessoal: 'Email pessoal',
  telemovel: 'Telemóvel',
  numeroDependentes: 'Número de dependentes',
  anoPrimeiroDesconto: 'Ano do primeiro desconto',
};

function humanizeTechnicalText(text: string) {
  return Object.entries(technicalFieldLabels).reduce((currentText, [raw, label]) => {
    const matcher = new RegExp(raw, 'g');
    return currentText.replace(matcher, label);
  }, text);
}

function buildNotificationDetails(title: string, message: string): NotificationDetails {
  const normalized = `${title} ${message}`.toLowerCase();

  if (normalized.includes('pedido de alteração de ficha') && (normalized.includes('submeteu') || normalized.includes('pedido pendente'))) {
    return {
      title: 'Novo pedido de alteração de ficha',
      message: 'Existe um pedido pendente de aprovação. Abra a página de aprovações para analisar o pedido.',
      tag: 'Ficha',
      action: { label: 'Ir para aprovações', path: '/aprovacoes' },
    };
  }

  if (normalized.includes('pedido de alteração submetido')) {
    return {
      title: 'Pedido de alteração submetido',
      message: 'O teu pedido foi enviado para aprovação. Pode acompanhar o estado na ficha.',
      tag: 'Ficha',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('ficha') && normalized.includes('aprov')) {
    return {
      title: 'Pedido de alteração aprovado',
      message: 'As alterações da ficha foram aprovadas e a ficha já foi atualizada.',
      tag: 'Ficha',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('ficha') && normalized.includes('recus')) {
    return {
      title: 'Pedido de alteração recusado',
      message: 'O pedido foi recusado. Consulte o motivo e volte a submeter se necessário.',
      tag: 'Ficha',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('novo pedido de férias') || normalized.includes('novo pedido de ausência')) {
    return {
      title: 'Pedido operacional pendente',
      message: 'Existe um pedido novo para validação. Abra a página de aprovações para tratar o fluxo.',
      tag: 'Férias',
      action: { label: 'Ir para aprovações', path: '/aprovacoes' },
    };
  }

  if (normalized.includes('férias') && normalized.includes('aprov')) {
    return {
      title: 'Pedido de férias aprovado',
      message: 'O pedido foi aprovado. Pode consultar o calendário ou continuar o planeamento.',
      tag: 'Férias',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if (normalized.includes('férias') && normalized.includes('recus')) {
    return {
      title: 'Pedido de férias recusado',
      message: 'O pedido foi recusado. Consulte a informação detalhada na área de férias.',
      tag: 'Férias',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if (normalized.includes('formação') && normalized.includes('atribu')) {
    return {
      title: 'Nova formação atribuída',
      message: 'Tem uma nova formação atribuída. Abra a página de formações para ver o detalhe.',
      tag: 'Formação',
      action: { label: 'Abrir formações', path: '/formacoes' },
    };
  }

  if (normalized.includes('formação') && normalized.includes('conclu')) {
    return {
      title: 'Formação concluída',
      message: 'A conclusão da formação foi registada com sucesso.',
      tag: 'Formação',
      action: { label: 'Abrir formações', path: '/formacoes' },
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
  const { notifications, markAllNotificationsRead, markNotificationRead, deleteNotification, unreadNotifications } = usePortal();
  const navigate = useNavigate();
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
  const [notificationToDelete, setNotificationToDelete] = useState<string | null>(null);

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
      ? `${unreadNotifications} ${unreadNotifications === 1 ? 'alerta pendente' : 'alertas pendentes'}.`
      : 'Sem alertas pendentes.';

  const selectedNotification = useMemo(
    () => notifications.find((item) => item.id === selectedNotificationId) || null,
    [notifications, selectedNotificationId],
  );

  const selectedDetails = useMemo(
    () => selectedNotification ? buildNotificationDetails(selectedNotification.title, selectedNotification.message) : null,
    [selectedNotification],
  );

  const notificationToDeleteItem = useMemo(
    () => notifications.find((item) => item.id === notificationToDelete) || null,
    [notificationToDelete, notifications],
  );

  function openNotification(notificationId: string) {
    const notification = notifications.find((item) => item.id === notificationId);
    if (!notification) {
      return;
    }

    setSelectedNotificationId(notificationId);

    if (!notification.isRead) {
      void markNotificationRead(notificationId);
    }
  }

  function closeNotificationDetails() {
    setSelectedNotificationId(null);
  }

  function openDeleteNotification(notificationId: string) {
    setNotificationToDelete(notificationId);
  }

  function closeDeleteNotification() {
    setNotificationToDelete(null);
  }

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
          <button className={`notification-filter${filterMode === 'all' ? ' is-active' : ''}`} role="tab" aria-selected={filterMode === 'all'} type="button" onClick={() => setFilterMode('all')}>
            Todas
          </button>
          <button className={`notification-filter${filterMode === 'unread' ? ' is-active' : ''}`} role="tab" aria-selected={filterMode === 'unread'} type="button" onClick={() => setFilterMode('unread')}>
            Por ler
          </button>
          <button className={`notification-filter${filterMode === 'read' ? ' is-active' : ''}`} role="tab" aria-selected={filterMode === 'read'} type="button" onClick={() => setFilterMode('read')}>
            Lidas
          </button>
        </div>

        <div className="home-actions">
          <Button variant="primary" type="button" onClick={() => void markAllNotificationsRead()}>Marcar tudo como tratado</Button>
        </div>
      </div>

      <div className="notifications-list">
        {visibleNotifications.length === 0 && (
          <article className="notification-card notification-card--empty">
            <h3>Sem notificações neste filtro</h3>
            <p>Sem registos.</p>
          </article>
        )}

        {visibleNotifications.map((notification) => {
          const friendly = buildFriendlyMessage(humanizeTechnicalText(notification.title), humanizeTechnicalText(notification.message));

          return (
            <article key={notification.id} className={`notification-card${notification.isRead ? '' : ' is-unread'}`}>
              <div className="notification-card__leading" aria-hidden="true">
                {notification.isRead ? '✓' : '•'}
              </div>

              <div className="notification-card__main">
                <span className="notification-card__tag">{friendly.tag}</span>
                <div className="notification-card__meta">
                  <span>{formatRelativeDate(notification.createdAt)}</span>
                  <Badge tone={notification.isRead ? 'neutral' : 'info'}>{notification.isRead ? 'Tratada' : 'Nova'}</Badge>
                </div>
                <h3>{friendly.title}</h3>
                <p>{friendly.message}</p>
              </div>

              <div className="notification-card__actions">
                <Button size="sm" variant="secondary" type="button" onClick={() => openNotification(notification.id)}>Ver detalhes</Button>
                {!notification.isRead && (
                  <Button size="sm" variant="secondary" type="button" onClick={() => void markNotificationRead(notification.id)}>Marcar como tratada</Button>
                )}
                <Button size="sm" variant="ghost" type="button" onClick={() => openDeleteNotification(notification.id)}>Apagar</Button>
              </div>
            </article>
          );
        })}
      </div>

      <Modal
        open={Boolean(selectedNotification)}
        title={selectedDetails?.title || 'Detalhe da notificação'}
        onClose={closeNotificationDetails}
        width="min(720px, 94vw)"
        showCloseButton={false}
        footer={selectedNotification ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12 }}>
            <div style={{ display: 'grid', gap: 4 }}>
              <strong style={{ color: 'var(--hub-text-1)' }}>{selectedDetails?.tag}</strong>
              <span style={{ color: 'var(--hub-text-3)', fontSize: '0.9rem' }}>{formatRelativeDate(selectedNotification.createdAt)}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {selectedDetails?.action && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    navigate(selectedDetails.action!.path);
                    closeNotificationDetails();
                  }}
                >
                  {selectedDetails.action.label}
                </Button>
              )}
              {!selectedNotification.isRead && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void markNotificationRead(selectedNotification.id);
                    closeNotificationDetails();
                  }}
                >
                  Marcar como tratada
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={closeNotificationDetails}>Fechar</Button>
            </div>
          </div>
        ) : undefined}
      >
        {selectedNotification && selectedDetails && (
          <div className="notification-detail">
            <div className="notification-detail__meta">
              <Badge tone={selectedNotification.isRead ? 'neutral' : 'info'}>{selectedNotification.isRead ? 'Tratada' : 'Nova'}</Badge>
              <span>{selectedDetails.tag}</span>
              <span>{formatRelativeDate(selectedNotification.createdAt)}</span>
            </div>

            <p className="notification-detail__summary">{selectedDetails.message}</p>

            <div className="notification-detail__panel">
              <strong>Mensagem original</strong>
              <p>{selectedNotification.message}</p>
            </div>

            {selectedDetails.action && (
              <div className="notification-detail__panel notification-detail__panel--action">
                <strong>Ação sugerida</strong>
                <p>Existe uma ação direta associada a esta notificação.</p>
                <Button type="button" variant="primary" onClick={() => {
                  navigate(selectedDetails.action!.path);
                  closeNotificationDetails();
                }}>
                  {selectedDetails.action.label}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(notificationToDeleteItem)}
        title="Apagar notificação"
        onClose={closeDeleteNotification}
        width="min(560px, 94vw)"
        showCloseButton={false}
        footer={notificationToDeleteItem ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12 }}>
            <span style={{ color: 'var(--hub-text-3)', fontSize: '0.9rem' }}>Esta ação remove a notificação apenas da tua conta.</span>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button type="button" variant="ghost" onClick={closeDeleteNotification}>Cancelar</Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  void deleteNotification(notificationToDeleteItem.id);
                  closeDeleteNotification();
                }}
              >
                Apagar notificação
              </Button>
            </div>
          </div>
        ) : undefined}
      >
        {notificationToDeleteItem && (
          <div className="notification-detail">
            <p className="notification-detail__summary">Tem a certeza que quer apagar esta notificação?</p>
            <div className="notification-detail__panel">
              <strong>{humanizeTechnicalText(notificationToDeleteItem.title)}</strong>
              <p>{humanizeTechnicalText(notificationToDeleteItem.message)}</p>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
