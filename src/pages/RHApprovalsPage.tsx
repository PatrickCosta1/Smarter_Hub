import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, getBackendBase } from '../portal/api';
import { usePortal } from '../portal/context';
import { MICROCOPY, resolveErrorMessage } from '../portal/microcopy';
import { formatVacationStatusLabel, getVacationStatusTone } from '../portal/labels';
import Badge from '../components/ui/Badge';
import Skeleton from '../components/ui/Skeleton';
import LoadingInline from '../components/ui/LoadingInline';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Toast from '../components/ui/Toast';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

type ProfileRequest = {
  id: string;
  userId: string;
  requesterName?: string;
  changesSummary: string;
  status: string;
  requestedData: Record<string, string>;
  changeDetails?: Array<{
    field: string;
    oldValue: string;
    newValue: string;
  }>;
  createdAt: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    profile?: {
      nomeAbreviado?: string;
      primeiroNome?: string;
      apelido?: string;
    } | null;
  };
};

type VacationRequest = {
  id: string;
  userId: string;
  dataInicio: string;
  dataFim: string;
  observacoes: string;
  status: string;
  createdAt: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    profile?: {
      nomeAbreviado?: string;
      primeiroNome?: string;
      apelido?: string;
    } | null;
  };
};

function getDisplayName(user?: { username: string; profile?: { nomeAbreviado?: string; primeiroNome?: string; apelido?: string } | null } | null) {
  const shortName = user?.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = `${user?.profile?.primeiroNome ?? ''} ${user?.profile?.apelido ?? ''}`.trim();
  return fullName || user?.username || '-';
}

function formatShortDate(dateText: string) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('pt-PT');
}

