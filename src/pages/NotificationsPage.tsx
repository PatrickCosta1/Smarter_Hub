import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';
import { clearApiCache } from '../portal/api';
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
  highlights?: string[];
  detailRows?: Array<{ label: string; value: string }>;
  description?: string;
  tag: string;
  icon: string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange';
  action?: NotificationAction;
  minimalApprovalLayout?: boolean;
  profileChange?: {
    requesterName: string;
    changes: Array<{ field: string; oldValue: string; newValue: string }>;
  };
};

function parseStructuredNotificationMessage(message: string) {
  const lines = humanizeTechnicalText(message)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLine = lines[0] || '';
  const periodLine = lines.find((line) => /^período:/i.test(line)) || '';
  const teamLine = lines.find((line) => /^equipa:/i.test(line)) || '';
  const actionLine = lines.find((line) => /^ação:/i.test(line)) || '';
  const reasonLine = lines.find((line) => /^motivo:/i.test(line)) || '';
  const progressLine = lines.find((line) => /^progresso:/i.test(line)) || '';

  return {
    lines,
    firstLine,
    periodLine,
    teamLine,
    actionLine,
    reasonLine,
    progressLine,
  };
}

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
  categoriaProfissional: 'Categoria profissional',
  funcao: 'Função',
  nacionalidade: 'Nacionalidade',
  validadeCartaoCidadao: 'Validade do cartão de cidadão',
  githubUser: 'GitHub',
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
  const structured = parseStructuredNotificationMessage(message);
  const profileChange = parseProfileChangeNotification(message);

  if (normalized.includes('parcialmente rejeitado')) {
    const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
    const approvedLines: string[] = [];
    const rejectedLines: string[] = [];
    let section: 'none' | 'approved' | 'rejected' = 'none';
    for (const line of lines) {
      if (/campos aprovados/i.test(line)) { section = 'approved'; continue; }
      if (/campos recusados/i.test(line)) { section = 'rejected'; continue; }
      if (/^decisor:/i.test(line) || /^ação:/i.test(line)) { section = 'none'; continue; }
      if (section === 'approved' && line.startsWith('✓')) approvedLines.push(line.replace(/^✓\s*/, ''));
      if (section === 'rejected' && line.startsWith('✗')) rejectedLines.push(line.replace(/^✗\s*/, ''));
    }
    const summaryMsg = approvedLines.length > 0 && rejectedLines.length > 0
      ? `${approvedLines.length} campo(s) aceite(s), ${rejectedLines.length} campo(s) recusado(s).`
      : rejectedLines.length > 0
        ? `${rejectedLines.length} campo(s) recusado(s).`
        : 'Alguns campos foram aceites, outros recusados.';
    const highlights: string[] = [];
    if (approvedLines.length > 0) highlights.push(`Aceites: ${approvedLines.join(', ')}`);
    rejectedLines.forEach((r) => highlights.push(`Recusado - ${r}`));
    return {
      title: 'Pedido parcialmente rejeitado',
      message: summaryMsg,
      highlights,
      tag: 'Ficha',
      icon: '⚠️',
      color: 'orange',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('pedido de alteração de ficha') && (normalized.includes('submeteu') || normalized.includes('efetuou') || normalized.includes('pedido pendente'))) {
    return {
      title: 'Pedido de alteração',
      message: `${profileChange.requesterName} solicitou ${profileChange.changes.length} alteração${profileChange.changes.length === 1 ? '' : 's'}.`,
      tag: 'Ficha',
      icon: '📋',
      color: 'blue',
      action: { label: 'Abrir aprovação', path: '/aprovacoes?tab=profiles' },
      minimalApprovalLayout: true,
      profileChange,
    };
  }

  if (normalized.includes('pedido de alteração submetido')) {
    return {
      title: 'Pedido submetido',
      message: 'O pedido foi enviado para aprovação.',
      highlights: ['Estado: em validação', 'Próximo passo: aguardar decisão dos aprovadores'],
      tag: 'Ficha',
      icon: '✅',
      color: 'green',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('ficha') && normalized.includes('aprov')) {
    return {
      title: 'Ficha aprovada',
      message: 'A ficha já foi atualizada.',
      highlights: [structured.actionLine || 'Estado: concluído'],
      tag: 'Ficha',
      icon: '✨',
      color: 'green',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('ficha') && normalized.includes('recus')) {
    return {
      title: 'Ficha recusada',
      message: 'O pedido foi recusado. Revise as observações.',
      highlights: [structured.reasonLine || 'Motivo disponível no detalhe do pedido'],
      tag: 'Ficha',
      icon: '⚠️',
      color: 'red',
      action: { label: 'Abrir a minha ficha', path: '/profile' },
    };
  }

  if (normalized.includes('novo pedido de férias') || normalized.includes('novo pedido de ausência')) {
    return {
      title: normalized.includes('férias') ? 'Pedido de férias' : 'Pedido de ausência',
      message: structured.firstLine || 'Novo pedido recebido para decisão.',
      highlights: [
        structured.periodLine,
        structured.teamLine,
        structured.actionLine || 'Ação: abrir aprovações para decidir',
      ].filter(Boolean),
      tag: 'Férias',
      icon: '🏖️',
      color: 'yellow',
      action: { label: 'Abrir aprovação', path: '/aprovacoes?tab=vacations' },
      minimalApprovalLayout: true,
    };
  }

  if (normalized.includes('férias') && normalized.includes('aprov')) {
    return {
      title: 'Pedido de férias aprovado',
      message: structured.firstLine || 'O pedido de férias foi aprovado.',
      highlights: [structured.periodLine, structured.actionLine || 'Saldo atualizado automaticamente.'].filter(Boolean),
      tag: 'Férias',
      icon: '🎉',
      color: 'green',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if (normalized.includes('férias') && normalized.includes('recus')) {
    return {
      title: 'Pedido de férias recusado',
      message: structured.firstLine || 'O pedido de férias foi recusado.',
      highlights: [structured.periodLine, structured.reasonLine].filter(Boolean),
      tag: 'Férias',
      icon: '❌',
      color: 'red',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if ((normalized.includes('pedido de ausência') || normalized.includes('ausência')) && normalized.includes('aprov')) {
    return {
      title: 'Pedido de ausência aprovado',
      message: structured.firstLine || 'A ausência foi aprovada.',
      highlights: [structured.periodLine, structured.actionLine].filter(Boolean),
      tag: 'Ausências',
      icon: '✅',
      color: 'green',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if ((normalized.includes('pedido de ausência') || normalized.includes('ausência')) && normalized.includes('recus')) {
    return {
      title: 'Pedido de ausência recusado',
      message: structured.firstLine || 'A ausência foi recusada.',
      highlights: [structured.periodLine, structured.reasonLine].filter(Boolean),
      tag: 'Ausências',
      icon: '⚠️',
      color: 'red',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if (normalized.includes('em aprovação') && (normalized.includes('férias') || normalized.includes('ausência'))) {
    return {
      title: 'Pedido em aprovação',
      message: structured.firstLine || 'O pedido avançou no fluxo de aprovação.',
      highlights: [structured.progressLine, structured.periodLine, structured.teamLine].filter(Boolean),
      tag: 'Aprovação',
      icon: '⏳',
      color: 'blue',
      action: { label: 'Abrir férias', path: '/ferias' },
    };
  }

  if (normalized.includes('formação') && normalized.includes('atribu')) {
    return {
      title: 'Nova formação atribuída',
      message: 'Foi-te atribuída uma nova formação.',
      tag: 'Formação',
      icon: '📚',
      color: 'purple',
      action: { label: 'Abrir formações', path: '/formacoes' },
    };
  }

  if (normalized.includes('formação') && normalized.includes('conclu')) {
    return {
      title: 'Formação concluída',
      message: 'A conclusão foi registada com sucesso.',
      tag: 'Formação',
      icon: '🏆',
      color: 'green',
      action: { label: 'Abrir formações', path: '/formacoes' },
    };
  }

  if (normalized.includes('relatório semanal banco de horas')) {
    const pdfLine = structured.lines.find((line) => /^relatório pdf:/i.test(line));
    return {
      title: 'Relatório semanal do banco de horas',
      message: structured.periodLine || 'Novo relatório semanal disponível.',
      highlights: [
        ...structured.lines.filter((line) => /analisados|positivos|negativos|excedente/i.test(line)),
        ...(pdfLine ? [pdfLine] : []),
      ],
      tag: 'Banco de Horas',
      icon: '🧾',
      color: 'blue',
      action: { label: 'Abrir banco de horas', path: '/banco-horas' },
    };
  }

  if (normalized.includes('medicina do trabalho') || normalized.includes('consulta de saúde')) {
    return {
      title: 'Consulta de medicina do trabalho',
      message: structured.firstLine || 'Em breve vais receber informações sobre a tua consulta.',
      highlights: structured.lines.filter((line) => /periodicidade|br|pt|rh/i.test(line)),
      tag: 'Saúde Ocupacional',
      icon: '🩺',
      color: 'blue',
      action: { label: 'Abrir banco de horas', path: '/banco-horas' },
    };
  }

  if (normalized.includes('novo pedido de admissão') || normalized.includes('submeteu a ficha de admissão')) {
    const countryLine = structured.lines.find((l) => /^país:/i.test(l)) ?? '';
    const emailLine = structured.lines.find((l) => /^email pessoal:/i.test(l)) ?? '';
    return {
      title: 'Nova ficha de admissão',
      message: structured.firstLine || 'Um colaborador submeteu a ficha para revisão.',
      highlights: [countryLine, emailLine].filter(Boolean),
      tag: 'Admissões',
      icon: '🧑‍💼',
      color: 'blue',
      action: { label: 'Ver admissões', path: '/admissoes' },
    };
  }

  if (normalized.includes('reclama') || normalized.includes('reclame aqui') || normalized.includes('reclamação') || normalized.includes('reclamações')) {
    const reporterLine = structured.lines.find((l) => /^colaborador:/i.test(l)) ?? '';
    const countryLine = structured.lines.find((l) => /^país:/i.test(l)) ?? '';
    const subjectLine = structured.lines.find((l) => /^assunto:/i.test(l)) ?? '';
    const contactLine = structured.lines.find((l) => /^contacto preferencial:/i.test(l)) ?? '';
    const descriptionIndex = structured.lines.findIndex((l) => /^descrição:/i.test(l));
    const descriptionLines: string[] = [];

    if (descriptionIndex >= 0) {
      for (let i = descriptionIndex + 1; i < structured.lines.length; i += 1) {
        const line = structured.lines[i];
        if (/^─+$/.test(line)) {
          continue;
        }
        descriptionLines.push(line);
      }
    }

    const cleanedReporter = reporterLine.replace(/^colaborador:\s*/i, '') || 'Não informado';
    const cleanedSubject = subjectLine.replace(/^assunto:\s*/i, '') || 'Não informado';
    const cleanedCountry = countryLine.replace(/^país:\s*/i, '') || 'Não informado';
    const cleanedContact = contactLine.replace(/^contacto preferencial:\s*/i, '') || 'Não indicado';
    const description = descriptionLines.join(' ') || 'Sem descrição detalhada.';

    return {
      title: 'Reclamação recebida',
      message: `${cleanedReporter} — ${cleanedSubject}`,
      tag: 'Saúde e Bem-estar',
      icon: '📩',
      color: 'red',
      detailRows: [
        { label: 'Colaborador', value: cleanedReporter },
        { label: 'Assunto', value: cleanedSubject },
        { label: 'País', value: cleanedCountry },
        { label: 'Contacto preferencial', value: cleanedContact },
      ],
      description,
    };
  }

  if (normalized.includes('admissão pronta para contrato') || (normalized.includes('dados pessoais') && normalized.includes('foram aprovados'))) {
    return {
      title: 'Admissão pronta para contrato',
      message: structured.firstLine || 'Os dados pessoais foram aprovados. Preenche o contrato para criar o utilizador.',
      highlights: [structured.lines.find((l) => /passo seguinte/i.test(l)) ?? ''].filter(Boolean),
      tag: 'Admissões',
      icon: '📝',
      color: 'purple',
      action: { label: 'Ver admissões', path: '/admissoes' },
    };
  }

  return {
    title: title || 'Atualização interna',
    message: structured.firstLine || message || 'Tem uma nova atualização no portal.',
    tag: 'Portal',
    icon: '🔔',
    color: 'blue',
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
  const { notifications, markAllNotificationsRead, markNotificationRead, deleteNotification, deleteAllNotifications, unreadNotifications, refreshNotifications } = usePortal();
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

  const notificationToDeleteItem = useMemo(
    () => notifications.find((item) => item.id === notificationToDelete) || null,
    [notificationToDelete, notifications],
  );

  useEffect(() => {
    clearApiCache('/notifications/me');
    void refreshNotifications();
  }, [refreshNotifications]);

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
          <p className="hero-kicker">Central de notificações</p>
          <h2>Notificações</h2>
          <p className="notifications-subtitle">{headlineText}</p>
          <div className="notifications-hero__meta">
            <span>Última atualização dinâmica</span>
            <span>{filterMode === 'all' ? 'Filtro atual: todas' : filterMode === 'unread' ? 'Filtro atual: por ler' : 'Filtro atual: lidas'}</span>
          </div>
          <div className="notifications-hero__chips">
            <span>{unreadNotifications > 0 ? 'Existem ações pendentes' : 'Tudo em dia'}</span>
            <span>{notifications.length > 0 ? `${notifications.length} registo(s) no histórico` : 'Sem histórico recente'}</span>
          </div>
        </div>

        <div className="notifications-stats">
          <div className="notifications-stat notifications-stat--unread">
            <span>Por ler</span>
            <strong>{unreadNotifications}</strong>
          </div>
          <div className="notifications-stat">
            <span>Total</span>
            <strong>{notifications.length}</strong>
          </div>
          <div className="notifications-stat">
            <span>Lidas</span>
            <strong>{readCount}</strong>
          </div>
          <button
            type="button"
            className="notifications-hero__quick-filter"
            onClick={() => setFilterMode(unreadNotifications > 0 ? 'unread' : 'all')}
          >
            {unreadNotifications > 0 ? 'Ver apenas por ler' : 'Ver todas'}
          </button>
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
            <article key={notification.id} className={`notification-card notification-card--${details.color}${notification.isRead ? '' : ' is-unread'}`}>
              <div className="notification-card__icon" aria-hidden="true">
                {details.icon}
              </div>

              <div className="notification-card__body">
                <div className="notification-card__top">
                  <h3 className="notification-card__title">{details.title}</h3>
                  <span className="notification-card__time">{formatRelativeDate(notification.createdAt)}</span>
                </div>

                <p className="notification-card__message">{details.message}</p>

                {details.highlights && details.highlights.length > 0 && (
                  <ul className="notification-card__facts" aria-label="Informação relevante da notificação">
                    {details.highlights.map((line) => (
                      <li key={`${notification.id}-${line}`}>{line}</li>
                    ))}
                  </ul>
                )}

                <div className="notification-card__footer">
                  <span className="notification-card__tag">{details.tag}</span>
                  {!notification.isRead && <span className="notification-card__dot" aria-label="Por ler" />}

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
                            navigate(details.action!.path);
                            if (!notification.isRead) void markNotificationRead(notification.id);
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
                </div>
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
          <div className={`notification-detail notification-detail--${selectedDetails.color}`}>
            <div className="notification-detail__header">
              <div className="notification-detail__icon">{selectedDetails.icon}</div>
              <div>
                <h2>{selectedDetails.title}</h2>
                <Badge tone={selectedNotification.isRead ? 'neutral' : 'info'}>{selectedNotification.isRead ? 'Lida' : 'Nova'}</Badge>
              </div>
            </div>

            {selectedDetails.minimalApprovalLayout ? (
              <>
                {selectedDetails.profileChange ? (
                  <div className="notification-detail__approval">
                    <div className="notification-detail__requester">
                      <strong>{selectedDetails.profileChange.requesterName}</strong>
                      <span>solicitou {selectedDetails.profileChange.changes.length} alteração{selectedDetails.profileChange.changes.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="notification-diff-list" aria-label="Detalhe de alterações da ficha">
                      {selectedDetails.profileChange.changes.map((item) => (
                        <article key={`${item.field}-${item.oldValue}-${item.newValue}`} className="notification-diff-item">
                          <h4>{item.field}</h4>
                          <div className="notification-diff-row">
                            <div>
                              <span>Anterior</span>
                              <strong>{item.oldValue}</strong>
                            </div>
                            <div className="notification-diff-arrow">→</div>
                            <div>
                              <span>Novo</span>
                              <strong>{item.newValue}</strong>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="notification-detail__summary">{selectedDetails.message}</p>
                )}
                {selectedDetails.action && (
                  <Button type="button" variant="primary" onClick={() => {
                    navigate(selectedDetails.action!.path);
                    closeNotificationDetails();
                  }} style={{ width: '100%' }}>
                    {selectedDetails.action.label}
                  </Button>
                )}
              </>
            ) : (
              <>

                {selectedDetails.detailRows && selectedDetails.detailRows.length > 0 && (
                  <div className="notification-detail__panel notification-detail__panel--structured">
                    <strong>Dados da reclamação</strong>
                    <div className="notification-detail__grid">
                      {selectedDetails.detailRows.map((item) => (
                        <div key={`detail-${item.label}`} className="notification-detail__field">
                          <strong><span className="notification-detail__field-label">{item.label}: </span></strong>
                          <span className="notification-detail__field-value">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedDetails.description && (
                  <div className="notification-detail__panel notification-detail__panel--description">
                    <strong>Descrição</strong>
                    <p>{selectedDetails.description}</p>
                  </div>
                )}

                {selectedDetails.action && (
                  <div className="notification-detail__panel notification-detail__panel--action">
                    <strong>Ação sugerida</strong>
                    <p>Há uma ação direta associada a esta notificação.</p>
                    <Button type="button" variant="primary" onClick={() => {
                      navigate(selectedDetails.action!.path);
                      closeNotificationDetails();
                    }} style={{ width: '100%' }}>
                      {selectedDetails.action.label}
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
          </div>
        )}
      </Modal>

      <div className="notifications-toast" aria-live="polite">
        <Toast show={toast.visible} tone={toast.tone} message={toast.message} />
      </div>
    </section>
  );
}
