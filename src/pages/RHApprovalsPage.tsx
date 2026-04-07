import { useEffect, useMemo, useState } from 'react';
import { apiRequest, authHeaders } from '../portal/api';

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
  };
};

export default function RHApprovalsPage() {
  const [activeTab, setActiveTab] = useState<'profiles' | 'vacations'>('profiles');
  const [profileRequests, setProfileRequests] = useState<ProfileRequest[]>([]);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  const [status, setStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const requestCount = useMemo(() => profileRequests.length + vacationRequests.length, [profileRequests.length, vacationRequests.length]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      const [profiles, vacations] = await Promise.all([
        apiRequest<ProfileRequest[]>('/profile/requests', { headers: getAuthHeaders() }),
        apiRequest<VacationRequest[]>('/vacations/requests', { headers: getAuthHeaders() }),
      ]);

      setProfileRequests(profiles);
      setVacationRequests(vacations);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar pedidos.');
    }
  }

  async function approveProfileRequest(id: string) {
    await apiRequest(`/profile/requests/${id}/approve`, { method: 'POST', headers: getAuthHeaders() });
    setProfileRequests((current) => current.filter((item) => item.id !== id));
  }

  async function rejectProfileRequest(id: string) {
    await apiRequest(`/profile/requests/${id}/reject`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason: rejectReason }),
    });
    setProfileRequests((current) => current.filter((item) => item.id !== id));
  }

  async function approveVacationRequest(id: string) {
    await apiRequest(`/vacations/${id}/approve`, { method: 'POST', headers: getAuthHeaders() });
    setVacationRequests((current) => current.filter((item) => item.id !== id));
  }

  async function rejectVacationRequest(id: string) {
    await apiRequest(`/vacations/${id}/reject`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ reason: rejectReason }),
    });
    setVacationRequests((current) => current.filter((item) => item.id !== id));
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">RH</p>
          <h2>Aprovações RH</h2>
          <p>Revê pedidos de perfil e pedidos de férias pendentes.</p>
        </div>

        <div className="trainings-hours-summary">
          <article>
            <span>Pedidos em aberto</span>
            <strong>{requestCount}</strong>
          </article>
        </div>
      </header>

      <div className="rh-tabs">
        <button type="button" className={activeTab === 'profiles' ? 'is-active' : ''} onClick={() => setActiveTab('profiles')}>
          Pedidos de perfil
        </button>
        <button type="button" className={activeTab === 'vacations' ? 'is-active' : ''} onClick={() => setActiveTab('vacations')}>
          Pedidos de férias
        </button>
      </div>

      {activeTab === 'profiles' && (
        <section className="trainings-list-card">
          <div className="trainings-list-head">
            <h3>Pedidos de alteração de ficha</h3>
            <input
              className="rh-reason-input"
              type="text"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Motivo de recusa (opcional)"
            />
          </div>

          <div className="rh-request-list">
            {profileRequests.length === 0 && <article className="trainings-mobile-card">Sem pedidos pendentes.</article>}
            {profileRequests.map((request) => (
              <article key={request.id} className="trainings-mobile-card">
                <header>
                  <h4>{request.user.username}</h4>
                  <strong>{request.status}</strong>
                </header>
                <p>{request.changesSummary}</p>
                <div className="trainings-row-actions">
                  <button type="button" onClick={() => void approveProfileRequest(request.id)}>Aprovar</button>
                  <button type="button" onClick={() => void rejectProfileRequest(request.id)}>Recusar</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'vacations' && (
        <section className="trainings-list-card">
          <div className="trainings-list-head">
            <h3>Pedidos de férias</h3>
            <input
              className="rh-reason-input"
              type="text"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Motivo de recusa (opcional)"
            />
          </div>

          <div className="rh-request-list">
            {vacationRequests.length === 0 && <article className="trainings-mobile-card">Sem pedidos pendentes.</article>}
            {vacationRequests.map((request) => (
              <article key={request.id} className="trainings-mobile-card">
                <header>
                  <h4>{request.user.username}</h4>
                  <strong>{request.status}</strong>
                </header>
                <p>{request.dataInicio} - {request.dataFim}</p>
                <p>{request.observacoes || 'Sem observações.'}</p>
                <div className="trainings-row-actions">
                  <button type="button" onClick={() => void approveVacationRequest(request.id)}>Aprovar</button>
                  <button type="button" onClick={() => void rejectVacationRequest(request.id)}>Recusar</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}