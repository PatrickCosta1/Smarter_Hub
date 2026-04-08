import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatMembershipRoleLabel, formatRoleLabel } from '../portal/labels';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';

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
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [membershipsDraft, setMembershipsDraft] = useState<MembershipDraft[]>([]);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_TEAM_DRAFT);
  const [userQuery, setUserQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | AdminUser['role']>('ALL');
  const [sortBy, setSortBy] = useState<'username' | 'email' | 'role' | 'teamName'>('username');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);

  const PAGE_SIZE = 8;

  const selectedUser = useMemo(
    () => users.find((item) => item.id === selectedUserId) || null,
    [users, selectedUserId],
  );

  const filteredUsers = useMemo(() => {
    const normalizedQuery = userQuery.trim().toLowerCase();

    return users
      .filter((item) => (roleFilter === 'ALL' ? true : item.role === roleFilter))
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }

        return [item.username, item.email, item.teamName ?? '', formatRoleLabel(item.role)]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aValue = String((a[sortBy] ?? '')).toLowerCase();
        const bValue = String((b[sortBy] ?? '')).toLowerCase();
        const comparison = aValue.localeCompare(bValue, 'pt-PT');
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [users, roleFilter, userQuery, sortBy, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));

  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredUsers.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredUsers, currentPage]);

  const userColumns = useMemo(
    () => [
      { key: 'username', header: 'Utilizador', render: (item: AdminUser) => item.username },
      { key: 'email', header: 'Email', render: (item: AdminUser) => item.email },
      {
        key: 'role',
        header: 'Role',
        render: (item: AdminUser) => <Badge tone="info">{formatRoleLabel(item.role)}</Badge>,
      },
      { key: 'teamName', header: 'Equipa', render: (item: AdminUser) => item.teamName || '-' },
      {
        key: 'country',
        header: 'País',
        render: (item: AdminUser) => <Badge tone="neutral">{item.workCountry}</Badge>,
      },
    ],
    [],
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

  useEffect(() => {
    setCurrentPage(1);
  }, [userQuery, roleFilter, sortBy, sortDirection]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  async function loadData() {
    setIsLoadingData(true);
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
    } finally {
      setIsLoadingData(false);
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, width: 'min(920px, 100%)' }}>
            <label>
              <span>Pesquisar</span>
              <input type="search" value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Nome, email, equipa..." />
            </label>
            <label>
              <span>Perfil</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'ALL' | AdminUser['role'])}>
                <option value="ALL">Todos</option>
                <option value="COLABORADOR">{formatRoleLabel('COLABORADOR')}</option>
                <option value="MANAGER">{formatRoleLabel('MANAGER')}</option>
                <option value="COORDENADOR">{formatRoleLabel('COORDENADOR')}</option>
                <option value="ADMIN">{formatRoleLabel('ADMIN')}</option>
                <option value="CONVIDADO">{formatRoleLabel('CONVIDADO')}</option>
              </select>
            </label>
            <label>
              <span>Ordenar por</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'username' | 'email' | 'role' | 'teamName')}>
                <option value="username">Nome de utilizador</option>
                <option value="email">Email</option>
                <option value="role">Perfil</option>
                <option value="teamName">Equipa</option>
              </select>
            </label>
            <label>
              <span>Direção</span>
              <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}>
                <option value="asc">A-Z</option>
                <option value="desc">Z-A</option>
              </select>
            </label>
          </div>
        </div>

        <DataTable
          columns={userColumns}
          rows={paginatedUsers}
          rowKey={(item) => item.id}
          emptyMessage="Sem utilizadores para os filtros aplicados."
          loading={isLoadingData}
          loadingLines={3}
          ariaLabel="Utilizadores"
          selectedRowKey={selectedUserId || null}
          onRowClick={(item) => setSelectedUserId(item.id)}
        />

        <div className="trainings-form-actions" style={{ justifyContent: 'space-between' }}>
          <small>Página {currentPage} de {totalPages} · {filteredUsers.length} resultado(s)</small>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" variant="ghost" onClick={() => setCurrentPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}>Anterior</Button>
            <Button type="button" variant="ghost" onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages}>Seguinte</Button>
          </div>
        </div>
      </section>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>Equipas</h3>
          <Button type="button" variant="ghost" onClick={resetTeamDraft}>Nova equipa</Button>
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
            <Button type="submit" variant="primary" isLoading={isSaving}>{isSaving ? 'A guardar...' : 'Guardar equipa'}</Button>
            <Button type="button" variant="ghost" onClick={resetTeamDraft}>Limpar</Button>
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
                <Button type="button" variant="secondary" size="sm" onClick={() => beginTeamEdit(team)}>Editar</Button>
                <Button type="button" variant="danger" size="sm" onClick={() => void deleteTeam(team.id)}>Remover</Button>
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
                <option value="COLABORADOR">{formatRoleLabel('COLABORADOR')}</option>
                <option value="MANAGER">{formatRoleLabel('MANAGER')}</option>
                <option value="COORDENADOR">{formatRoleLabel('COORDENADOR')}</option>
                <option value="ADMIN">{formatRoleLabel('ADMIN')}</option>
                <option value="CONVIDADO">{formatRoleLabel('CONVIDADO')}</option>
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
                              <option value="PARTICIPANT">{formatMembershipRoleLabel('PARTICIPANT')}</option>
                              <option value="MANAGER">{formatMembershipRoleLabel('MANAGER')}</option>
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
              <Button type="submit" variant="primary" isLoading={isSaving}>{isSaving ? 'A guardar...' : 'Guardar alterações'}</Button>
            </div>
          </form>
        </section>
      )}

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}