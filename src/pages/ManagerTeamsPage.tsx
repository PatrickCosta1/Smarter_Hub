import { Fragment, type CSSProperties, useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, isAbortError } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatRoleLabel } from '../portal/labels';
import Skeleton from '../components/ui/Skeleton';
import LoadingInline from '../components/ui/LoadingInline';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
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
    nomeCompleto?: string;
    dataNascimento?: string;
    cargo?: string;
    funcao?: string;
  } | null;
  vacations: TeamVacation[];
};

type TeamSpecialCalendarPayload = {
  year: number;
  country: 'PT' | 'BR';
  holidays: string[];
  weekendDays: string[];
  extraDays: string[];
  extraDayDetails?: Array<{ date: string; label: string }>;
};

type TeamBirthdayEntry = {
  memberId: string;
  memberName: string;
  email: string;
  roleLabel: string;
  nextBirthdayIso: string;
  observedBirthdayIso: string;
  daysUntil: number;
  isToday: boolean;
};

const TEAM_COLORS = [
  '#4B79F5', '#8B5CF6', '#EC4899', '#EF4444', '#F97316',
  '#EAB308', '#22C55E', '#06B6D4', '#14B8A6', '#6B7280',
  '#1E40AF', '#7C3AED',
];

const MONTH_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

type TeamSummary = {
  id: string;
  name: string;
  costCenter?: string | null;
  color?: string | null;
  leaderId?: string | null;
  leader?: {
    id: string;
    username: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
  manager?: {
    id: string;
    username: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
  coordinator?: {
    id: string;
    username: string;
    profile?: {
      nomeAbreviado?: string;
      nomeCompleto?: string;
    } | null;
  } | null;
  parentTeam?: { id: string; name: string } | null;
  _count?: { members: number; memberships: number };
};

type TeamDetail = TeamSummary & {
  members: TeamMember[];
};

type TeamCalendarPerson = TeamMember & {
  isTeamLeader?: boolean;
};

type CollaboratorOption = {
  id: string;
  username: string;
  email?: string;
  role?: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  isActive?: boolean;
  profile?: {
    nomeAbreviado?: string;
    nomeCompleto?: string;
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
  leaderId: string;
  memberIds: string[];
  parentTeamId: string;
  costCenter: string;
  color: string;
};

const EMPTY_TEAM_DRAFT: TeamDraft = {
  name: '',
  leaderId: '',
  memberIds: [],
  parentTeamId: '',
  costCenter: '',
  color: '#4B79F5',
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

function getLocalIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
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

function getIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayISO(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getObservedBirthdayIso(rawDate: string | undefined, year: number, holidays: Set<string>) {
  if (!rawDate) {
    return '';
  }

  const [, monthRaw, dayRaw] = rawDate.split('-');
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!month || !day) {
    return '';
  }

  const birthdayDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`);
  if (Number.isNaN(birthdayDate.getTime())) {
    return '';
  }

  const birthdayIso = dayISO(year, month - 1, day);
  if (birthdayDate.getDay() !== 0 && birthdayDate.getDay() !== 6 && !holidays.has(birthdayIso)) {
    return birthdayIso;
  }

  const candidate = new Date(birthdayDate);
  while (true) {
    candidate.setDate(candidate.getDate() + 1);
    const dayOfWeek = candidate.getDay();
    const iso = dayISO(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(iso)) {
      return iso;
    }
  }
}

function clipRangeToMonth(startIso: string, endIso: string, monthStartIso: string, monthEndIso: string) {
  const start = startIso > monthStartIso ? startIso : monthStartIso;
  const end = endIso < monthEndIso ? endIso : monthEndIso;

  if (start > end) {
    return null;
  }

  return { start, end };
}

function enumerateIsoDates(startIso: string, endIso: string) {
  const days: string[] = [];
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);

  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    days.push(getIsoDate(current));
  }

  return days;
}

function getProfileDisplayName(input: {
  username: string;
  profile?: { nomeAbreviado?: string; nomeCompleto?: string } | null;
}) {
  const short = input.profile?.nomeAbreviado?.trim() || '';
  if (short) {
    return short;
  }

  const fullName = input.profile?.nomeCompleto?.trim() || '';
  return fullName || input.username;
}

function formatPerson(member: TeamMember) {
  return getProfileDisplayName({ username: member.username, profile: member.profile });
}

export default function ManagerTeamsPage() {
  const { hasPermission, isRootAccess, isAccessTotal, currentUser } = usePortal();
  const canViewCostCenter = isRootAccess || isAccessTotal;
  const canManageAllTeams = isRootAccess || isAccessTotal;
  const canManageTeamMembers = isRootAccess || hasPermission('manage_team_members');
  const canCreateTeam = isRootAccess || hasPermission('create_team');
  const canEditTeam = canManageAllTeams || hasPermission('edit_team');
  const canDeleteTeam = canManageAllTeams || hasPermission('delete_team');
  const canAccessTeams = (currentUser?.role ?? '') !== 'CONVIDADO';
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamDetailsById, setTeamDetailsById] = useState<Record<string, TeamDetail>>({});
  const [loading, setLoading] = useState(false);
  const [loadingDetailTeamId, setLoadingDetailTeamId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [teamModalTab, setTeamModalTab] = useState<'overview' | 'vacations' | 'birthdays'>('overview');
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
  const [teamSearchQuery, setTeamSearchQuery] = useState('');
  const [vacationsMonthCursor, setVacationsMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState('');
  const [compareSelectedMemberIds, setCompareSelectedMemberIds] = useState<string[]>([]);
  const [teamSpecialCalendar, setTeamSpecialCalendar] = useState<TeamSpecialCalendarPayload | null>(null);
  const [isLoadingTeamSpecialCalendar, setIsLoadingTeamSpecialCalendar] = useState(false);

  const selectedTeamSummary = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) || null,
    [teams, selectedTeamId],
  );

  const selectedTeamDetail = selectedTeamId ? teamDetailsById[selectedTeamId] || null : null;
  const selectedTeam = selectedTeamDetail || selectedTeamSummary;
  const selectedTeamMembers = selectedTeamDetail?.members || [];

  useEffect(() => {
    if (!canAccessTeams) {
      return;
    }

    const controller = new AbortController();

    void loadTeams(controller.signal);

    return () => controller.abort();
  }, [canAccessTeams]);

  useEffect(() => {
    setTeamModalTab('overview');

    if (!selectedTeamId) {
      return;
    }

    if (teamDetailsById[selectedTeamId]) {
      return;
    }

    const controller = new AbortController();

    void loadTeamDetail(selectedTeamId, controller.signal);

    return () => controller.abort();
  }, [selectedTeamId, teamDetailsById]);

  useEffect(() => {
    const now = new Date();
    setVacationsMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setCompareQuery('');
    setCompareSelectedMemberIds([]);
    setIsCompareModalOpen(false);
  }, [selectedTeamId]);

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamSpecialCalendar(null);
      return;
    }

    const controller = new AbortController();
    void loadTeamSpecialCalendar(vacationsMonthCursor.getFullYear(), controller.signal);
    return () => controller.abort();
  }, [selectedTeamId, vacationsMonthCursor]);

  useEffect(() => {
    if (!status) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStatus('');
    }, 3600);

    return () => window.clearTimeout(timeoutId);
  }, [status]);

  async function loadTeams(signal?: AbortSignal) {
    setLoading(teams.length === 0);
    setStatus('');

    try {
      const data = await apiRequestCached<TeamSummary[]>('/teams/me?details=none', {
        headers: getAuthHeaders(),
        signal,
      }, 90000);

      setTeams(data);
      if (selectedTeamId && !data.some((team) => team.id === selectedTeamId)) {
        setSelectedTeamId(null);
      }
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      setStatus(error instanceof Error ? error.message : 'Falha ao carregar equipas.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  async function loadTeamDetail(teamId: string, signal?: AbortSignal) {
    setLoadingDetailTeamId(teamId);
    setStatus('');

    try {
      const data = await apiRequestCached<TeamDetail>(`/teams/me/${teamId}`, {
        headers: getAuthHeaders(),
        signal,
      }, 45000);
      setTeamDetailsById((current) => ({
        ...current,
        [teamId]: data,
      }));
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      setStatus(error instanceof Error ? error.message : 'Falha ao carregar detalhe da equipa.');
    } finally {
      if (!signal?.aborted) {
        setLoadingDetailTeamId((current) => (current === teamId ? null : current));
      }
    }
  }

  async function loadTeamSpecialCalendar(year: number, signal?: AbortSignal) {
    setIsLoadingTeamSpecialCalendar(true);
    try {
      const data = await apiRequestCached<TeamSpecialCalendarPayload>(`/vacations/calendar?year=${year}`, {
        headers: getAuthHeaders(),
        signal,
      }, 60000);

      if (!signal?.aborted) {
        setTeamSpecialCalendar(data);
      }
    } catch (error) {
      if (!isAbortError(error) && !signal?.aborted) {
        setStatus(error instanceof Error ? error.message : 'Falha ao carregar dias especiais da equipa.');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoadingTeamSpecialCalendar(false);
      }
    }
  }

  async function loadLeaderOptions(forceRefresh = false) {
    try {
      const data = await apiRequestCached<CollaboratorsResponse>('/users/collaborators?page=1&pageSize=250&sortBy=username&sortDirection=asc', {
        headers: getAuthHeaders(),
      }, 10000, forceRefresh);
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
      leaderId: selectedTeam.leaderId || selectedTeam.manager?.id || selectedTeam.coordinator?.id || '',
      memberIds: selectedTeamMembers.map((member) => member.id),
      parentTeamId: selectedTeam.parentTeam?.id || '',
      costCenter: selectedTeam.parentTeam ? '' : (selectedTeam.costCenter || ''),
      color: selectedTeam.color || '#4B79F5',
    });
    setManageQuery('');
    setIsManageTeamModalOpen(true);
    void loadLeaderOptions(true);
  }

  async function updateTeam() {
    if (!selectedTeam || !teamDraft.name.trim()) {
      setStatus('Indica o nome da equipa.');
      return;
    }

    const nextName = teamDraft.name.trim();
    const nextParentTeamId = teamDraft.parentTeamId || '';
    const normalizedCostCenter = teamDraft.costCenter.trim();
    const nextCostCenter = nextParentTeamId ? '' : normalizedCostCenter;
    const nextLeaderId = teamDraft.leaderId || '';
    const currentParentTeamId = selectedTeam.parentTeam?.id || '';
    const currentCostCenter = selectedTeam.parentTeam ? '' : ((selectedTeam.costCenter || '').trim());
    const currentLeaderId = selectedTeam.leaderId || selectedTeam.manager?.id || selectedTeam.coordinator?.id || '';
    const hasBasicChanges = nextName !== selectedTeam.name
      || nextLeaderId !== currentLeaderId
      || nextParentTeamId !== currentParentTeamId
      || (canViewCostCenter && nextCostCenter !== currentCostCenter)
      || teamDraft.color !== (selectedTeam.color || '#4B79F5');

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
            leaderId: teamDraft.leaderId || null,
            parentTeamId: nextParentTeamId || null,
            color: teamDraft.color || null,
            ...(canViewCostCenter ? { costCenter: nextParentTeamId ? null : (nextCostCenter || null) } : {}),
          }),
        });
      }

      if (hasMemberChanges) {
        await Promise.all([
          ...toAdd.map((userId) => setMemberInSelectedTeam(userId, true, { silentStatus: true, skipRefresh: true })),
          ...toRemove.map((userId) => setMemberInSelectedTeam(userId, false, { silentStatus: true, skipRefresh: true })),
        ]);
      }

      clearApiCache('/teams');
      clearApiCache('/admin/teams');
      if (hasMemberChanges) {
        clearApiCache('/users/collaborators');
      }
      await Promise.all([
        loadTeams(),
        selectedTeamId ? loadTeamDetail(selectedTeamId) : Promise.resolve(),
        loadLeaderOptions(hasMemberChanges),
      ]);
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
      await Promise.all([loadTeams(), loadLeaderOptions()]);
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

  const filteredTeams = useMemo(() => {
    const normalized = teamSearchQuery.trim().toLowerCase();

    if (!normalized) {
      return teams;
    }

    return teams.filter((team) => {
      return [
        team.name,
        team.parentTeam?.name ?? '',
        team.costCenter ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [teamSearchQuery, teams]);

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
      const createdTeam = await apiRequest<{ id: string; name: string }>('/admin/teams', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: teamDraft.name.trim(),
          leaderId: teamDraft.leaderId || null,
          memberIds: teamDraft.memberIds,
          parentTeamId: teamDraft.parentTeamId || null,
          color: teamDraft.color || null,
          ...(canViewCostCenter ? { costCenter: teamDraft.parentTeamId ? null : (teamDraft.costCenter.trim() || null) } : {}),
        }),
      });

      clearApiCache('/teams');
      clearApiCache('/admin/teams');
      setIsNewTeamModalOpen(false);
      setTeamDraft(EMPTY_TEAM_DRAFT);
      await Promise.all([
        loadTeams(),
        loadLeaderOptions(),
      ]);
      if (createdTeam?.id) {
        setSelectedTeamId(createdTeam.id);
      }
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

  const monthYear = vacationsMonthCursor.getFullYear();
  const monthIndex = vacationsMonthCursor.getMonth();
  const monthStartDate = useMemo(() => new Date(monthYear, monthIndex, 1), [monthYear, monthIndex]);
  const monthEndDate = useMemo(() => new Date(monthYear, monthIndex + 1, 0), [monthYear, monthIndex]);
  const monthStartIso = useMemo(() => getIsoDate(monthStartDate), [monthStartDate]);
  const monthEndIso = useMemo(() => getIsoDate(monthEndDate), [monthEndDate]);
  const monthLabel = `${MONTH_LABELS[monthIndex]} ${monthYear}`;

  const monthDays = useMemo(() => {
    const days = [] as Array<{ iso: string; day: number; weekDayLabel: string; isWeekend: boolean }>;

    for (let day = 1; day <= monthEndDate.getDate(); day += 1) {
      const date = new Date(monthYear, monthIndex, day);
      const iso = getIsoDate(date);
      const weekDay = date.getDay();
      const weekDayLabel = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][weekDay] || '';
      days.push({ iso, day, weekDayLabel, isWeekend: weekDay === 0 || weekDay === 6 });
    }

    return days;
  }, [monthEndDate, monthYear, monthIndex]);

  const holidaySet = useMemo(() => new Set(teamSpecialCalendar?.holidays ?? []), [teamSpecialCalendar]);
  const extraDayLabelByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of teamSpecialCalendar?.extraDayDetails ?? []) {
      map.set(item.date, item.label);
    }
    return map;
  }, [teamSpecialCalendar]);
  const extraDaySet = useMemo(() => new Set(teamSpecialCalendar?.extraDays ?? []), [teamSpecialCalendar]);
  const weekendSet = useMemo(() => new Set(teamSpecialCalendar?.weekendDays ?? []), [teamSpecialCalendar]);

  const approvedMonthEntries = useMemo(() => {
    if (!selectedTeamDetail) {
      return [] as Array<{
        member: TeamMember;
        vacation: TeamVacation;
        memberName: string;
        startLabel: string;
        endLabel: string;
        durationLabel: string;
        requestTypeLabel: string;
        clippedStartIso: string;
        clippedEndIso: string;
      }>;
    }

    return selectedTeamDetail.members
      .flatMap((member) => (
        member.vacations
          .filter((vacation) => vacation.status === 'APPROVED')
          .map((vacation) => {
            const clipped = clipRangeToMonth(vacation.dataInicio, vacation.dataFim, monthStartIso, monthEndIso);
            if (!clipped) {
              return null;
            }

            const memberName = formatPerson(member);
            const startLabel = formatDatePt(clipped.start);
            const endLabel = formatDatePt(clipped.end);
            const rawDays = getDaysBetween(clipped.start, clipped.end);
            const days = vacation.partialDay && vacation.partialDay !== 'FULL' ? 0.5 : rawDays;
            const durationLabel = `${String(days).replace('.', ',')} dia(s)`;
            const requestTypeLabel = formatVacationType(vacation.requestType);

            return {
              member,
              vacation,
              memberName,
              startLabel,
              endLabel,
              durationLabel,
              requestTypeLabel,
              clippedStartIso: clipped.start,
              clippedEndIso: clipped.end,
            };
          })
          .filter((item): item is {
            member: TeamMember;
            vacation: TeamVacation;
            memberName: string;
            startLabel: string;
            endLabel: string;
            durationLabel: string;
            requestTypeLabel: string;
            clippedStartIso: string;
            clippedEndIso: string;
          } => item !== null)
      ))
      .sort((a, b) => {
        const byStart = a.clippedStartIso.localeCompare(b.clippedStartIso);
        if (byStart !== 0) {
          return byStart;
        }
        return a.memberName.localeCompare(b.memberName);
      });
  }, [monthEndIso, monthStartIso, selectedTeamDetail]);

  const teamLeaderRef = useMemo(() => {
    const id = selectedTeamDetail?.leaderId
      ?? selectedTeamDetail?.leader?.id
      ?? selectedTeamSummary?.leaderId
      ?? selectedTeamSummary?.leader?.id
      ?? selectedTeamSummary?.manager?.id
      ?? selectedTeamSummary?.coordinator?.id
      ?? null;

    const username = selectedTeamDetail?.leader?.username
      ?? selectedTeamSummary?.leader?.username
      ?? selectedTeamSummary?.manager?.username
      ?? selectedTeamSummary?.coordinator?.username
      ?? '';

    const profile = selectedTeamDetail?.leader?.profile
      ?? selectedTeamSummary?.leader?.profile
      ?? selectedTeamSummary?.manager?.profile
      ?? selectedTeamSummary?.coordinator?.profile
      ?? null;

    return { id, username, profile };
  }, [selectedTeamDetail, selectedTeamSummary]);

  const teamLeaderId = teamLeaderRef.id;

  const teamCalendarMembers = useMemo(() => {
    if (!selectedTeamDetail) {
      return [] as TeamCalendarPerson[];
    }

    const base = [...selectedTeamDetail.members].map((member) => ({
      ...member,
      isTeamLeader: teamLeaderId !== null && member.id === teamLeaderId,
    }));

    if (!teamLeaderId) {
      return base.sort((a, b) => formatPerson(a).localeCompare(formatPerson(b)));
    }

    const hasLeaderAsMember = base.some((member) => member.id === teamLeaderId);
    if (!hasLeaderAsMember && teamLeaderRef.id) {
      base.push({
        id: teamLeaderRef.id,
        username: teamLeaderRef.username || 'chefe-equipa',
        email: '',
        role: 'MANAGER',
        teamId: selectedTeamDetail.id,
        membershipRole: 'LEADER',
        isApprover: true,
        approvalLevel: null,
        profile: teamLeaderRef.profile,
        vacations: [],
        isTeamLeader: true,
      });
    }

    return base.sort((a, b) => {
      const leaderBoost = Number(Boolean(b.isTeamLeader)) - Number(Boolean(a.isTeamLeader));
      if (leaderBoost !== 0) {
        return leaderBoost;
      }
      return formatPerson(a).localeCompare(formatPerson(b));
    });
  }, [selectedTeamDetail, teamLeaderId, teamLeaderRef]);

  const memberColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (let index = 0; index < teamCalendarMembers.length; index += 1) {
      const member = teamCalendarMembers[index];
      map.set(member.id, TEAM_COLORS[index % TEAM_COLORS.length] || '#4B79F5');
    }
    return map;
  }, [teamCalendarMembers]);

  const approvedMonthByMemberByDay = useMemo(() => {
    const map = new Map<string, Map<string, TeamVacation>>();

    for (const entry of approvedMonthEntries) {
      const memberDays = map.get(entry.member.id) ?? new Map<string, TeamVacation>();
      const days = enumerateIsoDates(entry.clippedStartIso, entry.clippedEndIso);
      for (const day of days) {
        memberDays.set(day, entry.vacation);
      }
      map.set(entry.member.id, memberDays);
    }

    return map;
  }, [approvedMonthEntries]);

  const compareMemberOptions = useMemo(() => {
    const normalizedQuery = compareQuery.trim().toLowerCase();
    return teamCalendarMembers.filter((member) => {
      if (!normalizedQuery) {
        return true;
      }

      return [formatPerson(member), member.username, member.email]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [compareQuery, teamCalendarMembers]);

  const compareSelectedMembers = useMemo(() => {
    const byId = new Map(teamCalendarMembers.map((member) => [member.id, member]));
    return compareSelectedMemberIds
      .map((memberId) => byId.get(memberId) ?? null)
      .filter((member): member is TeamCalendarPerson => member !== null);
  }, [compareSelectedMemberIds, teamCalendarMembers]);

  const observedBirthdayByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of teamCalendarMembers) {
      const observed = getObservedBirthdayIso(member.profile?.dataNascimento, monthYear, holidaySet);
      if (observed) {
        map.set(member.id, observed);
      }
    }
    return map;
  }, [holidaySet, monthYear, teamCalendarMembers]);

  const teamBirthdays = useMemo(() => {
    const todayIso = getLocalIsoDate();
    const now = new Date(`${todayIso}T00:00:00`);
    const holidaysThisYear = holidaySet;
    const holidaysNextYear = new Set<string>();

    const entries: TeamBirthdayEntry[] = [];
    for (const member of teamCalendarMembers) {
      const raw = member.profile?.dataNascimento;
      if (!raw) {
        continue;
      }

      const thisYear = getObservedBirthdayIso(raw, now.getFullYear(), holidaysThisYear);
      const nextYear = getObservedBirthdayIso(raw, now.getFullYear() + 1, holidaysNextYear);
      const target = thisYear && thisYear >= todayIso ? thisYear : nextYear;
      if (!target) {
        continue;
      }

      const targetDate = new Date(`${target}T00:00:00`);
      const daysUntil = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 86400000));

      entries.push({
        memberId: member.id,
        memberName: formatPerson(member),
        email: member.email,
        roleLabel: formatRoleLabel(member.role),
        nextBirthdayIso: target,
        observedBirthdayIso: target,
        daysUntil,
        isToday: daysUntil === 0,
      });
    }

    return entries.sort((a, b) => a.daysUntil - b.daysUntil || a.memberName.localeCompare(b.memberName));
  }, [teamCalendarMembers, holidaySet]);

  const birthdaysByMonth = useMemo(() => {
    const grouped = new Map<number, TeamBirthdayEntry[]>();
    for (const item of teamBirthdays) {
      const month = new Date(`${item.nextBirthdayIso}T00:00:00`).getMonth();
      const current = grouped.get(month) ?? [];
      current.push(item);
      grouped.set(month, current);
    }
    return grouped;
  }, [teamBirthdays]);

  const birthdayMonthOrder = useMemo(() => {
    const nowMonth = new Date().getMonth();
    return Array.from({ length: 12 }, (_, offset) => (nowMonth + offset) % 12)
      .filter((month) => (birthdaysByMonth.get(month)?.length ?? 0) > 0);
  }, [birthdaysByMonth]);

  function renderVacationCalendar(members: TeamCalendarPerson[]) {
    if (members.length === 0) {
      return null;
    }

    return (
      <div className="team-vac-calendar-wrap">
        <div className="team-vac-calendar-legend" aria-label="Legenda de dias especiais">
          <span className="team-vac-calendar-legend__item"><i className="is-vacation" />Férias aprovadas</span>
          <span className="team-vac-calendar-legend__item"><i className="is-absence" />Ausência aprovada</span>
          <span className="team-vac-calendar-legend__item"><i className="is-holiday" />Feriado</span>
          <span className="team-vac-calendar-legend__item"><i className="is-extra" />Dia automático</span>
          <span className="team-vac-calendar-legend__item"><i className="is-weekend" />Fim de semana</span>
          <span className="team-vac-calendar-legend__item"><i className="is-birthday" />Aniversário</span>
        </div>

        <div
          className="team-vac-calendar-grid"
          style={{ gridTemplateColumns: `220px repeat(${monthDays.length}, minmax(28px, 1fr))` } as CSSProperties}
        >
          <div className="team-vac-calendar-grid__member-head">Colaborador</div>
          {monthDays.map((day) => (
            <div
              key={`head-${day.iso}`}
              className={`team-vac-calendar-grid__day-head${day.isWeekend ? ' is-weekend' : ''}`}
              title={day.iso}
            >
              <small>{day.weekDayLabel}</small>
              <strong>{day.day}</strong>
            </div>
          ))}

          {members.map((member) => {
            const memberColor = memberColorMap.get(member.id) || '#4B79F5';
            const dayMap = approvedMonthByMemberByDay.get(member.id) ?? new Map<string, TeamVacation>();
            return (
              <Fragment key={`row-${member.id}`}>
                <div key={`member-${member.id}`} className="team-vac-calendar-grid__member-cell">
                  <span className="team-vac-calendar-grid__member-dot" style={{ background: memberColor }} />
                  <div>
                    <strong>{formatPerson(member)}</strong>
                    {member.email ? <small>{member.email}</small> : <small>Sem email disponível</small>}
                    {member.isTeamLeader && <small className="team-vac-calendar-grid__member-role">Chefe da equipa</small>}
                  </div>
                </div>

                {monthDays.map((day) => {
                  const event = dayMap.get(day.iso);
                  const isAbsence = event && event.requestType !== 'VACATION';
                  const isHoliday = holidaySet.has(day.iso);
                  const isExtraDay = extraDaySet.has(day.iso);
                  const isBirthday = observedBirthdayByMemberId.get(member.id) === day.iso;

                  const specialLabels: string[] = [];
                  if (isHoliday) {
                    specialLabels.push('Feriado');
                  }
                  if (isExtraDay) {
                    specialLabels.push(extraDayLabelByDate.get(day.iso) || 'Dia automático');
                  }
                  if (day.isWeekend || weekendSet.has(day.iso)) {
                    specialLabels.push('Fim de semana');
                  }
                  if (isBirthday) {
                    specialLabels.push('Aniversário');
                  }

                  const titleParts = [
                    event
                      ? `${formatVacationType(event.requestType)} aprovado · ${formatDatePt(event.dataInicio)} até ${formatDatePt(event.dataFim)}`
                      : null,
                    specialLabels.length > 0 ? specialLabels.join(' · ') : null,
                    day.iso,
                  ].filter(Boolean);
                  const title = titleParts.join(' | ');

                  return (
                    <div
                      key={`${member.id}-${day.iso}`}
                      className={`team-vac-calendar-grid__day-cell${day.isWeekend ? ' is-weekend' : ''}${event ? ' has-event' : ''}${isAbsence ? ' is-absence' : ''}${isHoliday ? ' is-holiday' : ''}${isExtraDay ? ' is-extra-day' : ''}${isBirthday ? ' is-birthday' : ''}`}
                      style={event ? { '--member-color': memberColor } as CSSProperties : undefined}
                      title={title}
                    >
                      {event && <span className="team-vac-calendar-grid__event-pill" />}
                      {!event && isHoliday && <span className="team-vac-calendar-grid__special-pill">F</span>}
                      {!event && !isHoliday && isExtraDay && <span className="team-vac-calendar-grid__special-pill">A</span>}
                      {!event && !isHoliday && !isExtraDay && isBirthday && <span className="team-vac-calendar-grid__special-pill">N</span>}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  function shiftMonth(direction: -1 | 1) {
    setVacationsMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  }

  function toggleCompareMember(memberId: string) {
    setCompareSelectedMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ));
  }

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

  const isSelectedTeamDetailLoading = loadingDetailTeamId === selectedTeamId;

  return (
    <section className="trainings-shell">
      

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <label>
            <span>Pesquisar</span>
            <input
              type="search"
              value={teamSearchQuery}
              onChange={(event) => setTeamSearchQuery(event.target.value)}
              placeholder="Nome da equipa, equipa-mãe ou centro de custo..."
            />
          </label>
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
          {loading && teams.length > 0 && (
            <article className="trainings-mobile-card">
              <LoadingInline variant="body" />
            </article>
          )}
          {!loading && teams.length === 0 && (
            <EmptyState
              title="Sem equipas visíveis para este perfil."
              message="Assim que existirem equipas no teu âmbito, elas aparecem aqui."
            />
          )}
          {!loading && teams.length > 0 && filteredTeams.length === 0 && (
            <EmptyState
              title="Sem equipas para a pesquisa atual."
              message="Ajusta o termo de pesquisa para ver outras equipas."
            />
          )}
          {!loading && filteredTeams.map((team) => (
            <button
              key={team.id}
              type="button"
              className="manager-team-card"
              style={{ '--team-color': team.color || '#4B79F5' } as React.CSSProperties}
              onClick={() => setSelectedTeamId(team.id)}
            >
              <span className="manager-team-card__label">Equipa</span>
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
              <button type="button" className={`notification-filter${teamModalTab === 'birthdays' ? ' is-active' : ''}`} onClick={() => setTeamModalTab('birthdays')}>
                Aniversários
              </button>
            </div>

            {teamModalTab === 'overview' && (
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
                  {canViewCostCenter && !selectedTeam.parentTeam && (
                    <article>
                      <span>Centro de custo</span>
                      <strong>{selectedTeam.costCenter || '-'}</strong>
                    </article>
                  )}
                  <article>
                    <span>Pessoas</span>
                    <strong>{selectedTeamMembers.length}</strong>
                  </article>
                </div>

                <section className="manager-team-members-list manager-team-members-list--structured">
                  {isSelectedTeamDetailLoading && selectedTeamMembers.length === 0 && (
                    <article className="trainings-mobile-card">
                      <Skeleton lines={3} />
                    </article>
                  )}

                  {!isSelectedTeamDetailLoading && selectedTeamMembers.length === 0 && (
                    <EmptyState
                      title="Sem membros nesta equipa."
                      message="Adiciona colaboradores para começar a gerir esta equipa."
                    />
                  )}

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

            {teamModalTab === 'birthdays' && (
              <section className="team-birthdays-board">
                {isSelectedTeamDetailLoading && teamCalendarMembers.length === 0 && (
                  <article className="trainings-mobile-card">
                    <Skeleton lines={4} />
                  </article>
                )}

                {!isSelectedTeamDetailLoading && teamBirthdays.length === 0 && (
                  <EmptyState
                    title="Sem aniversários disponíveis"
                    message="Para mostrar aniversários da equipa, os perfis dos membros precisam de data de nascimento preenchida."
                  />
                )}

                {!isSelectedTeamDetailLoading && teamBirthdays.length > 0 && (
                  <>
                    <div className="team-birthdays-hero">
                      <article>
                        <span>Total com aniversário</span>
                        <strong>{teamBirthdays.length}</strong>
                      </article>
                      <article>
                        <span>Próximos 7 dias</span>
                        <strong>{teamBirthdays.filter((item) => item.daysUntil <= 7).length}</strong>
                      </article>
                      <article>
                        <span>Hoje</span>
                        <strong>{teamBirthdays.filter((item) => item.isToday).length}</strong>
                      </article>
                    </div>

                    <div className="team-birthdays-next">
                      <h3>Próximos aniversários</h3>
                      <div className="team-birthdays-next__grid">
                        {teamBirthdays.slice(0, 6).map((item) => (
                          <article key={`next-bday-${item.memberId}`} className={`team-birthdays-next__card${item.isToday ? ' is-today' : ''}`}>
                            <p>{item.memberName}</p>
                            <strong>{formatDatePt(item.nextBirthdayIso)}</strong>
                            <small>{item.isToday ? 'Hoje' : `Faltam ${item.daysUntil} dia(s)`}</small>
                            <small>{item.roleLabel}</small>
                          </article>
                        ))}
                      </div>
                    </div>

                    <div className="team-birthdays-months">
                      {birthdayMonthOrder.map((month) => (
                        <article key={`bday-month-${month}`} className="team-birthdays-months__group">
                          <h4>{MONTH_LABELS[month]}</h4>
                          <div className="team-birthdays-months__list">
                            {(birthdaysByMonth.get(month) ?? []).map((item) => (
                              <div key={`month-bday-${month}-${item.memberId}`} className="team-birthdays-months__item">
                                <div>
                                  <strong>{item.memberName}</strong>
                                  <small>{item.email || 'Sem email disponível'}</small>
                                </div>
                                <div>
                                  <strong>{formatDatePt(item.nextBirthdayIso)}</strong>
                                  <small>{item.isToday ? 'Hoje' : `${item.daysUntil} dia(s)`}</small>
                                </div>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </Modal>

      <Modal
        open={isCompareModalOpen}
        title="Comparar colaboradores"
        onClose={() => setIsCompareModalOpen(false)}
        width="min(1080px, 96vw)"
        footer={
          <div className="modal-footer-split modal-footer-split--wrap">
            <small>{compareSelectedMemberIds.length} selecionado(s)</small>
            <Button type="button" variant="ghost" onClick={() => setIsCompareModalOpen(false)}>Fechar</Button>
          </div>
        }
      >
        <div className="team-compare-modal">
          <div className="team-compare-modal__toolbar">
            <label>
              <span>Selecionar colaboradores</span>
              <input
                type="search"
                value={compareQuery}
                onChange={(event) => setCompareQuery(event.target.value)}
                placeholder="Pesquisar por nome, username ou email..."
              />
            </label>
            <Button type="button" variant="secondary" size="sm" onClick={() => setCompareSelectedMemberIds([])}>
              Limpar seleção
            </Button>
          </div>

          <div className="team-compare-modal__member-pool">
            {compareMemberOptions.map((member) => {
              const isSelected = compareSelectedMemberIds.includes(member.id);
              const color = memberColorMap.get(member.id) || '#4B79F5';
              return (
                <button
                  key={member.id}
                  type="button"
                  className={`team-compare-modal__member-option${isSelected ? ' is-selected' : ''}`}
                  onClick={() => toggleCompareMember(member.id)}
                >
                  <span className="team-compare-modal__member-dot" style={{ background: color }} />
                  <div>
                    <strong>{formatPerson(member)}</strong>
                    <small>{member.email}</small>
                  </div>
                </button>
              );
            })}
          </div>

          {compareSelectedMembers.length < 2 ? (
            <EmptyState
              title="Seleciona pelo menos 2 colaboradores"
              message="A comparação mostra dias de férias e ausências aprovadas no mês atualmente selecionado."
            />
          ) : (
            <>
              <div className="team-overview-metrics">
                <article>
                  <span>Período comparado</span>
                  <strong>{monthLabel}</strong>
                  <small>Mesma vista da equipa, filtrada pelos colaboradores selecionados.</small>
                </article>
              </div>

              {renderVacationCalendar(compareSelectedMembers)}
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={isNewTeamModalOpen}
        title="Nova equipa"
        onClose={() => setIsNewTeamModalOpen(false)}
        width="min(760px, 94vw)"
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setIsNewTeamModalOpen(false)}>Cancelar</Button>
            <Button type="button" variant="primary" isLoading={isSavingTeam} onClick={() => void saveTeam()}>Criar equipa</Button>
          </div>
        }
      >
        <form className="team-create-form" onSubmit={(event) => { event.preventDefault(); void saveTeam(); }}>
          <header className="team-create-form__hero">
            <p>Configuração inteligente</p>
            <h4>Cria a equipa com liderança, membros e hierarquia</h4>
            <small>Podes definir o chefe agora e ajustar participantes sem sair deste fluxo.</small>
          </header>

          <div className="team-create-form__grid">
            <label>
              <span>Nome da equipa</span>
              <input type="text" value={teamDraft.name} onChange={(event) => setTeamDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex: Operações Norte" />
            </label>

            <label>
              <span>Subequipa de</span>
              <select
                value={teamDraft.parentTeamId}
                onChange={(event) => setTeamDraft((current) => ({
                  ...current,
                  parentTeamId: event.target.value,
                  costCenter: event.target.value ? '' : current.costCenter,
                }))}
              >
                <option value="">Sem equipa-mãe</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>

            {canViewCostCenter && (
              <label>
                <span>Centro de custo (equipa mãe)</span>
                <input
                  type="text"
                  value={teamDraft.costCenter}
                  disabled={Boolean(teamDraft.parentTeamId)}
                  onChange={(event) => setTeamDraft((current) => ({ ...current, costCenter: event.target.value }))}
                  placeholder="Ex: 185010"
                />
              </label>
            )}

            <label>
              <span>Cor da equipa</span>
              <div className="team-color-picker">
                {TEAM_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`team-color-swatch${teamDraft.color === c ? ' is-active' : ''}`}
                    style={{ '--swatch-color': c } as React.CSSProperties}
                    onClick={() => setTeamDraft((current) => ({ ...current, color: c }))}
                    title={c}
                    aria-label={`Cor ${c}`}
                  />
                ))}
              </div>
            </label>
          </div>

          <div className="team-create-form__pickers">
            <article>
              <div className="team-picker-inline">
                <strong>Chefe de equipa</strong>
                <Button type="button" variant="secondary" size="sm" onClick={() => openPicker('leader')}>Escolher</Button>
              </div>
              <p>{selectedLeader ? getProfileDisplayName(selectedLeader) : 'Sem chefe selecionado'}</p>
            </article>

            <article>
              <div className="team-picker-inline">
                <strong>Membros participantes</strong>
                <Button type="button" variant="secondary" size="sm" onClick={() => openPicker('members')}>Escolher</Button>
              </div>
              <p>{selectedMembers.length} selecionado(s)</p>
              {selectedMembers.length > 0 && (
                <div className="team-member-chip-list">
                  {selectedMembers.map((member) => (
                    <button key={member.id} type="button" className="team-member-chip" onClick={() => toggleMember(member.id)}>
                      {getProfileDisplayName(member)} ×
                    </button>
                  ))}
                </div>
              )}
            </article>
          </div>
        </form>
      </Modal>

      <Modal
        open={isPickerOpen}
        title={pickerMode === 'leader' ? 'Escolher chefe de equipa' : 'Escolher membros participantes'}
        onClose={() => setIsPickerOpen(false)}
        width="min(980px, 96vw)"
        footer={
          <div className="modal-footer-split">
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
          <div className="modal-footer-split modal-footer-split--wrap">
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

            <label>
              <span>Subequipa de</span>
              <select
                value={teamDraft.parentTeamId}
                disabled={!canEditTeam}
                onChange={(event) => setTeamDraft((current) => ({
                  ...current,
                  parentTeamId: event.target.value,
                  costCenter: event.target.value ? '' : current.costCenter,
                }))}
              >
                <option value="">Sem equipa-mãe</option>
                {teams
                  .filter((team) => team.id !== selectedTeam?.id)
                  .map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
              </select>
            </label>

            {canViewCostCenter && (
              <label>
                <span>Centro de custo (equipa mãe)</span>
                <input
                  type="text"
                  value={teamDraft.costCenter}
                  disabled={!canEditTeam || Boolean(teamDraft.parentTeamId)}
                  onChange={(event) => setTeamDraft((current) => ({ ...current, costCenter: event.target.value }))}
                  placeholder="Ex: 185010"
                />
              </label>
            )}

            <label>
              <span>Cor da equipa</span>
              <div className="team-color-picker">
                {TEAM_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={!canEditTeam}
                    className={`team-color-swatch${teamDraft.color === c ? ' is-active' : ''}`}
                    style={{ '--swatch-color': c } as React.CSSProperties}
                    onClick={() => setTeamDraft((current) => ({ ...current, color: c }))}
                    title={c}
                    aria-label={`Cor ${c}`}
                  />
                ))}
              </div>
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
          <div className="modal-footer-split">
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
