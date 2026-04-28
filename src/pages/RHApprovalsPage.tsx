import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, getBackendBase, isAbortError } from '../portal/api';
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
  status: string; // "PENDING" | "APPROVED" | "REJECTED" | "PARTIALLY_REJECTED"
  requestedData: Record<string, string>;
  rejectedFields?: Record<string, string>; // {"fieldName": "observações"}
  approvedFields?: Record<string, string>; // Campos aprovados (em PARTIALLY_REJECTED)
  changeDetails?: Array<{
    fieldKey?: string;
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
      nomeCompleto?: string;
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
  processadoAt?: string | null;
  processadoById?: string | null;
  realizadoAt?: string | null;
  realizadoByIds?: string[] | null;
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  };
};

type RejectionCandidate =
  | { kind: 'profile'; request: ProfileRequest }
  | { kind: 'vacation'; request: VacationRequest };

function getDisplayName(user?: { username: string; profile?: { nomeAbreviado?: string; nomeCompleto?: string } | null } | null) {
  const shortName = user?.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = user?.profile?.nomeCompleto ?? '';
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
  const { hasPermission, isRootAccess, refreshNotifications } = usePortal();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'profiles' | 'vacations'>(() => (
    searchParams.get('tab') === 'vacations' ? 'vacations' : 'profiles'
  ));
  const [profileRequests, setProfileRequests] = useState<ProfileRequest[]>([]);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [isLoadingProfileRequests, setIsLoadingProfileRequests] = useState(true);
  const [isLoadingVacationRequests, setIsLoadingVacationRequests] = useState(true);
  const [selectedProfileRequest, setSelectedProfileRequest] = useState<ProfileRequest | null>(null);
  const [rejectionCandidate, setRejectionCandidate] = useState<RejectionCandidate | null>(null);
  const [rejectionMode, setRejectionMode] = useState<'none' | 'total' | 'partial'>('none');
  const [rejectedFields, setRejectedFields] = useState<Record<string, string>>({}); // {"fieldName": "observações"}
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error' | 'info'; message: string; visible: boolean }>({
    tone: 'info',
    message: '',
    visible: false,
  });

  const requestCount = useMemo(() => profileRequests.length + vacationRequests.length, [profileRequests.length, vacationRequests.length]);
  const isLoadingData = isLoadingProfileRequests || isLoadingVacationRequests;
  const canReviewProfiles = isRootAccess || hasPermission('approve_profile_change');
  const canReviewVacations = isRootAccess || hasPermission('approve_vacation') || hasPermission('reject_vacation') || hasPermission('view_all_vacations');

  useEffect(() => {
    if (activeTab === 'profiles' && !canReviewProfiles && canReviewVacations) {
      setActiveTab('vacations');
      return;
    }

    if (activeTab === 'vacations' && !canReviewVacations && canReviewProfiles) {
      setActiveTab('profiles');
    }
  }, [activeTab, canReviewProfiles, canReviewVacations]);

  function handleTabChange(nextTab: 'profiles' | 'vacations') {
    if (nextTab === activeTab) {
      return;
    }

    setActiveTab(nextTab);
    setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.set('tab', nextTab);
      return nextParams;
    }, { replace: true });
  }

  useEffect(() => {
    if (!canReviewProfiles && !canReviewVacations) {
      return;
    }

    const controller = new AbortController();

    void loadProfileRequests(controller.signal);
    void loadVacationRequests(controller.signal);

    return () => controller.abort();
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

  async function loadProfileRequests(signal?: AbortSignal) {
    setIsLoadingProfileRequests(true);
    try {
      if (!canReviewProfiles) {
        setProfileRequests([]);
        return;
      }

      const profiles = await apiRequestCached<ProfileRequest[]>('/profile/requests', { headers: getAuthHeaders(), signal }, 45000);
      setProfileRequests(profiles);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      showToast('error', resolveErrorMessage(error, MICROCOPY.approvals.loadRequestsError));
    } finally {
      if (!signal?.aborted) {
        setIsLoadingProfileRequests(false);
      }
    }
  }

  async function loadVacationRequests(signal?: AbortSignal) {
    setIsLoadingVacationRequests(true);
    try {
      if (!canReviewVacations) {
        setVacationRequests([]);
        return;
      }

      const vacations = await apiRequestCached<VacationRequest[]>('/vacations/requests', { headers: getAuthHeaders(), signal }, 45000);
      setVacationRequests(vacations);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      showToast('error', resolveErrorMessage(error, MICROCOPY.approvals.loadRequestsError));
    } finally {
      if (!signal?.aborted) {
        setIsLoadingVacationRequests(false);
      }
    }
  }

  const selectedProfileChangeDetails = selectedProfileRequest?.changeDetails ?? [];
  const selectedRejectedFieldEntries = Object.entries(rejectedFields);
  const partialRejectionReady = selectedRejectedFieldEntries.length > 0 && selectedRejectedFieldEntries.every(([, note]) => note.trim().length > 0);

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
      await apiRequest(`/profile/requests/${request.id}/approve`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ reviewType: 'FULL_APPROVE' }) });
      clearApiCache('/profile/requests');
      setProfileRequests((current) => current.filter((item) => item.id !== request.id));
      void refreshNotifications();
      if (selectedProfileRequest?.id === request.id) {
        setSelectedProfileRequest(null);
        setRejectionMode('none');
        setRejectedFields({});
      }
    });
  }

  async function rejectProfileRequest(request: ProfileRequest, reason: string) {
    await runAction(`reject-profile-${request.id}`, MICROCOPY.approvals.rejectProfileSuccess(getDisplayName(request.user)), MICROCOPY.approvals.rejectProfileError, async () => {
      await apiRequest(`/profile/requests/${request.id}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason }),
      });
      clearApiCache('/profile/requests');
      setProfileRequests((current) => current.filter((item) => item.id !== request.id));
      void refreshNotifications();
      if (selectedProfileRequest?.id === request.id) {
        setSelectedProfileRequest(null);
        setRejectionMode('none');
        setRejectedFields({});
      }
    });
  }

  async function partiallyRejectProfileRequest(request: ProfileRequest) {
    await runAction(`partial-reject-profile-${request.id}`, 'Pedido parcialmente rejeitado com sucesso.', 'Erro ao rejeitar parcialmente o pedido.', async () => {
      await apiRequest(`/profile/requests/${request.id}/approve`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          reviewType: 'PARTIAL_REJECT',
          rejectedFields: Object.fromEntries(
            selectedProfileChangeDetails
              .filter((item) => Object.prototype.hasOwnProperty.call(rejectedFields, item.field))
              .map((item) => [item.fieldKey || item.field, rejectedFields[item.field]]),
          ),
        }),
      });
      clearApiCache('/profile/requests');
      setProfileRequests((current) => current.filter((item) => item.id !== request.id));
      void refreshNotifications();
      if (selectedProfileRequest?.id === request.id) {
        setSelectedProfileRequest(null);
        setRejectionMode('none');
        setRejectedFields({});
      }
    });
  }

  async function approveVacationRequest(request: VacationRequest) {
    await runAction(`approve-vacation-${request.id}`, MICROCOPY.approvals.approveVacationSuccess(getDisplayName(request.user)), MICROCOPY.approvals.approveVacationError, async () => {
      await apiRequest(`/vacations/${request.id}/approve`, { method: 'POST', headers: getAuthHeaders() });
      clearApiCache('/vacations');
      setVacationRequests((current) => current.filter((item) => item.id !== request.id));
      void refreshNotifications();
    });
  }

  async function rejectVacationRequest(request: VacationRequest, reason: string) {
    await runAction(`reject-vacation-${request.id}`, MICROCOPY.approvals.rejectVacationSuccess(getDisplayName(request.user)), MICROCOPY.approvals.rejectVacationError, async () => {
      await apiRequest(`/vacations/${request.id}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason }),
      });
      clearApiCache('/vacations');
      setVacationRequests((current) => current.filter((item) => item.id !== request.id));
      void refreshNotifications();
    });
  }

  function openRejectionModal(candidate: RejectionCandidate) {
    setRejectReason('');
    setRejectionCandidate(candidate);
  }

  function closeRejectionModal() {
    setRejectionCandidate(null);
    setRejectReason('');
  }

  async function submitRejection() {
    if (!rejectionCandidate) {
      return;
    }

    const reason = rejectReason.trim();
    if (!reason) {
      showToast('error', 'Motivo da rejeição é obrigatório.');
      return;
    }

    if (rejectionCandidate.kind === 'profile') {
      await rejectProfileRequest(rejectionCandidate.request, reason);
    } else {
      await rejectVacationRequest(rejectionCandidate.request, reason);
    }

    closeRejectionModal();
  }

  async function markVacationProcessado(request: VacationRequest) {
    await runAction(`mark-processado-vacation-${request.id}`, 'Férias marcadas como processado', 'Erro ao marcar processado', async () => {
      await apiRequest(`/vacations/${request.id}/mark-processado`, { method: 'POST', headers: getAuthHeaders() });
      clearApiCache('/vacations');
      // Reload the vacation request with updated processadoAt field
      setVacationRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, processadoAt: new Date().toISOString() }
            : item
        )
      );
      void refreshNotifications();
    });
  }

  async function markVacationRealizado(request: VacationRequest) {
    await runAction(`mark-realizado-vacation-${request.id}`, 'Realização de férias confirmada', 'Erro ao confirmar realização', async () => {
      const response = await apiRequest(`/vacations/${request.id}/mark-realizado`, { method: 'POST', headers: getAuthHeaders() }) as any;
      clearApiCache('/vacations');
      setVacationRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? {
                ...item,
                realizadoByIds: response.data?.realizadoByIds || [],
                realizadoAt: response.data?.fully_confirmed ? new Date().toISOString() : item.realizadoAt,
              }
            : item
        )
      );
      void refreshNotifications();
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

      <div className="rh-tabs">
        {canReviewProfiles && (
          <button type="button" className={activeTab === 'profiles' ? 'is-active' : ''} onClick={() => handleTabChange('profiles')}>
            Alterações de ficha ({isLoadingProfileRequests ? '...' : profileRequests.length})
          </button>
        )}
        {canReviewVacations && (
          <button type="button" className={activeTab === 'vacations' ? 'is-active' : ''} onClick={() => handleTabChange('vacations')}>
            Férias e ausências ({isLoadingVacationRequests ? '...' : vacationRequests.length})
          </button>
        )}
      </div>

      {activeTab === 'profiles' && canReviewProfiles && (
        <section className="trainings-list-card">
          <div className="trainings-list-head">
            <h3>Pedidos de alteração de ficha</h3>
          </div>

          <div className="rh-request-list">
            {isLoadingProfileRequests ? (
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
                        onClick={(event) => {
                          event.stopPropagation();
                          openRejectionModal({ kind: 'profile', request });
                        }}
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
          </div>

          <div className="rh-request-list">
            {isLoadingVacationRequests ? (
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
              vacationRequests.map((request) => {
                const isApproved = request.status === 'APPROVED';
                const isProcessado = isApproved && request.processadoAt;
                const isRealizedPendingRHConfirm = isProcessado && request.realizadoByIds && request.realizadoByIds.length > 0;

                return (
                  <article key={request.id} className="trainings-mobile-card">
                    <header>
                      <h4>{getDisplayName(request.user)}</h4>
                      <Badge tone={getVacationStatusTone(request.status) === 'approved' ? 'success' : getVacationStatusTone(request.status) === 'pending' ? 'warning' : getVacationStatusTone(request.status) === 'rejected' ? 'danger' : 'neutral'}>
                        {formatVacationStatusLabel(request.status)}
                      </Badge>
                    </header>
                    <p>{request.dataInicio} - {request.dataFim}</p>
                    <p>{request.observacoes || 'Sem observações.'}</p>
                    {isProcessado && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--hub-text-3)' }}>
                        ✓ Processado em {request.processadoAt ? new Date(request.processadoAt).toLocaleDateString('pt-PT') : '-'}
                      </p>
                    )}
                    <div className="trainings-row-actions">
                      {!isApproved && (
                        <>
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
                            onClick={() => openRejectionModal({ kind: 'vacation', request })}
                          >
                            Rejeitar
                          </Button>
                        </>
                      )}
                      {isApproved && !isProcessado && (
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          isLoading={pendingActionKey === `mark-processado-vacation-${request.id}`}
                          disabled={Boolean(pendingActionKey)}
                          onClick={() => void markVacationProcessado(request)}
                        >
                          Marcar Processado
                        </Button>
                      )}
                      {isRealizedPendingRHConfirm && (
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          isLoading={pendingActionKey === `mark-realizado-vacation-${request.id}`}
                          disabled={Boolean(pendingActionKey)}
                          onClick={() => void markVacationRealizado(request)}
                        >
                          Validar Realizado
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })
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
              <Button type="button" variant="ghost" size="md" onClick={() => { setRejectionMode('none'); closeProfileRequestDetails(); }}>Fechar</Button>
              {rejectionMode === 'none' && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    isLoading={pendingActionKey === `reject-profile-${selectedProfileRequest.id}`}
                    disabled={Boolean(pendingActionKey)}
                    onClick={() => { setRejectedFields({}); setRejectionMode('partial'); }}
                  >
                    Rejeitar campos
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    isLoading={pendingActionKey === `reject-profile-${selectedProfileRequest.id}`}
                    disabled={Boolean(pendingActionKey)}
                    onClick={() => openRejectionModal({ kind: 'profile', request: selectedProfileRequest })}
                  >
                    Rejeitar tudo
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    isLoading={pendingActionKey === `approve-profile-${selectedProfileRequest.id}`}
                    disabled={Boolean(pendingActionKey)}
                    onClick={() => { void approveProfileRequest(selectedProfileRequest); }}
                  >
                    Aprovar tudo
                  </Button>
                </>
              )}
              {rejectionMode === 'partial' && (
                <>
                  
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    isLoading={pendingActionKey === `partial-reject-profile-${selectedProfileRequest.id}`}
                    disabled={Boolean(pendingActionKey) || !partialRejectionReady}
                    onClick={() => { void partiallyRejectProfileRequest(selectedProfileRequest); }}
                  >
                    {partialRejectionReady ? `Confirmar rejeições (${Object.keys(rejectedFields).length})` : 'Preencher observações'}
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : undefined}
      >
        {selectedProfileRequest && rejectionMode === 'none' && (
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
        {selectedProfileRequest && rejectionMode === 'partial' && (
          <div className="approval-profile-modal">
            <div className="approval-profile-modal__partial-header">
              <div>
                <p className="approval-profile-modal__eyebrow">Rejeição parcial</p>
                <h3>Escolhe os campos a recusar e justifica cada decisão</h3>
                <p className="approval-profile-modal__lead">A observação é obrigatória em cada campo rejeitado. Manténs o restante pedido aprovado sem perder o contexto da decisão.</p>
              </div>

              <div className="approval-profile-modal__partial-status">
                <strong>{selectedRejectedFieldEntries.length} selecionado{selectedRejectedFieldEntries.length === 1 ? '' : 's'}</strong>
                <span>{partialRejectionReady ? 'Pronto para confirmar' : 'Falta observação em alguns campos'}</span>
              </div>
            </div>

            <div className="approval-profile-modal__partial-layout">
              <div className="approval-profile-modal__partial-list">
                {selectedProfileChangeDetails.map((item) => {
                  const rejectionKey = item.fieldKey || item.field;
                  const isRejected = Object.prototype.hasOwnProperty.call(rejectedFields, item.field);
                  const note = rejectedFields[item.field] ?? '';

                  return (
                    <article key={`${item.field}-${item.oldValue}-${item.newValue}`} className={`approval-profile-modal__partial-item${isRejected ? ' is-selected' : ''}`}>
                      <label className="approval-profile-modal__partial-toggle">
                        <input
                          type="checkbox"
                          checked={isRejected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRejectedFields((current) => ({ ...current, [item.field]: '' }));
                            } else {
                              setRejectedFields((current) => {
                                const copy = { ...current };
                                delete copy[item.field];
                                return copy;
                              });
                            }
                          }}
                        />
                        <span>
                          <strong>{item.field}</strong>
                          <small>Clica para incluir este campo na rejeição parcial</small>
                        </span>
                      </label>

                      <div className="approval-profile-modal__partial-values">
                        <div>
                          <span>Atual</span>
                          <strong>{renderApprovalFieldValue(item.field, item.oldValue)}</strong>
                        </div>
                        <div>
                          <span>Novo</span>
                          <strong>{renderApprovalFieldValue(item.field, item.newValue)}</strong>
                        </div>
                      </div>

                      {isRejected && (
                        <div className="approval-profile-modal__note-block">
                          <div className="approval-profile-modal__note-title">
                            <strong>Observação obrigatória</strong>
                            <span>Explique de forma objetiva porque este campo não pode ser aceite.</span>
                          </div>
                          <textarea
                            placeholder="Ex.: o comprovativo está ilegível / falta validação documental / dado incoerente..."
                            value={note}
                            onChange={(e) => {
                              setRejectedFields((current) => ({ ...current, [item.field]: e.target.value }));
                            }}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <aside className="approval-profile-modal__partial-summary">
                <h4>Resumo da decisão</h4>
                <p>Rejeita apenas os campos abaixo. O pedido segue com os restantes campos aprovados.</p>

                {selectedRejectedFieldEntries.length === 0 ? (
                  <div className="approval-profile-modal__partial-empty">
                    <strong>Nenhum campo selecionado</strong>
                    <span>Marca pelo menos um campo para abrir a caixa de observações.</span>
                  </div>
                ) : (
                  <ul>
                    {selectedRejectedFieldEntries.map(([field, note]) => (
                      <li key={field}>
                        <strong>{field}</strong>
                        <span>{note.trim() || 'Sem observação ainda'}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="approval-profile-modal__partial-tip">
                  <strong>Boa prática</strong>
                  <span>Escreve observações curtas, específicas e acionáveis. Isso acelera a correção do pedido.</span>
                </div>
              </aside>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(rejectionCandidate)}
        title="Rejeitar pedido"
        onClose={closeRejectionModal}
        width="min(560px, 92vw)"
        footer={rejectionCandidate ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, width: '100%' }}>
            <Button type="button" variant="ghost" size="md" onClick={closeRejectionModal}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              isLoading={pendingActionKey === `${rejectionCandidate.kind === 'profile' ? 'reject-profile' : 'reject-vacation'}-${rejectionCandidate.request.id}`}
              disabled={Boolean(pendingActionKey) || rejectReason.trim().length === 0}
              onClick={() => { void submitRejection(); }}
            >
              Confirmar rejeição
            </Button>
          </div>
        ) : undefined}
      >
        {rejectionCandidate && (
          <div className="notification-detail">
            <p className="notification-detail__summary">
              Vais rejeitar o pedido de <strong>{getDisplayName(rejectionCandidate.request.user)}</strong>.
            </p>
            <div className="notification-detail__panel">
              <strong>Motivo da rejeição</strong>
              <p>Este campo é obrigatório e será enviado ao colaborador.</p>
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Ex.: conflito de capacidade da equipa no período solicitado"
                style={{ width: '100%', minHeight: 110, marginTop: 8 }}
              />
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