import { useEffect, useMemo, useState } from 'react';
import { apiRequestCached, authHeaders } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatRoleLabel } from '../portal/labels';
import Skeleton from '../components/ui/Skeleton';
import Modal from '../components/ui/Modal';

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

type TeamSummary = {
  id: string;
  name: string;
  country: 'PT' | 'BR';
  manager?: {
    id: string;
    username: string;
    profile?: {
      primeiroNome?: string;
      apelido?: string;
    } | null;
  } | null;
  coordinator?: {
    id: string;
    username: string;
    profile?: {
      primeiroNome?: string;
      apelido?: string;
    } | null;
  } | null;
  parentTeam?: { id: string; name: string } | null;
  _count?: { members: number; memberships: number };
};

type TeamDetail = TeamSummary & {
  members: TeamMember[];
};

function formatVacationType(value: TeamVacation['requestType']) {
  if (value === 'VACATION') return 'Ferias';
  if (value === 'ABSENCE_MEDICAL') return 'Ausencia medica';
  return 'Ausencia formacao';
}

function formatPartialDayLabel(value?: TeamVacation['partialDay']) {
  if (value === 'AM') return ' (meio-dia manha)';
  if (value === 'PM') return ' (meio-dia tarde)';
  return '';
}

function formatDatePt(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short' }).format(date);
}

