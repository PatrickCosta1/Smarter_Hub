import { useEffect, useMemo, useState } from 'react';
import { apiRequestCached, authHeaders } from '../portal/api';
import { usePortal } from '../portal/context';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

type Team = {
  id: string;
  name: string;
  _count: { members: number };
};

type TeamMember = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  teamId: string | null;
  team?: { id: string; name: string } | null;
  profile?: {
    primeiroNome?: string;
    apelido?: string;
    cargo?: string;
    funcao?: string;
  } | null;
};

export default function ManagerTeamsPage() {
  const { userRole } = usePortal();
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [status, setStatus] = useState('');

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) || null,
    [teams, selectedTeamId],
  );

  const membersByTeam = useMemo(() => {
    const grouped = new Map<string, Array<{ id: string; name: string; email: string }>>();

    for (const member of members) {
      if (!member.teamId) {
        continue;
      }

      const fullName = `${member.profile?.primeiroNome || ''} ${member.profile?.apelido || ''}`.trim();
      const name = fullName || member.username;

      if (!grouped.has(member.teamId)) {
        grouped.set(member.teamId, []);
      }

      grouped.get(member.teamId)!.push({
        id: member.id,
        name,
        email: member.email,
      });
    }

    for (const [, teamMembers] of grouped) {
      teamMembers.sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'));
    }

    return grouped;
  }, [members]);

  useEffect(() => {
    if (userRole !== 'manager') {
      return;
    }

    void loadTeams();
  }, [userRole]);

  async function loadTeams() {
    try {
      const teamsData = await apiRequestCached<Team[]>('/teams', { headers: getAuthHeaders() }, 30000);
      setTeams(teamsData);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar equipas.');
    }
  }

  async function ensureMembersLoaded() {
    if (membersLoaded || loadingMembers) {
      return;
    }

    setLoadingMembers(true);
    try {
      const usersData = await apiRequestCached<TeamMember[]>('/users?limit=100', { headers: getAuthHeaders() }, 20000);
      setMembers(usersData);
      setMembersLoaded(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar membros da equipa.');
    } finally {
      setLoadingMembers(false);
    }
  }

  function openTeamModal(teamId: string) {
    setSelectedTeamId(teamId);
    void ensureMembersLoaded();
  }

  if (userRole !== 'manager') {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área é exclusiva para perfis manager.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Equipas</p>
          <h2>Gestão da tua equipa</h2>
          <p>Clica numa equipa para ver os membros num popup dedicado.</p>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>As tuas equipas</h3>
        </div>

        <div className="manager-teams-grid" aria-label="Lista de equipas">
          {teams.length === 0 && <article className="trainings-mobile-card">Sem equipas atribuídas.</article>}
          {teams.map((team) => {
            const teamMembers = membersByTeam.get(team.id) || [];
            const memberCount = membersLoaded ? teamMembers.length : team._count.members;

            return (
              <button
                key={team.id}
                type="button"
                className="manager-team-card"
                onClick={() => openTeamModal(team.id)}
              >
                <span className="manager-team-card__label">Equipa</span>
                <h3>{team.name}</h3>
                <p>{memberCount} membro(s)</p>
              </button>
            );
          })}
        </div>
      </section>

      {selectedTeam && (
        <div className="manager-team-modal-backdrop" onClick={() => setSelectedTeamId(null)}>
          <section className="manager-team-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>{selectedTeam.name}</h3>
              <button type="button" onClick={() => setSelectedTeamId(null)} aria-label="Fechar popup">Fechar</button>
            </header>

            <div className="manager-team-members-list">
              {loadingMembers && <p>A carregar membros...</p>}
              {!loadingMembers && (membersByTeam.get(selectedTeam.id) || []).length === 0 && <p>Sem membros nesta equipa.</p>}
              {!loadingMembers && (membersByTeam.get(selectedTeam.id) || []).map((person) => (
                <article key={`${selectedTeam.id}-${person.id}`} className="manager-team-member-item">
                  <strong>{person.name}</strong>
                  <span>{person.email}</span>
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
