import { useEffect, useMemo, useState } from 'react';
import { apiRequestCached, authHeaders } from '../portal/api';
import { usePortal } from '../portal/context';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

type TeamVacation = {
  id: string;
  dataInicio: string;
  dataFim: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requestType: 'VACATION' | 'ABSENCE_MEDICAL' | 'ABSENCE_TRAINING';
  partialDay?: 'FULL' | 'AM' | 'PM';
  reviewReason?: string | null;
  versionNumber?: number;
  contextTeam?: { id: string; name: string } | null;
};

type TeamMember = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  teamId: string | null;
  membershipRole: string;
  isApprover: boolean;
  approvalLevel: number | null;
  profile?: {
    primeiroNome?: string;
    apelido?: string;
    cargo?: string;
    funcao?: string;
  } | null;
  vacations: TeamVacation[];
};

type Team = {
  id: string;
  name: string;
  country: 'PT' | 'BR';
  manager?: { id: string; username: string } | null;
  coordinator?: { id: string; username: string } | null;
  parentTeam?: { id: string; name: string } | null;
  members: TeamMember[];
  _count?: { members: number; memberships: number };
};

function formatVacationType(value: TeamVacation['requestType']) {
  if (value === 'VACATION') return 'Férias';
  if (value === 'ABSENCE_MEDICAL') return 'Ausência médica';
  return 'Ausência formação';
}

function formatPartialDayLabel(value?: TeamVacation['partialDay']) {
  if (value === 'AM') return ' (meio-dia manhã)';
  if (value === 'PM') return ' (meio-dia tarde)';
  return '';
}

function formatPerson(member: TeamMember) {
  return `${member.profile?.primeiroNome || ''} ${member.profile?.apelido || ''}`.trim() || member.username;
}

export default function ManagerTeamsPage() {
  const { userRole } = usePortal();
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) || null,
    [teams, selectedTeamId],
  );

  useEffect(() => {
    if (userRole === 'convidado') {
      return;
    }

    void loadTeams();
  }, [userRole, year]);

  async function loadTeams() {
    setLoading(true);
    try {
      const data = await apiRequestCached<Team[]>(`/teams/me?year=${year}`, {
        headers: getAuthHeaders(),
      }, 20000);

      setTeams(data);
      if (selectedTeamId && !data.some((team) => team.id === selectedTeamId)) {
        setSelectedTeamId(null);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar equipas.');
    } finally {
      setLoading(false);
    }
  }

  if (userRole === 'convidado') {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área não está disponível para convidados.</p>
        </article>
      </section>
    );
  }

  const heroTitle = userRole === 'colaborador'
    ? 'Equipa e planeamento'
    : userRole === 'manager'
      ? 'Equipas sob gestão'
      : userRole === 'coordenador'
        ? 'Equipas coordenadas'
        : 'Visão transversal de equipas';

  const heroDescription = userRole === 'colaborador'
    ? 'Consulta a tua equipa, membros e férias/ausências num único painel.'
    : 'Consulta equipas, membros e pedidos de férias/ausências com contexto por ano.';

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Equipas</p>
          <h2>{heroTitle}</h2>
          <p>{heroDescription}</p>
        </div>

        <div className="trainings-hours-summary">
          <article>
            <span>Ano</span>
            <strong>{year}</strong>
          </article>
          <article>
            <span>Equipas visíveis</span>
            <strong>{teams.length}</strong>
          </article>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>{userRole === 'colaborador' ? 'A tua equipa' : 'As tuas equipas'}</h3>
          <label>
            <span>Ano</span>
            <input type="number" value={year} min={2020} max={2035} onChange={(event) => setYear(Number(event.target.value || '2026'))} />
          </label>
        </div>

        <div className="manager-teams-grid" aria-label="Lista de equipas">
          {loading && <article className="trainings-mobile-card">A carregar equipas...</article>}
          {!loading && teams.length === 0 && <article className="trainings-mobile-card">Sem equipas visíveis para este perfil.</article>}
          {!loading && teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className="manager-team-card"
              onClick={() => setSelectedTeamId(team.id)}
            >
              <span className="manager-team-card__label">{team.country}</span>
              <h3>{team.name}</h3>
              <p>{(team._count?.members ?? team.members.length)} membro(s)</p>
              <small>{team.parentTeam ? `Subequipa de ${team.parentTeam.name}` : 'Equipa base'}</small>
            </button>
          ))}
        </div>
      </section>

      {selectedTeam && (
        <div className="manager-team-modal-backdrop" onClick={() => setSelectedTeamId(null)}>
          <section className="manager-team-modal manager-team-modal--wide" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>{selectedTeam.name}</h3>
                <p style={{ margin: '4px 0 0', color: '#4f678e' }}>
                  Manager: {selectedTeam.manager?.username || '-'} · Coordenador: {selectedTeam.coordinator?.username || '-'}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedTeamId(null)} aria-label="Fechar popup">Fechar</button>
            </header>

            <div className="manager-team-members-list">
              {(selectedTeam.members || []).length === 0 && <p>Sem membros nesta equipa.</p>}

              {selectedTeam.members.map((person) => (
                <article key={`${selectedTeam.id}-${person.id}`} className="manager-team-member-item">
                  <div className="manager-team-member-item__header">
                    <div>
                      <strong>{formatPerson(person)}</strong>
                      <span>{person.email}</span>
                    </div>
                    <small>{person.membershipRole}{person.isApprover ? ` · Linha ${person.approvalLevel || 1}` : ''}</small>
                  </div>

                  {person.vacations.length === 0 ? (
                    <p style={{ margin: 0 }}>Sem férias/ausências neste ano.</p>
                  ) : (
                    <div className="manager-team-vacations-list">
                      {person.vacations.map((vacation) => (
                        <article key={vacation.id} className="manager-team-vacation-item">
                          <strong>{formatVacationType(vacation.requestType)}</strong>
                          <span>{formatPartialDayLabel(vacation.partialDay)}</span>
                          <span>{vacation.dataInicio} - {vacation.dataFim}</span>
                          <span>{vacation.status}{vacation.versionNumber ? ` · v${vacation.versionNumber}` : ''}</span>
                          <small>{vacation.contextTeam?.name || selectedTeam.name}</small>
                          {vacation.reviewReason && <small>{vacation.reviewReason}</small>}
                        </article>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}