function addDays(baseIso: string, days: number) {
  const date = new Date(`${baseIso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDaysBetween(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T00:00:00`).getTime();
  const end = new Date(`${endIso}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;
  }
  return Math.floor((end - start) / 86400000) + 1;
}

function formatAbbreviatedName(input: {
  username: string;
  profile?: { primeiroNome?: string; apelido?: string } | null;
}) {
  const first = input.profile?.primeiroNome?.trim() || '';
  const last = input.profile?.apelido?.trim() || '';

  if (first && last) {
    return `${first} ${last.charAt(0).toUpperCase()}.`;
  }

  if (first) {
    return first;
  }

  const fallback = input.username.trim();
  const parts = fallback.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
  }

  return fallback;
}

function formatPerson(member: TeamMember) {
  return formatAbbreviatedName({ username: member.username, profile: member.profile });
}

function isFutureOrCurrentVacation(vacation: TeamVacation) {
  const today = new Date();
  const endDate = new Date(`${vacation.dataFim}T23:59:59`);
  return endDate.getTime() >= today.getTime();
}

export default function ManagerTeamsPage() {
  const { userRole } = usePortal();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedTeamDetail, setSelectedTeamDetail] = useState<TeamDetail | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [status, setStatus] = useState('');
  const [teamModalTab, setTeamModalTab] = useState<'overview' | 'vacations'>('overview');

  const selectedTeamSummary = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) || null,
    [teams, selectedTeamId],
  );

  const selectedTeam = selectedTeamDetail || selectedTeamSummary;

  useEffect(() => {
    if (userRole === 'convidado') {
      return;
    }

    void loadTeams();
  }, [userRole, year]);

  useEffect(() => {
    setTeamModalTab('overview');
    setSelectedTeamDetail(null);

    if (!selectedTeamId) {
      return;
    }

    void loadTeamDetail(selectedTeamId);
  }, [selectedTeamId, year]);

  async function loadTeams() {
    setLoading(true);
    setStatus('');

    try {
      const data = await apiRequestCached<TeamSummary[]>(`/teams/me?year=${year}&details=none`, {
        headers: getAuthHeaders(),
      }, 90000);

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

  async function loadTeamDetail(teamId: string) {
    setLoadingDetail(true);
    setStatus('');

    try {
      const data = await apiRequestCached<TeamDetail>(`/teams/me/${teamId}?year=${year}`, {
        headers: getAuthHeaders(),
      }, 45000);
      setSelectedTeamDetail(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar detalhe da equipa.');
    } finally {
      setLoadingDetail(false);
    }
  }

  if (userRole === 'convidado') {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta area nao esta disponivel para convidados.</p>
        </article>
      </section>
    );
  }

  const heroTitle = userRole === 'colaborador'
    ? 'As tuas equipas'
    : userRole === 'manager'
      ? 'Equipas sob gestao'
      : userRole === 'coordenador'
        ? 'Equipas coordenadas'
        : 'Visao transversal de equipas';

  const heroDescription = userRole === 'colaborador'
    ? 'Consulta equipas, membros e proximas ausencias num unico painel.'
    : 'Consulta equipas, membros e pedidos de ferias/ausencias com contexto por ano.';

  const selectedTeamMembers = selectedTeamDetail?.members || [];

  const upcomingVacations = useMemo(() => {
    if (!selectedTeamDetail) {
      return [] as Array<{
        member: TeamMember;
        vacation: TeamVacation;
        startLabel: string;
        endLabel: string;
        returnLabel: string;
        durationLabel: string;
        phaseLabel: string;
      }>;
    }

    const todayIso = new Date().toISOString().slice(0, 10);

    return selectedTeamDetail.members
      .flatMap((member) => (
        member.vacations
          .filter((vacation) => vacation.status === 'APPROVED')
          .filter((vacation) => vacation.requestType === 'VACATION')
          .filter((vacation) => isFutureOrCurrentVacation(vacation))
          .map((vacation) => {
            const startLabel = formatDatePt(vacation.dataInicio);
            const endLabel = formatDatePt(vacation.dataFim);
            const returnLabel = formatDatePt(addDays(vacation.dataFim, 1));
            const rawDays = getDaysBetween(vacation.dataInicio, vacation.dataFim);
            const days = vacation.partialDay && vacation.partialDay !== 'FULL' ? 0.5 : rawDays;
            const durationLabel = `${String(days).replace('.', ',')} dia(s)`;
            const phaseLabel = vacation.dataInicio > todayIso ? 'Sai em' : 'Em ferias ate';

            return {
              member,
              vacation,
              startLabel,
              endLabel,
              returnLabel,
              durationLabel,
              phaseLabel,
            };
          })
      ))
      .sort((a, b) => a.vacation.dataInicio.localeCompare(b.vacation.dataInicio));
  }, [selectedTeamDetail]);

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
            <span>Equipas visiveis</span>
            <strong>{teams.length}</strong>
          </article>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>{userRole === 'colaborador' ? 'As tuas equipas' : 'As equipas'}</h3>
          <label>
            <span>Ano</span>
            <input type="number" value={year} min={2020} max={2035} onChange={(event) => setYear(Number(event.target.value || '2026'))} />
          </label>
        </div>

        <div className="manager-teams-grid" aria-label="Lista de equipas">
          {loading && (
            <article className="trainings-mobile-card">
              <Skeleton lines={3} />
            </article>
          )}
          {!loading && teams.length === 0 && <article className="trainings-mobile-card">Sem equipas visiveis para este perfil.</article>}
          {!loading && teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className="manager-team-card"
              onClick={() => setSelectedTeamId(team.id)}
            >
              <span className="manager-team-card__label">{team.country}</span>
              <h3>{team.name}</h3>
              <p>{team._count?.members ?? 0} membro(s)</p>
              <small>{team.parentTeam ? `Subequipa de ${team.parentTeam.name}` : 'Equipa base'}</small>
            </button>
          ))}
        </div>
      </section>

      <Modal
        open={Boolean(selectedTeamId)}
        title={selectedTeam?.name || 'Equipa'}
        onClose={() => setSelectedTeamId(null)}
        width="min(1240px, 96vw)"
      >
        {selectedTeam && (
          <>
            <div className="team-modal-nav" role="tablist" aria-label="Detalhe da equipa">
              <button type="button" className={`notification-filter${teamModalTab === 'overview' ? ' is-active' : ''}`} onClick={() => setTeamModalTab('overview')}>
                Visao geral
              </button>
              <button type="button" className={`notification-filter${teamModalTab === 'vacations' ? ' is-active' : ''}`} onClick={() => setTeamModalTab('vacations')}>
                Ferias da equipa
              </button>
            </div>

            {loadingDetail && (
              <article className="trainings-mobile-card">
                <Skeleton lines={5} />
              </article>
            )}

            {!loadingDetail && teamModalTab === 'overview' && (
              <>
                <div className="team-overview-metrics">
                  <article>
                    <span>Manager</span>
                    <strong>{selectedTeam.manager ? formatAbbreviatedName(selectedTeam.manager) : '-'}</strong>
                  </article>
                  <article>
                    <span>Coordenador</span>
                    <strong>{selectedTeam.coordinator ? formatAbbreviatedName(selectedTeam.coordinator) : '-'}</strong>
                  </article>
                  <article>
                    <span>Estrutura</span>
                    <strong>{selectedTeam.parentTeam ? `Subequipa de ${selectedTeam.parentTeam.name}` : 'Equipa base'}</strong>
                  </article>
                  <article>
                    <span>Pessoas</span>
                    <strong>{selectedTeamMembers.length}</strong>
                  </article>
                </div>

                <section className="manager-team-members-list manager-team-members-list--structured">
                  {selectedTeamMembers.length === 0 && <p>Sem membros nesta equipa.</p>}

                  {selectedTeamMembers.map((person) => (
                    <article key={`${selectedTeam.id}-${person.id}`} className="manager-team-member-item">
                      <div className="manager-team-member-item__header">
                        <div>
                          <strong>{formatPerson(person)}</strong>
                          <span>{person.email}</span>
                        </div>
                      </div>

                      <p className="team-member-meta">
                        {formatRoleLabel(person.role)}
                      </p>
                    </article>
                  ))}
                </section>
              </>
            )}

            {!loadingDetail && teamModalTab === 'vacations' && (
              <section className="manager-team-vacations-board">
                {upcomingVacations.length === 0 && <p>Sem ferias futuras ou em curso neste momento.</p>}

                {upcomingVacations.map((item) => (
                  <article key={item.vacation.id} className="manager-team-vacation-item manager-team-vacation-item--wide">
                    <div>
                      <strong>{formatPerson(item.member)}</strong>
                      <span>{item.phaseLabel} {item.startLabel}{item.phaseLabel === 'Em ferias ate' ? '' : ` · Ate ${item.endLabel}`}</span>
                    </div>
                    <div className="team-vacation-timeline">
                      <span>
                        <small>Sai</small>
                        <strong>{item.startLabel}</strong>
                      </span>
                      <span>
                        <small>Volta</small>
                        <strong>{item.returnLabel}</strong>
                      </span>
                      <span>
                        <small>Duracao</small>
                        <strong>{item.durationLabel}{formatPartialDayLabel(item.vacation.partialDay)}</strong>
                      </span>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </Modal>

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}