function renderApprovalFieldValue(field: string, value: string) {
  const normalizedValue = (value || '').trim();
  if (!normalizedValue || normalizedValue === '(vazio)' || normalizedValue === '-') {
    return <span>(vazio)</span>;
  }

  const isProofField = /comprovativo/i.test(field);
  const isHttp = normalizedValue.startsWith('http://') || normalizedValue.startsWith('https://');
  const isRelativeUpload = normalizedValue.startsWith('/uploads/');

  if (isProofField && (isHttp || isRelativeUpload)) {
    const href = isRelativeUpload ? `${getBackendBase()}${normalizedValue}` : normalizedValue;
    return (
      <a className="approval-file-link" href={href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        Abrir comprovativo
      </a>
    );
  }

  return <span>{normalizedValue}</span>;
}

export default function RHApprovalsPage() {
  const { hasPermission, isRootAccess } = usePortal();
  const [activeTab, setActiveTab] = useState<'profiles' | 'vacations'>('profiles');
  const [profileRequests, setProfileRequests] = useState<ProfileRequest[]>([]);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [selectedProfileRequest, setSelectedProfileRequest] = useState<ProfileRequest | null>(null);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error' | 'info'; message: string; visible: boolean }>({
    tone: 'info',
    message: '',
    visible: false,
  });

  const requestCount = useMemo(() => profileRequests.length + vacationRequests.length, [profileRequests.length, vacationRequests.length]);
  const canReviewProfiles = isRootAccess || hasPermission('approve_profile_change');
  const canReviewVacations = isRootAccess || hasPermission('approve_vacation') || hasPermission('reject_vacation') || hasPermission('view_all_vacations');

  useEffect(() => {
    if (!canReviewProfiles && canReviewVacations) {
      setActiveTab('vacations');
    }
  }, [canReviewProfiles, canReviewVacations]);

  useEffect(() => {
    if (!canReviewProfiles && !canReviewVacations) {
      return;
    }

    void loadData();
  }, [canReviewProfiles, canReviewVacations]);

  useEffect(() => {
    if (!toast.visible) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((current) => ({ ...current, visible: false }));
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [toast.visible]);

  function showToast(tone: 'success' | 'error' | 'info', message: string) {
    setToast({ tone, message, visible: true });
  }

  async function runAction(actionKey: string, successMessage: string, fallbackErrorMessage: string, action: () => Promise<void>) {
    setPendingActionKey(actionKey);
    try {
      await action();
      showToast('success', successMessage);
    } catch (error) {
      showToast('error', resolveErrorMessage(error, fallbackErrorMessage));
    } finally {
      setPendingActionKey(null);
    }
  }

  async function loadData() {
    setIsLoadingData(true);
    try {
      const [profiles, vacations] = await Promise.all([
        canReviewProfiles
          ? apiRequestCached<ProfileRequest[]>('/profile/requests', { headers: getAuthHeaders() }, 45000)
          : Promise.resolve([]),
        canReviewVacations
          ? apiRequestCached<VacationRequest[]>('/vacations/requests', { headers: getAuthHeaders() }, 45000)
          : Promise.resolve([]),
      ]);

      setProfileRequests(profiles);
      setVacationRequests(vacations);
    } catch (error) {
      showToast('error', resolveErrorMessage(error, MICROCOPY.approvals.loadRequestsError));
    } finally {
      setIsLoadingData(false);
    }
  }

  if (!canReviewProfiles && !canReviewVacations) {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta página está disponível apenas para manager, coordenador e admin.</p>
        </article>
      </section>
    );
  }

  async function approveProfileRequest(request: ProfileRequest) {
    await runAction(`approve-profile-${request.id}`, MICROCOPY.approvals.approveProfileSuccess(getDisplayName(request.user)), MICROCOPY.approvals.approveProfileError, async () => {
      await apiRequest(`/profile/requests/${request.id}/approve`, { method: 'POST', headers: getAuthHeaders() });
      clearApiCache('/profile/requests');
      setProfileRequests((current) => current.filter((item) => item.id !== request.id));
      if (selectedProfileRequest?.id === request.id) {
        setSelectedProfileRequest(null);
      }
    });
  }

  async function rejectProfileRequest(request: ProfileRequest) {
    await runAction(`reject-profile-${request.id}`, MICROCOPY.approvals.rejectProfileSuccess(getDisplayName(request.user)), MICROCOPY.approvals.rejectProfileError, async () => {
      await apiRequest(`/profile/requests/${request.id}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: rejectReason }),
      });
      clearApiCache('/profile/requests');
      setProfileRequests((current) => current.filter((item) => item.id !== request.id));
      if (selectedProfileRequest?.id === request.id) {
        setSelectedProfileRequest(null);
      }
    });
  }

  async function approveVacationRequest(request: VacationRequest) {
    await runAction(`approve-vacation-${request.id}`, MICROCOPY.approvals.approveVacationSuccess(getDisplayName(request.user)), MICROCOPY.approvals.approveVacationError, async () => {
      await apiRequest(`/vacations/${request.id}/approve`, { method: 'POST', headers: getAuthHeaders() });
      clearApiCache('/vacations');
      setVacationRequests((current) => current.filter((item) => item.id !== request.id));
    });
  }

  async function rejectVacationRequest(request: VacationRequest) {
    await runAction(`reject-vacation-${request.id}`, MICROCOPY.approvals.rejectVacationSuccess(getDisplayName(request.user)), MICROCOPY.approvals.rejectVacationError, async () => {
      await apiRequest(`/vacations/${request.id}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: rejectReason }),
      });
      clearApiCache('/vacations');
      setVacationRequests((current) => current.filter((item) => item.id !== request.id));
    });
  }

  function openProfileRequestDetails(request: ProfileRequest) {
    setSelectedProfileRequest(request);
  }

  function closeProfileRequestDetails() {
    setSelectedProfileRequest(null);
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Aprovações</p>
          <h2>Aprovações</h2>
          <p>Analisa e decide os pedidos pendentes do teu nível de responsabilidade.</p>
        </div>

        <div className="trainings-hours-summary">
          <article>
            <span>Pedidos em aberto</span>
            <strong>{isLoadingData ? <LoadingInline variant="metric" /> : requestCount}</strong>
          </article>
        </div>
      </header>

      <div className="rh-tabs">
        {canReviewProfiles && (
          <button type="button" className={activeTab === 'profiles' ? 'is-active' : ''} onClick={() => setActiveTab('profiles')}>
            Alterações de ficha ({isLoadingData ? '...' : profileRequests.length})
          </button>
        )}
        {canReviewVacations && (
          <button type="button" className={activeTab === 'vacations' ? 'is-active' : ''} onClick={() => setActiveTab('vacations')}>
            Férias e ausências ({isLoadingData ? '...' : vacationRequests.length})
          </button>
        )}
      </div>

      {activeTab === 'profiles' && canReviewProfiles && (
        <section className="trainings-list-card">
          <div className="trainings-list-head">
            <h3>Pedidos de alteração de ficha</h3>
            <input
              className="rh-reason-input"
              type="text"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Motivo da rejeição (opcional)"
            />
          </div>

          <div className="rh-request-list">
            {isLoadingData ? (
              Array.from({ length: 3 }).map((_, index) => (
                <article key={index} className="trainings-mobile-card">
                  <Skeleton lines={2} />
                  <Skeleton lines={2} />
                  <div className="trainings-row-actions">
                    <Skeleton lines={1} />
                    <Skeleton lines={1} />
                  </div>
                </article>
              ))
            ) : profileRequests.length === 0 ? (
              <article className="trainings-mobile-card">Sem pedidos pendentes.</article>
            ) : (
              profileRequests.map((request) => {
                const changesCount = (request.changeDetails ?? []).length;
                return (
                  <article key={request.id} className="trainings-mobile-card rh-profile-card" onClick={() => openProfileRequestDetails(request)}>
                    <header>
                      <div className="rh-profile-card__top">
                        <h4>{request.requesterName || getDisplayName(request.user)}</h4>
                        <Badge tone={getVacationStatusTone(request.status) === 'approved' ? 'success' : getVacationStatusTone(request.status) === 'pending' ? 'warning' : getVacationStatusTone(request.status) === 'rejected' ? 'danger' : 'neutral'}>
                          {formatVacationStatusLabel(request.status)}
                        </Badge>
                      </div>
                      <div className="rh-profile-card__meta">
                        <span className="rh-profile-card__changes">
                          📝 {changesCount} {changesCount === 1 ? 'alteração' : 'alterações'}
                        </span>
                        <span className="rh-profile-card__created">{formatShortDate(request.createdAt)}</span>
                      </div>
                    </header>
                    <div className="trainings-row-actions">
                      <Button type="button" size="sm" variant="secondary" onClick={(event) => { event.stopPropagation(); openProfileRequestDetails(request); }}>Ver detalhe</Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        isLoading={pendingActionKey === `approve-profile-${request.id}`}
                        disabled={Boolean(pendingActionKey)}
                        onClick={(event) => { event.stopPropagation(); void approveProfileRequest(request); }}
                      >
                        Aprovar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        isLoading={pendingActionKey === `reject-profile-${request.id}`}
                        disabled={Boolean(pendingActionKey)}
                        onClick={(event) => { event.stopPropagation(); void rejectProfileRequest(request); }}
                      >
                        Rejeitar
                      </Button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}

      {activeTab === 'vacations' && canReviewVacations && (
        <section className="trainings-list-card">
          <div className="trainings-list-head">
            <h3>Pedidos de férias e ausências</h3>
            <input
              className="rh-reason-input"
              type="text"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Motivo da rejeição (opcional)"
            />
          </div>

          <div className="rh-request-list">
            {isLoadingData ? (
              Array.from({ length: 3 }).map((_, index) => (
                <article key={index} className="trainings-mobile-card">
                  <Skeleton lines={2} />
                  <Skeleton lines={2} />
                  <div className="trainings-row-actions">
                    <Skeleton lines={1} />
                    <Skeleton lines={1} />
                  </div>
                </article>
              ))
            ) : vacationRequests.length === 0 ? (
              <article className="trainings-mobile-card">Sem pedidos pendentes.</article>
            ) : (
              vacationRequests.map((request) => (
                <article key={request.id} className="trainings-mobile-card">
                  <header>
                    <h4>{getDisplayName(request.user)}</h4>
                    <Badge tone={getVacationStatusTone(request.status) === 'approved' ? 'success' : getVacationStatusTone(request.status) === 'pending' ? 'warning' : getVacationStatusTone(request.status) === 'rejected' ? 'danger' : 'neutral'}>
                      {formatVacationStatusLabel(request.status)}
                    </Badge>
                  </header>
                  <p>{request.dataInicio} - {request.dataFim}</p>
                  <p>{request.observacoes || 'Sem observações.'}</p>
                  <div className="trainings-row-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      isLoading={pendingActionKey === `approve-vacation-${request.id}`}
                      disabled={Boolean(pendingActionKey)}
                      onClick={() => void approveVacationRequest(request)}
                    >
                      Aprovar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      isLoading={pendingActionKey === `reject-vacation-${request.id}`}
                      disabled={Boolean(pendingActionKey)}
                      onClick={() => void rejectVacationRequest(request)}
                    >
                      Rejeitar
                    </Button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      <Modal
        open={Boolean(selectedProfileRequest)}
        title="Detalhe do pedido de alteração"
        onClose={closeProfileRequestDetails}
        width="min(1300px, 98vw)"
        showCloseButton={false}
        footer={selectedProfileRequest ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12 }}>
            <div style={{ color: 'var(--hub-text-3)', fontSize: '0.9rem' }}>
              {selectedProfileRequest.requesterName || getDisplayName(selectedProfileRequest.user)}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button type="button" variant="ghost" size="md" onClick={closeProfileRequestDetails}>Fechar</Button>
              <Button
                type="button"
                variant="secondary"
                size="md"
                isLoading={pendingActionKey === `reject-profile-${selectedProfileRequest.id}`}
                disabled={Boolean(pendingActionKey)}
                onClick={() => { void rejectProfileRequest(selectedProfileRequest); }}
              >
                Rejeitar
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                isLoading={pendingActionKey === `approve-profile-${selectedProfileRequest.id}`}
                disabled={Boolean(pendingActionKey)}
                onClick={() => { void approveProfileRequest(selectedProfileRequest); }}
              >
                Aprovar
              </Button>
            </div>
          </div>
        ) : undefined}
      >
        {selectedProfileRequest && (
          <div className="approval-profile-modal">
            <p className="approval-profile-modal__summary">Alterações solicitadas por {selectedProfileRequest.requesterName || getDisplayName(selectedProfileRequest.user)}</p>
            <div className="approval-profile-modal__grid">
              {(selectedProfileRequest.changeDetails ?? []).map((item) => (
                <article key={`${item.field}-${item.oldValue}-${item.newValue}`} className="approval-profile-modal__item">
                  <h4>{item.field}</h4>
                  <div>
                    <div>
                      <span>Atual</span>
                      <strong>{renderApprovalFieldValue(item.field, item.oldValue)}</strong>
                    </div>
                    <div>
                      <span>Novo</span>
                      <strong>{renderApprovalFieldValue(item.field, item.newValue)}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(pendingActionKey)}
        title="Processando ação"
        onClose={() => undefined}
        width="min(420px, 90vw)"
        showCloseButton={false}
        footer={undefined}
      >
        <div className="notification-detail">
          <p className="notification-detail__summary">A operação está a ser executada.</p>
          <div className="notification-detail__panel">
            <strong>Por favor aguarde</strong>
            <p>O sistema está a validar a ação e a atualizar os registos.</p>
          </div>
        </div>
      </Modal>

      <div className="approvals-toast" aria-live="polite">
        <Toast show={toast.visible} tone={toast.tone} message={toast.message} />
      </div>
    </section>
  );
}