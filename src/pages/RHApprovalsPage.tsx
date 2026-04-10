import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatVacationStatusLabel, getVacationStatusTone } from '../portal/labels';
import Badge from '../components/ui/Badge';
import Skeleton from '../components/ui/Skeleton';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

type ProfileRequest = {
  id: string;
  userId: string;
  changesSummary: string;
  status: string;
  requestedData: Record<string, string>;
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

export default function RHApprovalsPage() {
  const { hasPermission, isRootAccess } = usePortal();
  const [activeTab, setActiveTab] = useState<'profiles' | 'vacations'>('profiles');
  const [profileRequests, setProfileRequests] = useState<ProfileRequest[]>([]);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  const [status, setStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(true);

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
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar pedidos.');
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

  async function approveProfileRequest(id: string) {
    await apiRequest(`/profile/requests/${id}/approve`, { method: 'POST', headers: getAuthHeaders() });
    clearApiCache('/profile/requests');
    setProfileRequests((current) => current.filter((item) => item.id !== id));
  }

  async function rejectProfileRequest(id: string) {
    await apiRequest(`/profile/requests/${id}/reject`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason: rejectReason }),
    });
    clearApiCache('/profile/requests');
    setProfileRequests((current) => current.filter((item) => item.id !== id));
  }

  async function approveVacationRequest(id: string) {
    await apiRequest(`/vacations/${id}/approve`, { method: 'POST', headers: getAuthHeaders() });
    clearApiCache('/vacations');
    setVacationRequests((current) => current.filter((item) => item.id !== id));
  }

  async function rejectVacationRequest(id: string) {
    await apiRequest(`/vacations/${id}/reject`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason: rejectReason }),
    });
    clearApiCache('/vacations');
    setVacationRequests((current) => current.filter((item) => item.id !== id));
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
            <strong>{isLoadingData ? <span className="loading-line loading-line--metric" /> : requestCount}</strong>
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
              profileRequests.map((request) => (
                <article key={request.id} className="trainings-mobile-card">
                  <header>
                    <h4>{getDisplayName(request.user)}</h4>
                    <Badge tone={getVacationStatusTone(request.status) === 'approved' ? 'success' : getVacationStatusTone(request.status) === 'pending' ? 'warning' : getVacationStatusTone(request.status) === 'rejected' ? 'danger' : 'neutral'}>
                      {formatVacationStatusLabel(request.status)}
                    </Badge>
                  </header>
                  <p>{request.changesSummary}</p>
                  <div className="trainings-row-actions">
                    <button type="button" onClick={() => void approveProfileRequest(request.id)}>Aprovar</button>
                    <button type="button" onClick={() => void rejectProfileRequest(request.id)}>Rejeitar</button>
                  </div>
                </article>
              ))
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
                    <button type="button" onClick={() => void approveVacationRequest(request.id)}>Aprovar</button>
                    <button type="button" onClick={() => void rejectVacationRequest(request.id)}>Rejeitar</button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}