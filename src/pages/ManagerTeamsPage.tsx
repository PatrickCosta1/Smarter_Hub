import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatRoleLabel } from '../portal/labels';
import Skeleton from '../components/ui/Skeleton';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Toast from '../components/ui/Toast';

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
    nomeAbreviado?: string;
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
  leaderId?: string | null;
  leader?: {
    id: string;
    username: string;
    profile?: {
      nomeAbreviado?: string;
      primeiroNome?: string;
      apelido?: string;
    } | null;
  } | null;
  manager?: {
    id: string;
    username: string;
    profile?: {
      nomeAbreviado?: string;
      primeiroNome?: string;
      apelido?: string;
    } | null;
  } | null;
  coordinator?: {
    id: string;
    username: string;
    profile?: {
      nomeAbreviado?: string;
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

type CollaboratorOption = {
  id: string;
  username: string;
  email?: string;
  role?: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  isActive?: boolean;
  profile?: {
    nomeAbreviado?: string;
    primeiroNome?: string;
    apelido?: string;
  } | null;
  teamMemberships?: Array<{
    teamId: string;
    membershipRole?: string;
  }>;
};

type CollaboratorsResponse = {
  rows: CollaboratorOption[];
};

type TeamDraft = {
  name: string;
  country: 'PT' | 'BR';
  leaderId: string;
  memberIds: string[];
  parentTeamId: string;
};

const EMPTY_TEAM_DRAFT: TeamDraft = {
  name: '',
  country: 'PT',
  leaderId: '',
  memberIds: [],
  parentTeamId: '',
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

function getProfileDisplayName(input: {
  username: string;
  profile?: { nomeAbreviado?: string; primeiroNome?: string; apelido?: string } | null;
}) {
  const short = input.profile?.nomeAbreviado?.trim() || '';
  if (short) {
    return short;
  }

  const first = input.profile?.primeiroNome?.trim() || '';
  const last = input.profile?.apelido?.trim() || '';
  const fullName = `${first} ${last}`.trim();
  return fullName || input.username;
}

function formatPerson(member: TeamMember) {
  return getProfileDisplayName({ username: member.username, profile: member.profile });
}

function isFutureOrCurrentVacation(vacation: TeamVacation) {
  const today = new Date();
  const endDate = new Date(`${vacation.dataFim}T23:59:59`);
  return endDate.getTime() >= today.getTime();
}

export default function ManagerTeamsPage() {
  const { hasPermission, isRootAccess, isAccessTotal } = usePortal();
  const canManageAllTeams = isRootAccess || isAccessTotal;
  const canManageTeamMembers = isRootAccess || hasPermission('manage_team_members');
  const canCreateTeam = isRootAccess || hasPermission('create_team');
  const canEditTeam = canManageAllTeams || hasPermission('edit_team');
  const canDeleteTeam = canManageAllTeams || hasPermission('delete_team');
  const canAccessTeams = isRootAccess || hasPermission('view_teams') || canManageTeamMembers;
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedTeamDetail, setSelectedTeamDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [status, setStatus] = useState('');
  const [teamModalTab, setTeamModalTab] = useState<'overview' | 'vacations'>('overview');
  const [isNewTeamModalOpen, setIsNewTeamModalOpen] = useState(false);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_TEAM_DRAFT);
  const [leaderOptions, setLeaderOptions] = useState<CollaboratorOption[]>([]);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'leader' | 'members'>('leader');
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerRole, setPickerRole] = useState<'ALL' | 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN'>('ALL');
  const [isManageTeamModalOpen, setIsManageTeamModalOpen] = useState(false);
  const [isDeletingTeam, setIsDeletingTeam] = useState(false);
  const [isDeleteTeamConfirmOpen, setIsDeleteTeamConfirmOpen] = useState(false);
  const [manageQuery, setManageQuery] = useState('');

  const selectedTeamSummary = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) || null,
    [teams, selectedTeamId],
  );

  const selectedTeam = selectedTeamDetail || selectedTeamSummary;
  const selectedTeamMembers = selectedTeamDetail?.members || [];

  useEffect(() => {
    if (!canAccessTeams) {
      return;
    }

    void loadTeams();
  }, [canAccessTeams]);

  useEffect(() => {
    setTeamModalTab('overview');
    setSelectedTeamDetail(null);

    if (!selectedTeamId) {
      return;
    }

    void loadTeamDetail(selectedTeamId);
  }, [selectedTeamId]);

  useEffect(() => {
    if (!status) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStatus('');
    }, 3600);

    return () => window.clearTimeout(timeoutId);
  }, [status]);

  async function loadTeams() {
    setLoading(true);
    setStatus('');

    try {
      const data = await apiRequestCached<TeamSummary[]>('/teams/me?details=none', {
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
      const data = await apiRequestCached<TeamDetail>(`/teams/me/${teamId}`, {
        headers: getAuthHeaders(),
      }, 45000);
      setSelectedTeamDetail(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar detalhe da equipa.');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function loadLeaderOptions() {
    try {
      const data = await apiRequestCached<CollaboratorsResponse>('/users/collaborators?page=1&pageSize=250&sortBy=username&sortDirection=asc', {
        headers: getAuthHeaders(),
      }, 10000, true);
      setLeaderOptions((data.rows || []).filter((item) => item.username !== 't.people' && item.isActive !== false));
    } catch {
      setLeaderOptions([]);
    }
  }

  function openManageTeamModal() {
    if (!selectedTeam) {
      return;
    }

    setTeamDraft({
      name: selectedTeam.name,
      country: selectedTeam.country,
      leaderId: selectedTeam.leaderId || selectedTeam.manager?.id || selectedTeam.coordinator?.id || '',
      memberIds: selectedTeamMembers.map((member) => member.id),
      parentTeamId: selectedTeam.parentTeam?.id || '',
    });
    setManageQuery('');
    setIsManageTeamModalOpen(true);
    void loadLeaderOptions();
  }

  async function updateTeam() {
    if (!selectedTeam || !teamDraft.name.trim()) {
      setStatus('Indica o nome da equipa.');
      return;
    }

    const nextName = teamDraft.name.trim();
    const nextLeaderId = teamDraft.leaderId || '';
    const currentLeaderId = selectedTeam.leaderId || selectedTeam.manager?.id || selectedTeam.coordinator?.id || '';
    const hasBasicChanges = nextName !== selectedTeam.name
      || teamDraft.country !== selectedTeam.country
      || nextLeaderId !== currentLeaderId;

    const currentMemberIds = new Set(selectedTeamMembers.map((member) => member.id));
    const nextMemberIds = new Set(teamDraft.memberIds.filter((id) => id && id !== teamDraft.leaderId));
    const toAdd = Array.from(nextMemberIds).filter((id) => !currentMemberIds.has(id));
    const toRemove = Array.from(currentMemberIds).filter((id) => !nextMemberIds.has(id));
    const hasMemberChanges = toAdd.length > 0 || toRemove.length > 0;

    if (hasBasicChanges && !canEditTeam) {
      setStatus('Não tens permissão para editar os dados da equipa.');
      return;
    }

    if (hasMemberChanges && !canManageTeamMembers) {
      setStatus('Não tens permissão para gerir membros desta equipa.');
      return;
    }

    if (!hasBasicChanges && !hasMemberChanges) {
      setStatus('Não existem alterações para guardar.');
      return;
    }

    setIsSavingTeam(true);
    try {
      if (hasBasicChanges) {
        await apiRequest(`/admin/teams/${selectedTeam.id}`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            name: nextName,
            country: teamDraft.country,
            leaderId: teamDraft.leaderId || null,
            parentTeamId: selectedTeam.parentTeam?.id || null,
          }),
        });
      }

      if (hasMemberChanges) {
        for (const userId of toAdd) {
          await setMemberInSelectedTeam(userId, true, { silentStatus: true, skipRefresh: true });
        }

        for (const userId of toRemove) {
          await setMemberInSelectedTeam(userId, false, { silentStatus: true, skipRefresh: true });
        }
      }

      clearApiCache('/teams');
      clearApiCache('/admin/teams');
      await loadTeams();
      if (selectedTeamId) {
        await loadTeamDetail(selectedTeamId);
      }
      await loadLeaderOptions();
      setIsManageTeamModalOpen(false);
      setStatus('Equipa atualizada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar equipa.');
    } finally {
      setIsSavingTeam(false);
    }
  }

  async function deleteSelectedTeam() {
    if (!selectedTeam) {
      return;
    }

    setIsDeletingTeam(true);
    try {
      await apiRequest(`/admin/teams/${selectedTeam.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      clearApiCache('/teams');
      clearApiCache('/admin/teams');
      await loadTeams();
      setIsDeleteTeamConfirmOpen(false);
      setIsManageTeamModalOpen(false);
      setSelectedTeamId(null);
      setStatus('Equipa removida com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao remover equipa.');
    } finally {
      setIsDeletingTeam(false);
    }
  }

  async function setMemberInSelectedTeam(
    userId: string,
    shouldBeMember: boolean,
    options?: { silentStatus?: boolean; skipRefresh?: boolean },
  ) {
    if (!selectedTeam) {
      return;
    }

    const targetUser = leaderOptions.find((item) => item.id === userId);
    if (!targetUser) {
      setStatus('Colaborador não encontrado para atualização da equipa.');
      return;
    }

    const currentMemberships = (targetUser.teamMemberships || []).map((membership) => ({
      teamId: membership.teamId,
      membershipRole: membership.membershipRole || 'PARTICIPANT',
      isActive: true,
    }));

    const hasTeam = currentMemberships.some((membership) => membership.teamId === selectedTeam.id);
    const nextMemberships = shouldBeMember
      ? (hasTeam
        ? currentMemberships
        : [...currentMemberships, {
            teamId: selectedTeam.id,
            membershipRole: 'PARTICIPANT',
            isActive: true,
          }])
      : currentMemberships.filter((membership) => membership.teamId !== selectedTeam.id);

    const hasChanged = shouldBeMember ? !hasTeam : hasTeam;
    if (!hasChanged) {
      return;
    }

    try {
      await apiRequest(`/admin/users/${userId}/memberships`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ memberships: nextMemberships }),
      });

      if (options?.skipRefresh) {
        return;
      }

      clearApiCache('/teams');
      clearApiCache('/users/collaborators');
      if (selectedTeamId) {
        await loadTeamDetail(selectedTeamId);
      }
      await loadLeaderOptions();
      if (!options?.silentStatus) {
        setStatus(shouldBeMember ? 'Membro adicionado à equipa.' : 'Membro removido da equipa.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar membros da equipa.');
    }
  }

  function openNewTeamModal() {
    setTeamDraft(EMPTY_TEAM_DRAFT);
    setIsNewTeamModalOpen(true);
    void loadLeaderOptions();
  }

  const selectedLeader = useMemo(
    () => leaderOptions.find((user) => user.id === teamDraft.leaderId) || null,
    [leaderOptions, teamDraft.leaderId],
  );

  const selectedMembers = useMemo(
    () => leaderOptions.filter((user) => teamDraft.memberIds.includes(user.id)),
    [leaderOptions, teamDraft.memberIds],
  );

  const filteredPickerOptions = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    return leaderOptions
      .filter((user) => (pickerRole === 'ALL' ? true : user.role === pickerRole))
      .filter((user) => {
        if (!query) {
          return true;
        }
        return [getProfileDisplayName(user), user.username, user.email ?? '']
            .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .filter((user) => (pickerMode === 'members' ? user.id !== teamDraft.leaderId : true));
  }, [leaderOptions, pickerMode, pickerQuery, pickerRole, teamDraft.leaderId]);

  const availableMembersToManage = useMemo(() => {
    const query = manageQuery.trim().toLowerCase();

    if (query.length < 2) {
      return [];
    }

    return leaderOptions
      .filter((user) => user.id !== teamDraft.leaderId)
      .filter((user) => !teamDraft.memberIds.includes(user.id))
      .filter((user) => {
        return [getProfileDisplayName(user), user.email ?? '']
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 12);
  }, [leaderOptions, manageQuery, teamDraft.leaderId, teamDraft.memberIds]);

  function openPicker(mode: 'leader' | 'members') {
    setPickerMode(mode);
    setPickerQuery('');
    setPickerRole('ALL');
    setIsPickerOpen(true);
  }

  function selectLeader(userId: string) {
    setTeamDraft((current) => ({
      ...current,
      leaderId: userId,
      memberIds: current.memberIds.filter((id) => id !== userId),
    }));
    setIsPickerOpen(false);
  }

  function toggleMember(userId: string) {
    if (userId === teamDraft.leaderId) {
      return;
    }

    setTeamDraft((current) => ({
      ...current,
      memberIds: current.memberIds.includes(userId)
        ? current.memberIds.filter((id) => id !== userId)
        : [...current.memberIds, userId],
    }));
  }

  async function saveTeam() {
    if (!teamDraft.name.trim()) {
      setStatus('Indica o nome da equipa.');
      return;
    }

    if (teamDraft.leaderId && teamDraft.memberIds.includes(teamDraft.leaderId)) {
      setStatus('Uma pessoa não pode ser chefe e membro participante ao mesmo tempo.');
      return;
    }

    setIsSavingTeam(true);
    try {
      await apiRequest('/admin/teams', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: teamDraft.name.trim(),
          country: teamDraft.country,
          leaderId: teamDraft.leaderId || null,
          memberIds: teamDraft.memberIds,
          parentTeamId: teamDraft.parentTeamId || null,
        }),
      });

      clearApiCache('/teams');
      clearApiCache('/admin/teams');
      setIsNewTeamModalOpen(false);
      setTeamDraft(EMPTY_TEAM_DRAFT);
      await loadTeams();
      setStatus('Equipa criada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao criar equipa.');
    } finally {
      setIsSavingTeam(false);
    }
  }

  if (!canAccessTeams) {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área não está disponível para convidados.</p>
        </article>
      </section>
    );
  }

  const heroTitle = canManageTeamMembers ? 'Visão transversal de equipas' : 'As tuas equipas';

  const heroDescription = canManageTeamMembers
    ? 'Consulta equipas, membros e pedidos de férias/ausências.'
    : 'Consulta equipas, membros e próximas ausências num único painel.';

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
            const phaseLabel = vacation.dataInicio > todayIso ? 'Sai em' : 'Em férias até';

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

  const statusTone = useMemo<'success' | 'error' | 'info'>(() => {
    const normalized = status.toLowerCase();
    if (normalized.includes('falha') || normalized.includes('erro') || normalized.includes('não')) {
      return 'error';
    }
    if (normalized.includes('sucesso') || normalized.includes('adicionado') || normalized.includes('removido') || normalized.includes('atualizada') || normalized.includes('concedido') || normalized.includes('revogado')) {
      return 'success';
    }
    return 'info';
  }, [status]);

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
            <span>Equipas visíveis</span>
            <strong>{teams.length}</strong>
          </article>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <h3>{canManageTeamMembers ? 'As equipas' : 'As tuas equipas'}</h3>
          {canCreateTeam && (
            <Button type="button" variant="primary" className="team-create-btn" onClick={openNewTeamModal}>Nova equipa</Button>
          )}
        </div>

        <div className="manager-teams-grid" aria-label="Lista de equipas">
          {loading && (
            <article className="trainings-mobile-card">
              <Skeleton lines={3} />
            </article>
          )}
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
                Visão geral
              </button>
              <button type="button" className={`notification-filter${teamModalTab === 'vacations' ? ' is-active' : ''}`} onClick={() => setTeamModalTab('vacations')}>
                Férias da equipa
              </button>
            </div>

            {loadingDetail && (
              <article className="trainings-mobile-card">
                <Skeleton lines={5} />
              </article>
            )}

            {!loadingDetail && teamModalTab === 'overview' && (
              <>
                {(canEditTeam || canDeleteTeam || canManageTeamMembers) && (
                  <div className="team-overview-head">
                    <div>
                      <p className="team-overview-head__kicker">Gestão da equipa</p>
                      <strong>Altera o nome, chefe, membros e estrutura num único painel.</strong>
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      className="team-manage-btn"
                      onClick={openManageTeamModal}
                    >
                      Gerir
                    </Button>
                  </div>
                )}

                <div className="team-overview-metrics">
                  <article>
                    <span>Chefe de equipa</span>
                    <strong>{selectedTeam.manager ? getProfileDisplayName(selectedTeam.manager) : selectedTeam.coordinator ? getProfileDisplayName(selectedTeam.coordinator) : '-'}</strong>
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
                {upcomingVacations.length === 0 && <p>Sem férias futuras ou em curso neste momento.</p>}

                {upcomingVacations.map((item) => (
                  <article key={item.vacation.id} className="manager-team-vacation-item manager-team-vacation-item--wide">
                    <div>
                      <strong>{formatPerson(item.member)}</strong>
                      <span>{item.phaseLabel} {item.startLabel}{item.phaseLabel === 'Em férias até' ? '' : ` · Até ${item.endLabel}`}</span>
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

      <Modal
        open={isNewTeamModalOpen}
        title="Nova equipa"
        onClose={() => setIsNewTeamModalOpen(false)}
        width="min(760px, 94vw)"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <Button type="button" variant="ghost" onClick={() => setIsNewTeamModalOpen(false)}>Cancelar</Button>
            <Button type="button" variant="primary" isLoading={isSavingTeam} onClick={() => void saveTeam()}>Criar equipa</Button>
          </div>
        }
      >
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
            <span>Chefe de equipa</span>
            <div className="team-picker-inline">
              <button type="button" className="cta-button cta-secondary" onClick={() => openPicker('leader')}>Escolher</button>
              <strong>{selectedLeader ? getProfileDisplayName(selectedLeader) : 'Sem chefe selecionado'}</strong>
            </div>
          </label>

          <label>
            <span>Membros participantes</span>
            <div className="team-picker-inline">
              <button type="button" className="cta-button cta-secondary" onClick={() => openPicker('members')}>Escolher</button>
              <strong>{selectedMembers.length} selecionado(s)</strong>
            </div>
            {selectedMembers.length > 0 && (
              <div className="team-member-chip-list">
                {selectedMembers.map((member) => (
                  <button key={member.id} type="button" className="team-member-chip" onClick={() => toggleMember(member.id)}>
                    {getProfileDisplayName(member)} ×
                  </button>
                ))}
              </div>
            )}
          </label>

          <label>
            <span>Subequipa de</span>
            <select value={teamDraft.parentTeamId} onChange={(event) => setTeamDraft((current) => ({ ...current, parentTeamId: event.target.value }))}>
              <option value="">Sem equipa-mãe</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
        </form>
      </Modal>

      <Modal
        open={isPickerOpen}
        title={pickerMode === 'leader' ? 'Escolher chefe de equipa' : 'Escolher membros participantes'}
        onClose={() => setIsPickerOpen(false)}
        width="min(980px, 96vw)"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <small>{filteredPickerOptions.length} resultado(s)</small>
            <Button type="button" variant="ghost" onClick={() => setIsPickerOpen(false)}>Fechar</Button>
          </div>
        }
      >
        <div className="team-picker-toolbar">
          <label>
            <span>Pesquisar</span>
            <input type="search" value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="Nome, username, email..." />
          </label>
          <label>
            <span>Perfil</span>
            <select value={pickerRole} onChange={(event) => setPickerRole(event.target.value as 'ALL' | 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN')}>
              <option value="ALL">Todos</option>
              <option value="COLABORADOR">{formatRoleLabel('COLABORADOR')}</option>
              <option value="MANAGER">{formatRoleLabel('MANAGER')}</option>
              <option value="COORDENADOR">{formatRoleLabel('COORDENADOR')}</option>
              <option value="ADMIN">{formatRoleLabel('ADMIN')}</option>
            </select>
          </label>
        </div>

        <div className="team-picker-list">
          {filteredPickerOptions.length === 0 && <p>Sem colaboradores para os filtros aplicados.</p>}
          {filteredPickerOptions.map((user) => {
            const isSelected = pickerMode === 'leader'
              ? teamDraft.leaderId === user.id
              : teamDraft.memberIds.includes(user.id);

            return (
              <article key={user.id} className={`team-picker-item${isSelected ? ' is-selected' : ''}`}>
                <div>
                  <strong>{getProfileDisplayName(user)}</strong>
                  <span>{user.email || user.username}</span>
                </div>
                {pickerMode === 'leader' ? (
                  <Button type="button" size="sm" variant={isSelected ? 'secondary' : 'primary'} onClick={() => selectLeader(user.id)}>
                    {isSelected ? 'Selecionado' : 'Escolher'}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant={isSelected ? 'secondary' : 'ghost'} onClick={() => toggleMember(user.id)}>
                    {isSelected ? 'Remover' : 'Adicionar'}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={isManageTeamModalOpen}
        title="Gerir equipa"
        onClose={() => setIsManageTeamModalOpen(false)}
        width="min(1040px, 96vw)"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12, flexWrap: 'wrap' }}>
            <Button type="button" variant="ghost" onClick={() => setIsManageTeamModalOpen(false)}>Cancelar</Button>
            {(canEditTeam || canManageTeamMembers) && (
              <Button type="button" variant="primary" isLoading={isSavingTeam} onClick={() => void updateTeam()}>Guardar alterações</Button>
            )}
          </div>
        }
      >
        <form className="team-manage-layout" onSubmit={(event) => { event.preventDefault(); void updateTeam(); }}>
          <section className="team-manage-panel">
            <header>
              <h4>Dados da equipa</h4>
              <p>Edita rapidamente o essencial da equipa.</p>
            </header>

            <label>
              <span>Nome da equipa</span>
              <input
                type="text"
                value={teamDraft.name}
                disabled={!canEditTeam}
                onChange={(event) => setTeamDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </label>

            <label>
              <span>País</span>
              <select
                value={teamDraft.country}
                disabled={!canEditTeam}
                onChange={(event) => setTeamDraft((current) => ({ ...current, country: event.target.value as 'PT' | 'BR' }))}
              >
                <option value="PT">Portugal</option>
                <option value="BR">Brasil</option>
              </select>
            </label>

            <label>
              <span>Chefe de equipa</span>
              <select
                value={teamDraft.leaderId}
                disabled={!canEditTeam}
                onChange={(event) => setTeamDraft((current) => ({ ...current, leaderId: event.target.value }))}
              >
                <option value="">Sem chefe</option>
                {leaderOptions.map((user) => (
                  <option key={user.id} value={user.id}>{getProfileDisplayName(user)}</option>
                ))}
              </select>
            </label>

            <p className="team-manage-panel__hint">
              Membros selecionados: <strong>{teamDraft.memberIds.filter((id) => id !== teamDraft.leaderId).length}</strong>
            </p>
          </section>

          <section className="team-manage-panel">
            <header>
              <h4>Membros da equipa</h4>
              <p>Adiciona ou remove pessoas de forma imediata.</p>
            </header>

            <label>
              <span>Pesquisar por nome ou email</span>
              <input
                type="search"
                value={manageQuery}
                onChange={(event) => setManageQuery(event.target.value)}
              />
            </label>

            {manageQuery.trim().length < 2 && (
              <p className="team-manage-search-state">Escreve pelo menos 2 caracteres para começar a pesquisa.</p>
            )}

            {manageQuery.trim().length >= 2 && (
              <div className="team-manage-members-list">
                {availableMembersToManage.length === 0 && <p className="team-manage-search-state">Sem resultados para a pesquisa atual.</p>}
                {availableMembersToManage.map((user) => (
                  <article key={user.id} className="team-picker-item">
                    <div>
                      <strong>{getProfileDisplayName(user)}</strong>
                      <span>{user.email || user.username}</span>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!canManageTeamMembers}
                      onClick={() => toggleMember(user.id)}
                    >
                      Adicionar
                    </Button>
                  </article>
                ))}
              </div>
            )}

            {teamDraft.memberIds.filter((id) => id !== teamDraft.leaderId).length > 0 && (
              <div className="team-member-chip-list">
                {leaderOptions
                  .filter((user) => teamDraft.memberIds.includes(user.id) && user.id !== teamDraft.leaderId)
                  .map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      className="team-member-chip"
                      disabled={!canManageTeamMembers}
                      onClick={() => toggleMember(member.id)}
                    >
                      {getProfileDisplayName(member)} ×
                    </button>
                  ))}
              </div>
            )}
          </section>

          {canDeleteTeam && (
            <section className="team-manage-panel team-manage-panel--danger">
              <header>
                <h4>Zona de risco</h4>
                <p>Remove a equipa se já não fizer sentido manter esta estrutura.</p>
              </header>

              <Button
                type="button"
                variant="danger"
                size="sm"
                isLoading={isDeletingTeam}
                onClick={() => setIsDeleteTeamConfirmOpen(true)}
              >
                Remover equipa
              </Button>
            </section>
          )}
        </form>
      </Modal>

      <Modal
        open={isDeleteTeamConfirmOpen}
        title="Confirmar remoção"
        onClose={() => setIsDeleteTeamConfirmOpen(false)}
        width="min(520px, 92vw)"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <Button type="button" variant="ghost" onClick={() => setIsDeleteTeamConfirmOpen(false)}>Cancelar</Button>
            <Button type="button" variant="danger" isLoading={isDeletingTeam} onClick={() => void deleteSelectedTeam()}>Sim, remover equipa</Button>
          </div>
        }
      >
        <p>
          Tens a certeza de que queres remover a equipa <strong>{selectedTeam?.name || ''}</strong>? Esta ação não pode ser anulada.
        </p>
      </Modal>

      <div className="team-page-toast" aria-live="polite">
        <Toast show={Boolean(status)} tone={statusTone} message={status} />
      </div>
    </section>
  );
}
