import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from '../portal/api';
import { usePortal } from '../portal/context';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  teamId: string | null;
  teamName: string | null;
  workCountry: 'PT' | 'BR';
  localidade: string;
  teams?: Array<{
    teamId: string;
    teamName: string;
    membershipRole: string;
    isApprover: boolean;
    approvalLevel: number | null;
  }>;
};

type Team = {
  id: string;
  name: string;
  country?: 'PT' | 'BR';
  managerId?: string | null;
  coordinatorId?: string | null;
  parentTeamId?: string | null;
  manager?: { id: string; username: string } | null;
  coordinator?: { id: string; username: string } | null;
  parentTeam?: { id: string; name: string } | null;
  _count?: { members: number; memberships: number; subTeams: number };
};

type MembershipDraft = {
  teamId: string;
  membershipRole: string;
  isApprover: boolean;
  approvalLevel: number | null;
  isActive: boolean;
};

type TeamDraft = {
  id?: string;
  name: string;
  country: 'PT' | 'BR';
  managerId: string;
  coordinatorId: string;
  parentTeamId: string;
};

const EMPTY_TEAM_DRAFT: TeamDraft = {
  name: '',
  country: 'PT',
  managerId: '',
  coordinatorId: '',
  parentTeamId: '',
};

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

export default function AdminPage() {
  const { userRole } = usePortal();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [status, setStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [membershipsDraft, setMembershipsDraft] = useState<MembershipDraft[]>([]);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_TEAM_DRAFT);

  const selectedUser = useMemo(
    () => users.find((item) => item.id === selectedUserId) || null,
    [users, selectedUserId],
  );

  useEffect(() => {
    if (userRole !== 'admin') {
      return;
    }

    void loadData();
  }, [userRole]);

  useEffect(() => {
    if (!selectedUser) {
      setMembershipsDraft([]);
      return;
    }

    const current = selectedUser.teams ?? [];
    const normalized = teams.map((team) => {
      const found = current.find((item) => item.teamId === team.id);
      return {
        teamId: team.id,
        membershipRole: found?.membershipRole ?? 'PARTICIPANT',
        isApprover: found?.isApprover ?? false,
        approvalLevel: found?.approvalLevel ?? null,
        isActive: Boolean(found),
      };
    });

    setMembershipsDraft(normalized);
  }, [selectedUser, teams]);

  async function loadData() {
    try {
      const [usersData, teamsData] = await Promise.all([
        apiRequestCached<AdminUser[]>('/admin/users', { headers: getAuthHeaders() }, 15000),
        apiRequestCached<Team[]>('/admin/teams', { headers: getAuthHeaders() }, 30000),
      ]);

      setUsers(usersData);
      setTeams(teamsData);
      if (!selectedUserId && usersData.length > 0) {
        setSelectedUserId(usersData[0].id);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar dados de administração.');
    }
  }

  async function saveUser() {
    if (!selectedUser) {
      return;
    }

    setIsSaving(true);
    setStatus('A guardar alterações...');

    try {
      await apiRequest(`/admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          role: selectedUser.role,
          teamId: selectedUser.role === 'ADMIN' ? null : selectedUser.teamId,
          workCountry: selectedUser.workCountry,
          localidade: selectedUser.localidade,
        }),
      });

      await apiRequest(`/admin/users/${selectedUser.id}/memberships`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          memberships: membershipsDraft
            .filter((item) => item.isActive)
            .map((item) => ({
              teamId: item.teamId,
              membershipRole: item.membershipRole,
              isApprover: item.isApprover,
              approvalLevel: item.isApprover ? item.approvalLevel ?? 1 : null,
              isActive: true,
            })),
        }),
      });

      clearApiCache('/admin/users');
      clearApiCache('/teams');
      await loadData();
      setStatus('Perfil atualizado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar alterações.');
    } finally {
      setIsSaving(false);
    }
  }

  function patchSelectedUser(patch: Partial<AdminUser>) {
    setUsers((current) => current.map((item) => (item.id === selectedUserId ? { ...item, ...patch } : item)));
  }

  function patchMembership(teamId: string, patch: Partial<MembershipDraft>) {
    setMembershipsDraft((current) =>
      current.map((item) => (item.teamId === teamId ? { ...item, ...patch } : item)),
    );
  }

  function beginTeamEdit(team: Team) {
    setTeamDraft({
      id: team.id,
      name: team.name,
      country: team.country ?? 'PT',
      managerId: team.managerId || '',
      coordinatorId: team.coordinatorId || '',
      parentTeamId: team.parentTeamId || '',
    });
  }

  function resetTeamDraft() {
    setTeamDraft(EMPTY_TEAM_DRAFT);
  }

  async function saveTeam() {
    if (!teamDraft.name.trim()) {
      setStatus('Indica o nome da equipa.');
      return;
    }

    setIsSaving(true);
    try {
      const body = JSON.stringify({
        name: teamDraft.name.trim(),
        country: teamDraft.country,
        managerId: teamDraft.managerId || null,
        coordinatorId: teamDraft.coordinatorId || null,
        parentTeamId: teamDraft.parentTeamId || null,
      });

      await apiRequest(teamDraft.id ? `/admin/teams/${teamDraft.id}` : '/admin/teams', {
        method: teamDraft.id ? 'PATCH' : 'POST',
        headers: getAuthHeaders(),
        body,
      });

      clearApiCache('/admin/teams');
      await loadData();
      resetTeamDraft();
      setStatus('Equipa guardada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar equipa.');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteTeam(teamId: string) {
    if (!window.confirm('Remover esta equipa? Os membros serão desassociados.')) {
      return;
    }

    setIsSaving(true);
    try {
      await apiRequest(`/admin/teams/${teamId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      clearApiCache('/admin/teams');
      await loadData();
      if (teamDraft.id === teamId) {
        resetTeamDraft();
      }
      setStatus('Equipa removida com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao remover equipa.');
    } finally {
      setIsSaving(false);
    }
  }

  if (userRole !== 'admin') {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área é exclusiva para perfis admin.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Administração</p>
          <h2>Gestão global de perfis e hierarquia</h2>
          <p>Promove, despromove, muda equipa e define país de trabalho.</p>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>Utilizadores</h3>
        </div>

        <div className="trainings-table-wrap">
          <table className="trainings-table" aria-label="Utilizadores">
            <thead>
              <tr>
                <th>Utilizador</th>
                <th>Email</th>
                <th>Role</th>
                <th>Equipa</th>
                <th>País</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id} onClick={() => setSelectedUserId(item.id)} style={{ cursor: 'pointer', background: selectedUserId === item.id ? '#f0f7ff' : 'transparent' }}>
                  <td>{item.username}</td>
                  <td>{item.email}</td>
                  <td>{item.role}</td>
                  <td>{item.teamName || '-'}</td>
                  <td>{item.workCountry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>Equipas</h3>
          <button type="button" className="cta-button cta-ghost" onClick={resetTeamDraft}>Nova equipa</button>
        </div>

        <form className="trainings-form" onSubmit={(event) => { event.preventDefault(); void saveTeam(); }}>
          <label>
            <span>Nome</span>
            <input type="text" value={teamDraft.name} onChange={(event) => setTeamDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>

          <label>
            <span>País</span>
            <select value={teamDraft.country} onChange={(event) => setTeamDraft((current) => ({ ...current, country: event.target.value as 'PT' | 'BR' }))}>
              <option value="PT">Portugal</option>
              <option value="BR">Brasil</option>
            </select>
          </label>

          <label>
            <span>Manager</span>
            <select value={teamDraft.managerId} onChange={(event) => setTeamDraft((current) => ({ ...current, managerId: event.target.value }))}>
              <option value="">Sem manager</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.username}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Coordenador</span>
            <select value={teamDraft.coordinatorId} onChange={(event) => setTeamDraft((current) => ({ ...current, coordinatorId: event.target.value }))}>
              <option value="">Sem coordenador</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.username}</option>
              ))}
            </select>
          </label>

          <label className="field-span-2">
            <span>Subequipa de</span>
            <select value={teamDraft.parentTeamId} onChange={(event) => setTeamDraft((current) => ({ ...current, parentTeamId: event.target.value }))}>
              <option value="">Sem equipa mãe</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>

          <div className="trainings-form-actions field-span-2">
            <button type="submit" className="cta-button cta-primary" disabled={isSaving}>{isSaving ? 'A guardar...' : 'Guardar equipa'}</button>
            <button type="button" className="cta-button cta-ghost" onClick={resetTeamDraft}>Limpar</button>
          </div>
        </form>

        <div className="trainings-mobile-list" style={{ display: 'grid', marginTop: 12 }}>
          {teams.map((team) => (
            <article key={team.id} className="trainings-mobile-card">
              <header>
                <h4>{team.name}</h4>
                <strong>{team.country || 'PT'}</strong>
              </header>
              <p><span>Manager:</span> {team.manager?.username || '-'}</p>
              <p><span>Coordenador:</span> {team.coordinator?.username || '-'}</p>
              <p><span>Subequipa de:</span> {team.parentTeam?.name || '-'}</p>
              <p><span>Membros:</span> {team._count?.members ?? 0}</p>
              <div className="trainings-row-actions">
                <button type="button" onClick={() => beginTeamEdit(team)}>Editar</button>
                <button type="button" onClick={() => void deleteTeam(team.id)}>Remover</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {selectedUser && (
        <section className="trainings-form-card">
          <div className="trainings-form-head">
            <h3>Editar: {selectedUser.username}</h3>
          </div>

          <form className="trainings-form" onSubmit={(event) => {
            event.preventDefault();
            void saveUser();
          }}>
            <label>
              <span>Role</span>
              <select value={selectedUser.role} onChange={(event) => patchSelectedUser({ role: event.target.value as AdminUser['role'] })}>
                <option value="COLABORADOR">COLABORADOR</option>
                <option value="MANAGER">MANAGER</option>
                <option value="COORDENADOR">COORDENADOR</option>
                <option value="ADMIN">ADMIN</option>
                <option value="CONVIDADO">CONVIDADO</option>
              </select>
            </label>

            <label>
              <span>Equipa</span>
              <select
                value={selectedUser.teamId || ''}
                disabled={selectedUser.role === 'ADMIN'}
                onChange={(event) => patchSelectedUser({ teamId: event.target.value || null, teamName: teams.find((team) => team.id === event.target.value)?.name || null })}
              >
                <option value="">Sem equipa</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>

            <div className="field-span-2">
              <span style={{ fontWeight: 700, color: '#123f86' }}>Participação em equipas/subequipas</span>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {membershipsDraft.map((membership) => {
                  const team = teams.find((item) => item.id === membership.teamId);

                  return (
                    <article key={membership.teamId} className="trainings-mobile-card" style={{ padding: 10 }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={membership.isActive}
                          onChange={(event) => patchMembership(membership.teamId, { isActive: event.target.checked })}
                        />
                        <strong>{team?.name || membership.teamId}</strong>
                      </label>

                      {membership.isActive && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                          <label>
                            <span>Tipo</span>
                            <select
                              value={membership.membershipRole}
                              onChange={(event) => patchMembership(membership.teamId, { membershipRole: event.target.value })}
                            >
                              <option value="PARTICIPANT">Participante</option>
                              <option value="MANAGER">Chefia</option>
                            </select>
                          </label>

                          <label>
                            <span>Aprovador</span>
                            <select
                              value={membership.isApprover ? 'yes' : 'no'}
                              onChange={(event) => patchMembership(membership.teamId, { isApprover: event.target.value === 'yes' })}
                            >
                              <option value="no">Não</option>
                              <option value="yes">Sim</option>
                            </select>
                          </label>

                          <label>
                            <span>Linha aprovação</span>
                            <input
                              type="number"
                              min={1}
                              value={membership.approvalLevel ?? 1}
                              disabled={!membership.isApprover}
                              onChange={(event) => patchMembership(membership.teamId, { approvalLevel: Number(event.target.value || '1') })}
                            />
                          </label>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>

            <label>
              <span>País de trabalho</span>
              <select value={selectedUser.workCountry} onChange={(event) => patchSelectedUser({ workCountry: event.target.value as 'PT' | 'BR' })}>
                <option value="PT">Portugal</option>
                <option value="BR">Brasil</option>
              </select>
            </label>

            <label>
              <span>Localidade</span>
              <input
                type="text"
                value={selectedUser.localidade}
                onChange={(event) => patchSelectedUser({ localidade: event.target.value })}
                placeholder="Porto"
              />
            </label>

            <div className="trainings-form-actions field-span-2">
              <button type="submit" className="cta-button cta-primary" disabled={isSaving}>{isSaving ? 'A guardar...' : 'Guardar alterações'}</button>
            </div>
          </form>
        </section>
      )}

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}