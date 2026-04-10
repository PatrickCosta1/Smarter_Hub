import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';
import { MICROCOPY, resolveErrorMessage } from '../portal/microcopy';
import { useFeedbackToast } from '../portal/useFeedbackToast';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';
import Toast from '../components/ui/Toast';

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
  minimalApprovalLayout?: boolean;
  profileChange?: {
    requesterName: string;
    changes: Array<{ field: string; oldValue: string; newValue: string }>;
  };
};

function buildFriendlyMessage(title: string, message: string) {
  const normalized = `${title} ${message}`.toLowerCase();

  if (normalized.includes('férias') && normalized.includes('aprov')) {
    return {
      title: 'Pedido aprovado',
      message: 'O pedido foi validado.',
      tag: 'Férias',
    };
  }

  if (normalized.includes('férias') && normalized.includes('recus')) {
    return {
      title: 'Pedido recusado',
      message: 'O pedido foi recusado.',
      tag: 'Férias',
    };
  }

  if (normalized.includes('ficha') && normalized.includes('aprov')) {
    return {
      title: 'Ficha aprovada',
      message: 'A atualização foi concluída.',
      tag: 'Ficha',
    };
  }

  if (normalized.includes('ficha') && normalized.includes('recus')) {
    return {
      title: 'Ficha recusada',
      message: 'O pedido foi recusado.',
      tag: 'Ficha',
    };
  }

  if (normalized.includes('pedido de alteração submetido')) {
    return {
      title: 'Pedido submetido',
      message: 'O pedido foi enviado para validação.',
      tag: 'Ficha',
    };
  }

  if (normalized.includes('formação') && normalized.includes('atribu')) {
    return {
      title: 'Nova formação atribuída',
      message: 'Foi atribuída uma nova formação.',
      tag: 'Formação',
    };
  }

  if (normalized.includes('formação') && normalized.includes('conclu')) {
    return {
      title: 'Formação concluída',
      message: 'A conclusão foi registada.',
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

function parseProfileChangeNotification(message: string) {
  const normalized = humanizeTechnicalText(message);
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const header = lines[0] || '';
  const marker = ' efetuou um pedido de alteração de ficha';
  const markerIndex = header.toLowerCase().indexOf(marker);
  const requesterName = markerIndex > 0 ? header.slice(0, markerIndex).trim() : 'Colaborador';

  const changes = lines
    .slice(1)
    .map((line) => {
      const match = line.match(/^[-•]\s*(.+?):\s*(.*?)\s*->\s*(.*)$/);
      if (!match) {
        return null;
      }

      return {
        field: match[1].trim(),
        oldValue: match[2].trim(),
        newValue: match[3].trim(),
      };
    })
    .filter((item): item is { field: string; oldValue: string; newValue: string } => Boolean(item));

  return { requesterName, changes };
}

function buildNotificationDetails(title: string, message: string): NotificationDetails {
  const normalized = `${title} ${message}`.toLowerCase();
  const profileChange = parseProfileChangeNotification(message);

  if (normalized.includes('pedido de alteração de ficha') && (normalized.includes('submeteu') || normalized.includes('efetuou') || normalized.includes('pedido pendente'))) {
    return {
      title: 'Pedido de alteração',
      message: `${profileChange.requesterName} solicitou ${profileChange.changes.length} campo${profileChange.changes.length === 1 ? '' : 's'}.`,
      tag: 'Ficha',
      action: { label: 'Abrir aprovação', path: '/aprovacoes' },
      minimalApprovalLayout: true,
      profileChange,
    };
  }

  if (normalized.includes('pedido de alteração submetido')) {
    return {
      title: 'Pedido submetido',
      message: 'O pedido foi enviado para aprovação.',
      tag: 'Ficha',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('ficha') && normalized.includes('aprov')) {
    return {
      title: 'Ficha aprovada',
      message: 'A ficha já foi atualizada.',
      tag: 'Ficha',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('ficha') && normalized.includes('recus')) {
    return {
      title: 'Ficha recusada',
      message: 'O pedido foi recusado.',
      tag: 'Ficha',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('novo pedido de férias') || normalized.includes('novo pedido de ausência')) {
    return {
      title: normalized.includes('férias') ? 'Pedido de férias' : 'Pedido de ausência',
      message: humanizeTechnicalText(message),
      tag: 'Férias',
      action: { label: 'Abrir aprovação', path: '/aprovacoes' },
      minimalApprovalLayout: true,
    };
  }

  if (normalized.includes('férias') && normalized.includes('aprov')) {
    return {
      title: 'Pedido aprovado',
      message: 'O pedido foi aprovado.',
      tag: 'Férias',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if (normalized.includes('férias') && normalized.includes('recus')) {
    return {
      title: 'Pedido recusado',
      message: 'O pedido foi recusado.',
      tag: 'Férias',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if (normalized.includes('formação') && normalized.includes('atribu')) {
    return {
      title: 'Nova formação atribuída',
      message: 'Foi atribuída uma nova formação.',
      tag: 'Formação',
      action: { label: 'Abrir formações', path: '/formacoes' },
    };
  }

  if (normalized.includes('formação') && normalized.includes('conclu')) {
    return {
      title: 'Formação concluída',
      message: 'A conclusão foi registada.',
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
  const { notifications, markAllNotificationsRead, markNotificationRead, deleteNotification, deleteAllNotifications, unreadNotifications } = usePortal();
  const navigate = useNavigate();
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
  const [notificationToDelete, setNotificationToDelete] = useState<string | null>(null);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const { toast, showToast } = useFeedbackToast();

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
      ? `${unreadNotifications} ${unreadNotifications === 1 ? 'notificação por ler' : 'notificações por ler'}.`
      : 'Sem notificações por ler.';

  const selectedNotification = useMemo(
    () => notifications.find((item) => item.id === selectedNotificationId) || null,
    [notifications, selectedNotificationId],
  );

  async function runNotificationAction(actionKey: string, successMessage: string, fallbackErrorMessage: string, action: () => Promise<void>) {
    setPendingActionKey(actionKey);

    try {
      await action();
      showToast('success', successMessage);
      return true;
    } catch (error) {
      showToast('error', resolveErrorMessage(error, fallbackErrorMessage));
      return false;
    } finally {
      setPendingActionKey(null);
    }
  }

  const selectedDetails = useMemo(
    () => selectedNotification ? buildNotificationDetails(selectedNotification.title, selectedNotification.message) : null,
    [selectedNotification],
  );
  const selectedAction = selectedDetails?.action;

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

  function openDeleteAll() {
    setConfirmDeleteAllOpen(true);
  }

  function closeDeleteAll() {
    setConfirmDeleteAllOpen(false);
  }

  return (
    <section className="notifications-shell">
      <header className="notifications-hero">
        <div className="notifications-title-wrap">
          <p className="hero-kicker">Central executiva</p>
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
          <Button
            variant="secondary"
            type="button"
            isLoading={pendingActionKey === 'mark-all-notifications'}
            disabled={Boolean(pendingActionKey)}
            onClick={() => void runNotificationAction('mark-all-notifications', MICROCOPY.notifications.markAllReadSuccess, MICROCOPY.notifications.markAllReadError, async () => {
              await markAllNotificationsRead();
            })}
          >
            Marcar tudo como lido
          </Button>
          <Button variant="danger" type="button" onClick={openDeleteAll} disabled={notifications.length === 0 || Boolean(pendingActionKey)}>Apagar tudo</Button>
        </div>
      </div>

      <div className="notifications-list">
        {visibleNotifications.length === 0 && (
          <EmptyState
            title="Sem notificações para si."
            message="Quando houver novidades, elas aparecem aqui automaticamente."
          />
        )}

        {visibleNotifications.map((notification) => {
          const friendly = buildFriendlyMessage(humanizeTechnicalText(notification.title), humanizeTechnicalText(notification.message));
          const details = buildNotificationDetails(notification.title, notification.message);
          const isMinimalApproval = Boolean(details.minimalApprovalLayout && details.action);

          return (
            <article key={notification.id} className={`notification-card${notification.isRead ? '' : ' is-unread'}`}>
              <div className="notification-card__leading" aria-hidden="true">
                {notification.isRead ? '✓' : '•'}
              </div>

              <div className="notification-card__main">
                <span className="notification-card__tag">{friendly.tag}</span>
                <div className="notification-card__meta">
                  <span>{formatRelativeDate(notification.createdAt)}</span>
                  <Badge tone={notification.isRead ? 'neutral' : 'info'}>{notification.isRead ? 'Lida' : 'Nova'}</Badge>
                </div>
                <h3>{friendly.title}</h3>
                <p>{isMinimalApproval ? details.message : friendly.message}</p>
              </div>

              <div className="notification-card__actions">
                {isMinimalApproval ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      type="button"
                      isLoading={pendingActionKey === `mark-notification-${notification.id}`}
                      disabled={Boolean(pendingActionKey)}
                      onClick={() => {
                        if (notification.isRead) {
                          navigate(details.action!.path);
                          return;
                        }

                        void runNotificationAction(`mark-notification-${notification.id}`, MICROCOPY.notifications.markReadSuccess, MICROCOPY.notifications.markReadError, async () => {
                          await markNotificationRead(notification.id);
                          navigate(details.action!.path);
                        });
                      }}
                    >
                      {details.action!.label}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      isLoading={pendingActionKey === `delete-notification-${notification.id}`}
                      disabled={Boolean(pendingActionKey)}
                      onClick={() => openDeleteNotification(notification.id)}
                    >
                      Apagar
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" type="button" onClick={() => openNotification(notification.id)}>Abrir</Button>
                    {!notification.isRead && (
                      <Button
                        size="sm"
                        variant="secondary"
                        type="button"
                        isLoading={pendingActionKey === `mark-notification-${notification.id}`}
                        disabled={Boolean(pendingActionKey)}
                        onClick={() => void runNotificationAction(`mark-notification-${notification.id}`, MICROCOPY.notifications.markReadSuccess, MICROCOPY.notifications.markReadError, async () => {
                          await markNotificationRead(notification.id);
                        })}
                      >
                        Marcar como lida
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      isLoading={pendingActionKey === `delete-notification-${notification.id}`}
                      disabled={Boolean(pendingActionKey)}
                      onClick={() => openDeleteNotification(notification.id)}
                    >
                      Apagar
                    </Button>
                  </>
                )}
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
          <div className="modal-footer-split">
            <div className="modal-footer-meta">
              <strong className="modal-footer-tag">{selectedDetails?.tag}</strong>
              <span className="modal-footer-note">{formatRelativeDate(selectedNotification.createdAt)}</span>
            </div>
            <div className="modal-footer-actions">
              {!selectedNotification.isRead && (
                <Button
                  type="button"
                  variant="secondary"
                  isLoading={pendingActionKey === `mark-notification-${selectedNotification.id}`}
                  disabled={Boolean(pendingActionKey)}
                  onClick={async () => {
                    const succeeded = await runNotificationAction(`mark-notification-${selectedNotification.id}`, MICROCOPY.notifications.markReadSuccess, MICROCOPY.notifications.markReadError, async () => {
                      await markNotificationRead(selectedNotification.id);
                    });

                    if (succeeded) {
                      closeNotificationDetails();
                    }
                  }}
                >
                  Marcar como lida
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={closeNotificationDetails}>Fechar</Button>
            </div>
          </div>
        ) : undefined}
      >
        {selectedNotification && selectedDetails && (
          <div className="notification-detail">
            {selectedDetails.minimalApprovalLayout ? (
              <>
                {selectedDetails.profileChange ? (
                  <div className="notification-detail__panel notification-detail__panel--focus">
                    <strong>{selectedDetails.profileChange.requesterName}</strong>
                    <p className="notification-detail__summary notification-detail__summary--focus">Pedido de alteração</p>
                    <div className="notification-diff-list" aria-label="Detalhe de alterações da ficha">
                      {selectedDetails.profileChange.changes.map((item) => (
                        <article key={`${item.field}-${item.oldValue}-${item.newValue}`} className="notification-diff-item">
                          <h4>{item.field}</h4>
                          <div>
                            <span>Antes</span>
                            <strong>{item.oldValue}</strong>
                          </div>
                          <div>
                            <span>Depois</span>
                            <strong>{item.newValue}</strong>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="notification-detail__summary notification-detail__summary--focus">{selectedDetails.message}</p>
                )}
                {selectedAction && (
                  <Button type="button" variant="primary" onClick={() => {
                    navigate(selectedAction.path);
                    closeNotificationDetails();
                  }}>
                    {selectedAction.label}
                  </Button>
                )}
              </>
            ) : (
              <>
            <div className="notification-detail__meta">
              <Badge tone={selectedNotification.isRead ? 'neutral' : 'info'}>{selectedNotification.isRead ? 'Lida' : 'Nova'}</Badge>
              <span>{selectedDetails.tag}</span>
              <span>{formatRelativeDate(selectedNotification.createdAt)}</span>
            </div>

            <p className="notification-detail__summary">{selectedDetails.message}</p>

            <div className="notification-detail__panel">
              <strong>Mensagem original</strong>
              <p>{humanizeTechnicalText(selectedNotification.message)}</p>
            </div>

            {selectedAction && (
              <div className="notification-detail__panel notification-detail__panel--action">
                <strong>Ação sugerida</strong>
                <p>Existe uma ação direta associada a esta notificação.</p>
                <Button type="button" variant="primary" onClick={() => {
                  navigate(selectedAction.path);
                  closeNotificationDetails();
                }}>
                  {selectedAction.label}
                </Button>
              </div>
            )}
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={confirmDeleteAllOpen}
        title="Apagar todas as notificações"
        onClose={closeDeleteAll}
        width="min(560px, 94vw)"
        showCloseButton={false}
        footer={(
          <div className="modal-footer-split">
            <span className="modal-footer-note">Esta ação remove todas as notificações da conta.</span>
            <div className="modal-footer-actions">
              <Button type="button" variant="ghost" onClick={closeDeleteAll}>Cancelar</Button>
              <Button
                type="button"
                variant="danger"
                isLoading={pendingActionKey === 'delete-all-notifications'}
                disabled={Boolean(pendingActionKey)}
                onClick={async () => {
                  const succeeded = await runNotificationAction('delete-all-notifications', MICROCOPY.notifications.deleteAllSuccess, MICROCOPY.notifications.deleteAllError, async () => {
                    await deleteAllNotifications();
                  });

                  if (succeeded) {
                    closeDeleteAll();
                  }
                }}
              >
                Apagar tudo
              </Button>
            </div>
          </div>
        )}
      >
        <div className="notification-detail">
          <p className="notification-detail__summary">Tem a certeza que quer apagar todas as notificações?</p>
          <div className="notification-detail__panel">
            <strong>{notifications.length} notificações</strong>
            <p>Esta operação não pode ser desfeita.</p>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(notificationToDeleteItem)}
        title="Apagar notificação"
        onClose={closeDeleteNotification}
        width="min(560px, 94vw)"
        showCloseButton={false}
        footer={notificationToDeleteItem ? (
          <div className="modal-footer-split">
            <span className="modal-footer-note">Esta ação remove a notificação apenas da tua conta.</span>
            <div className="modal-footer-actions">
              <Button type="button" variant="ghost" onClick={closeDeleteNotification}>Cancelar</Button>
              <Button
                type="button"
                variant="danger"
                isLoading={pendingActionKey === `delete-notification-${notificationToDeleteItem.id}`}
                disabled={Boolean(pendingActionKey)}
                onClick={async () => {
                  const succeeded = await runNotificationAction(`delete-notification-${notificationToDeleteItem.id}`, MICROCOPY.notifications.deleteOneSuccess, MICROCOPY.notifications.deleteOneError, async () => {
                    await deleteNotification(notificationToDeleteItem.id);
                  });

                  if (succeeded) {
                    closeDeleteNotification();
                  }
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

      <div className="notifications-toast" aria-live="polite">
        <Toast show={toast.visible} tone={toast.tone} message={toast.message} />
      </div>
    </section>
  );
}
