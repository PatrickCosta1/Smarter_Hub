import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatRoleLabel } from '../portal/labels';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';
const PERMISSION_CATEGORIES = ['SYSTEM', 'USERS', 'TEAMS', 'VACATIONS', 'TRAININGS', 'PROFILE', 'RECEIPTS', 'NOTIFICATIONS'] as const;
type PermissionCategory = typeof PERMISSION_CATEGORIES[number];

type CollaboratorRow = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  isActive: boolean;
  deactivatedAt: string | null;
  updatedAt: string;
  team?: { id: string; name: string } | null;
  teamRole?: 'LEADER' | 'MEMBER' | null;
  managedTeams?: Array<{ id: string; name: string }>;
  teamMemberships?: Array<{
    teamId: string;
    team?: { id: string; name: string } | null;
  }>;
  profile?: {
    nomeAbreviado?: string;
    primeiroNome?: string;
    apelido?: string;
    cargo?: string;
    funcao?: string;
    workCountry?: 'PT' | 'BR';
    localidade?: string;
  } | null;
};

function getCollaboratorTeamInfo(item: CollaboratorRow) {
  const resolvedTeam = item.team?.name
    ? item.team
    : item.teamMemberships?.[0]?.team?.name
      ? item.teamMemberships[0].team
      : item.managedTeams?.[0] ?? null;

  if (!resolvedTeam) {
    return { name: '-', isLeader: false };
  }

  const isLeader = item.teamRole === 'LEADER'
    || Boolean(item.managedTeams?.some((team) => team.id === resolvedTeam.id));

  return { name: resolvedTeam.name, isLeader };
}

type CollaboratorsResponse = {
  total: number;
  page: number;
  pageSize: number;
  rows: CollaboratorRow[];
};

type PermissionGrantUser = {
  id: string;
  username: string;
  profile?: {
    nomeAbreviado?: string;
    primeiroNome?: string;
    apelido?: string;
  } | null;
};

type PermissionAssignment = {
  isEnabled: boolean;
  restrictedToTeams: string[];
  restrictedToCountries: Array<'PT' | 'BR'>;
  restrictedToLevels: string[];
  customRestrictions: unknown;
  notes: string | null;
  grantedBy?: PermissionGrantUser | null;
};

type PermissionItem = {
  id: string;
  code: string;
  label: string;
  description: string;
  category: PermissionCategory;
  assignment: PermissionAssignment | null;
};

type UserPermissionsResponse = {
  user: {
    id: string;
    username: string;
    email: string;
    isActive: boolean;
    isRootAccess: boolean;
    profile?: {
      nomeAbreviado?: string;
      primeiroNome?: string;
      apelido?: string;
    } | null;
  };
  accessTotal: boolean;
  permissions: PermissionItem[];
};

type TeamOption = {
  id: string;
  name: string;
};

type PermissionDraft = {
  enabled: boolean;
  restrictedToTeams: string;
  restrictedToCountries: string;
  restrictedToLevels: string;
  customRestrictions: string;
  notes: string;
};

const EMPTY_PERMISSION_DRAFT: PermissionDraft = {
  enabled: false,
  restrictedToTeams: '',
  restrictedToCountries: '',
  restrictedToLevels: '',
  customRestrictions: '',
  notes: '',
};

function getAuthHeaders() {
  const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  return authHeaders(token);
}

function getDisplayName(item: CollaboratorRow) {
  const shortName = item.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = `${item.profile?.primeiroNome ?? ''} ${item.profile?.apelido ?? ''}`.trim();
  return fullName || item.username;
}

function getGrantDisplayName(user?: PermissionGrantUser | null) {
  const shortName = user?.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = `${user?.profile?.primeiroNome ?? ''} ${user?.profile?.apelido ?? ''}`.trim();
  return fullName || user?.username || 'Sistema';
}

function normalizeList(input: string) {
  return input
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleCommaItem(source: string, item: string) {
  const normalized = normalizeList(source);
  return normalized.includes(item)
    ? normalized.filter((entry) => entry !== item).join(', ')
    : [...normalized, item].join(', ');
}

function parseJsonOrNull(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function getPermissionCategoryLabel(category: PermissionCategory) {
  switch (category) {
    case 'SYSTEM': return 'Sistema';
    case 'USERS': return 'Utilizadores';
    case 'TEAMS': return 'Equipas';
    case 'VACATIONS': return 'Férias';
    case 'TRAININGS': return 'Formações';
    case 'PROFILE': return 'Perfil';
    case 'RECEIPTS': return 'Recibos';
    case 'NOTIFICATIONS': return 'Notificações';
    default: return category;
  }
}

function buildDraftFromAssignment(item: PermissionItem, forceEnabled = false): PermissionDraft {
  return {
    enabled: forceEnabled || item.assignment?.isEnabled || false,
    restrictedToTeams: item.assignment?.restrictedToTeams?.join(', ') ?? '',
    restrictedToCountries: item.assignment?.restrictedToCountries?.join(', ') ?? '',
    restrictedToLevels: item.assignment?.restrictedToLevels?.join(', ') ?? '',
    customRestrictions: item.assignment?.customRestrictions ? JSON.stringify(item.assignment.customRestrictions, null, 2) : '',
    notes: item.assignment?.notes ?? '',
  };
}

export default function CollaboratorsPage() {
  const { hasPermission, isRootAccess, currentUser } = usePortal();
  const canView = isRootAccess || hasPermission('view_user_list');
  const canManagePermissions = isRootAccess || hasPermission('manage_permissions');
  const canManageActive = isRootAccess || hasPermission('manage_user_active');

  const [rows, setRows] = useState<CollaboratorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | CollaboratorRow['role']>('ALL');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [countryFilter, setCountryFilter] = useState<'ALL' | 'PT' | 'BR'>('ALL');
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'username' | 'email' | 'role'>('updatedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [activeConfirmTarget, setActiveConfirmTarget] = useState<CollaboratorRow | null>(null);
  const [selectedRow, setSelectedRow] = useState<CollaboratorRow | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<'ficha' | 'permissoes' | 'estado'>('ficha');
  const [permissionCategory, setPermissionCategory] = useState<PermissionCategory>('USERS');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [selectedUserAccessTotal, setSelectedUserAccessTotal] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionItem[]>([]);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, PermissionDraft>>({});
  const [savingPermissionId, setSavingPermissionId] = useState<string | null>(null);
  const [isTogglingAccessTotal, setIsTogglingAccessTotal] = useState(false);
  const [accessTotalModalOpen, setAccessTotalModalOpen] = useState(false);
  const [accessTotalAction, setAccessTotalAction] = useState<'grant' | 'revoke'>('grant');
  const [accessTotalReason, setAccessTotalReason] = useState('');
  const [selectedPermissionId, setSelectedPermissionId] = useState<string | null>(null);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [permissionTeams, setPermissionTeams] = useState<TeamOption[]>([]);
  const [pendingTeamToAdd, setPendingTeamToAdd] = useState('');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const visibleRows = useMemo(
    () => rows.filter((item) => item.id !== currentUser?.id),
    [rows, currentUser?.id],
  );
  const visibleTotal = Math.max(0, total - (rows.some((item) => item.id === currentUser?.id) ? 1 : 0));
  const categoryPermissions = useMemo(
    () => selectedPermissions.filter((item) => item.category === permissionCategory),
    [permissionCategory, selectedPermissions],
  );

  const filteredCategoryPermissions = useMemo(() => {
    const normalized = permissionSearch.trim().toLowerCase();
    if (!normalized) {
      return categoryPermissions;
    }

    return categoryPermissions.filter((item) =>
      `${item.label} ${item.description} ${item.code}`.toLowerCase().includes(normalized),
    );
  }, [categoryPermissions, permissionSearch]);

  const selectedPermission = useMemo(
    () => filteredCategoryPermissions.find((item) => item.id === selectedPermissionId) || filteredCategoryPermissions[0] || null,
    [filteredCategoryPermissions, selectedPermissionId],
  );

  const selectedPermissionDraft = selectedPermission
    ? (permissionDrafts[selectedPermission.id] ?? buildDraftFromAssignment(selectedPermission))
    : null;

  const selectedRestrictionCountries = selectedPermissionDraft ? normalizeList(selectedPermissionDraft.restrictedToCountries) : [];
  const selectedRestrictedTeamIds = selectedPermissionDraft ? normalizeList(selectedPermissionDraft.restrictedToTeams) : [];
  const selectedRestrictedTeams = useMemo(
    () => permissionTeams.filter((team) => selectedRestrictedTeamIds.includes(team.id)),
    [permissionTeams, selectedRestrictedTeamIds],
  );
  const availableTeamsToAdd = useMemo(
    () => permissionTeams.filter((team) => !selectedRestrictedTeamIds.includes(team.id)),
    [permissionTeams, selectedRestrictedTeamIds],
  );

  useEffect(() => {
    if (filteredCategoryPermissions.length === 0) {
      setSelectedPermissionId(null);
      return;
    }

    if (!selectedPermissionId || !filteredCategoryPermissions.some((item) => item.id === selectedPermissionId)) {
      setSelectedPermissionId(filteredCategoryPermissions[0].id);
    }
  }, [filteredCategoryPermissions, selectedPermissionId]);

  useEffect(() => {
    if (!canView) {
      return;
    }

    void loadCollaborators();
  }, [canView, page, pageSize, query, roleFilter, activeFilter, countryFilter, sortBy, sortDirection]);

  async function loadCollaborators() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('sortBy', sortBy);
      params.set('sortDirection', sortDirection);

      if (query.trim()) {
        params.set('q', query.trim());
      }
      if (roleFilter !== 'ALL') {
        params.set('role', roleFilter);
      }
      if (activeFilter !== 'ALL') {
        params.set('active', activeFilter === 'ACTIVE' ? 'true' : 'false');
      }
      if (countryFilter !== 'ALL') {
        params.set('workCountry', countryFilter);
      }

      const data = await apiRequestCached<CollaboratorsResponse>(`/users/collaborators?${params.toString()}`, {
        headers: getAuthHeaders(),
      }, 10000);

      setRows(data.rows);
      setTotal(data.total);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar colaboradores.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(item: CollaboratorRow) {
    setBusyUserId(item.id);
    try {
      await apiRequest(`/users/${item.id}/active`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ isActive: !item.isActive }),
      });

      clearApiCache('/users/collaborators');
      await loadCollaborators();
      setStatus(item.isActive ? 'Colaborador desativado com sucesso.' : 'Colaborador reativado com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao alterar estado do colaborador.');
    } finally {
      setBusyUserId(null);
    }
  }

  function openActiveConfirm(item: CollaboratorRow) {
    setActiveConfirmTarget(item);
  }

  async function confirmToggleActive() {
    if (!activeConfirmTarget) {
      return;
    }

    await toggleActive(activeConfirmTarget);
    setActiveConfirmTarget(null);
  }

  async function openDetails(item: CollaboratorRow, initialTab: 'ficha' | 'permissoes' | 'estado' = 'ficha') {
    setSelectedRow(item);
    setDetailsTab(initialTab);
    setIsDetailsOpen(true);
    setIsLoadingDetails(true);

    try {
      const details = await apiRequest<UserPermissionsResponse>(`/users/${item.id}/permissions`, {
        headers: getAuthHeaders(),
      });
      const hasAccessTotal = Boolean(details.accessTotal);
      setSelectedPermissions(details.permissions);
      setSelectedUserAccessTotal(hasAccessTotal);
      setPermissionDrafts(Object.fromEntries(details.permissions.map((permission) => [permission.id, buildDraftFromAssignment(permission, hasAccessTotal)])));
      setSelectedPermissionId(details.permissions[0]?.id ?? null);
      setPermissionSearch('');
      setPendingTeamToAdd('');

      try {
        const adminTeams = await apiRequestCached<Array<{ id: string; name: string }>>('/admin/teams', {
          headers: getAuthHeaders(),
        }, 8000, true);
        setPermissionTeams((adminTeams || []).map((team) => ({ id: team.id, name: team.name })));
      } catch {
        try {
          const scopedTeams = await apiRequestCached<Array<{ id: string; name: string }>>('/teams', {
            headers: getAuthHeaders(),
          }, 8000, true);
          setPermissionTeams((scopedTeams || []).map((team) => ({ id: team.id, name: team.name })));
        } catch {
          setPermissionTeams([]);
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar detalhe do colaborador.');
    } finally {
      setIsLoadingDetails(false);
    }
  }

  async function savePermission(permission: PermissionItem) {
    if (!selectedRow) {
      return;
    }

    if (selectedUserAccessTotal) {
      setStatus('Revoga o acesso total para editar permissões individuais.');
      return;
    }

    const draft = permissionDrafts[permission.id] ?? EMPTY_PERMISSION_DRAFT;
    setSavingPermissionId(permission.id);

    try {
      if (!draft.enabled && permission.assignment) {
        await apiRequest(`/users/${selectedRow.id}/permissions/${permission.id}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
      } else if (draft.enabled) {
        const body = {
          permissionId: permission.id,
          isEnabled: true,
          restrictedToTeams: normalizeList(draft.restrictedToTeams),
          restrictedToCountries: normalizeList(draft.restrictedToCountries)
            .map((item) => item.toUpperCase())
            .filter((item): item is 'PT' | 'BR' => item === 'PT' || item === 'BR'),
          restrictedToLevels: normalizeList(draft.restrictedToLevels),
          customRestrictions: parseJsonOrNull(draft.customRestrictions),
          notes: draft.notes,
          reason: `Atualização pela gestão de colaboradores para ${selectedRow.username}.`,
        };

        if (permission.assignment) {
          await apiRequest(`/users/${selectedRow.id}/permissions/${permission.id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest(`/users/${selectedRow.id}/permissions`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body),
          });
        }
      }

      clearApiCache();
      await openDetails(selectedRow);
      setStatus('Permissão atualizada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar permissão.');
    } finally {
      setSavingPermissionId(null);
    }
  }

  async function toggleAccessTotalForSelected(enable: boolean, reason?: string) {
    if (!selectedRow) {
      return false;
    }

    if (enable === selectedUserAccessTotal) {
      return false;
    }

    setIsTogglingAccessTotal(true);
    try {
      const result = await apiRequest<{ success: boolean; accessTotal: boolean }>(`/users/${selectedRow.id}/access-total`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          isEnabled: enable,
          reason: reason?.trim() || undefined,
        }),
      });
      clearApiCache();
      setSelectedUserAccessTotal(Boolean(result.accessTotal));
      void openDetails(selectedRow, 'permissoes');
      setStatus(enable ? 'Acesso total concedido.' : 'Acesso total revogado.');
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar acesso total.');
      return false;
    } finally {
      setIsTogglingAccessTotal(false);
    }
  }

  function addTeamRestriction(teamId: string) {
    if (!selectedPermission || !selectedPermissionDraft || !teamId) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: {
        ...selectedPermissionDraft,
        restrictedToTeams: toggleCommaItem(selectedPermissionDraft.restrictedToTeams, teamId),
      },
    }));
    setPendingTeamToAdd('');
  }

  function removeTeamRestriction(teamId: string) {
    if (!selectedPermission || !selectedPermissionDraft) {
      return;
    }

    setPermissionDrafts((current) => ({
      ...current,
      [selectedPermission.id]: {
        ...selectedPermissionDraft,
        restrictedToTeams: toggleCommaItem(selectedPermissionDraft.restrictedToTeams, teamId),
      },
    }));
  }

  if (!canView) {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área está disponível para Admin e RH (Coordenador).</p>
        </article>
      </section>
    );
  }

  return (
    <section className="trainings-shell">
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Colaboradores</p>
          <h2>Gestão transversal de colaboradores</h2>
          <p>Consulta, filtra e ativa/desativa sem perder histórico de dados.</p>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="collaborators-filter-grid">
          <label>
            <span>Pesquisar</span>
            <input type="search" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Nome, username, email, cargo, função..." />
          </label>

          <label>
            <span>Role</span>
            <select value={roleFilter} onChange={(event) => { setPage(1); setRoleFilter(event.target.value as 'ALL' | CollaboratorRow['role']); }}>
              <option value="ALL">Todas</option>
              <option value="COLABORADOR">{formatRoleLabel('COLABORADOR')}</option>
              <option value="MANAGER">{formatRoleLabel('MANAGER')}</option>
              <option value="COORDENADOR">{formatRoleLabel('COORDENADOR')}</option>
              <option value="ADMIN">{formatRoleLabel('ADMIN')}</option>
            </select>
          </label>

          <label>
            <span>Estado</span>
            <select value={activeFilter} onChange={(event) => { setPage(1); setActiveFilter(event.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE'); }}>
              <option value="ALL">Todos</option>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>
          </label>

          <label>
            <span>País</span>
            <select value={countryFilter} onChange={(event) => { setPage(1); setCountryFilter(event.target.value as 'ALL' | 'PT' | 'BR'); }}>
              <option value="ALL">Todos</option>
              <option value="PT">Portugal</option>
              <option value="BR">Brasil</option>
            </select>
          </label>

          <label>
            <span>Ordenar por</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'createdAt' | 'updatedAt' | 'username' | 'email' | 'role')}>
              <option value="updatedAt">Atualização</option>
              <option value="createdAt">Criação</option>
              <option value="username">Username</option>
              <option value="email">Email</option>
              <option value="role">Role</option>
            </select>
          </label>

          <label>
            <span>Direção</span>
            <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}>
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </select>
          </label>

          <label>
            <span>Tamanho página</span>
            <select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>

        <div className="collaborators-table">
          <DataTable
            columns={[
            { key: 'name', header: 'Colaborador', render: (item: CollaboratorRow) => getDisplayName(item) },
            { key: 'email', header: 'Email', render: (item: CollaboratorRow) => <span className="table-nowrap">{item.email}</span> },
            { key: 'role', header: 'Role', render: (item: CollaboratorRow) => <Badge tone="info">{formatRoleLabel(item.role)}</Badge> },
            {
              key: 'team',
              header: 'Equipa',
              render: (item: CollaboratorRow) => {
                const teamInfo = getCollaboratorTeamInfo(item);
                if (teamInfo.name === '-') {
                  return '-';
                }

                return (
                  <span className={`collaborator-team-chip${teamInfo.isLeader ? ' is-leader' : ''}`}>
                    {teamInfo.isLeader ? 'Chefe · ' : ''}{teamInfo.name}
                  </span>
                );
              },
            },
            { key: 'country', header: 'País', render: (item: CollaboratorRow) => <Badge tone="neutral">{item.profile?.workCountry || 'PT'}</Badge> },
            {
              key: 'state',
              header: 'Estado',
              render: (item: CollaboratorRow) => (
                <Badge tone={item.isActive ? 'success' : 'danger'}>{item.isActive ? 'Ativo' : 'Inativo'}</Badge>
              ),
            },
            {
              key: 'actions',
              header: 'Ações',
              render: (item: CollaboratorRow) => (
                <div className="collaborators-actions">
                  <Button type="button" size="sm" variant="ghost" onClick={() => void openDetails(item)}>Ver</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void openDetails(item, 'permissoes')} disabled={!canManagePermissions}>Permissões</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={item.isActive ? 'danger' : 'secondary'}
                    isLoading={busyUserId === item.id}
                    onClick={() => openActiveConfirm(item)}
                    disabled={!canManageActive}
                  >
                    {item.isActive ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              ),
              align: 'right',
            },
            ]}
            rows={visibleRows}
            rowKey={(item) => item.id}
            emptyMessage="Sem colaboradores para os filtros aplicados."
            loading={loading}
            loadingLines={4}
            ariaLabel="Lista de colaboradores"
          />
        </div>

        <div className="trainings-form-actions trainings-form-actions--between">
          <small>Resultados: {visibleTotal}</small>
          <div className="trainings-form-actions__group">
            <Button type="button" variant="ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Anterior</Button>
            <Button type="button" variant="ghost" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Seguinte</Button>
          </div>
        </div>
      </section>

      <Modal
        open={isDetailsOpen}
        title={selectedRow ? `Gestão do colaborador · ${getDisplayName(selectedRow)}` : 'Gestão do colaborador'}
        onClose={() => setIsDetailsOpen(false)}
        width="min(1360px, 97vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <small>Fluxo unificado: ficha, permissões e estado de conta.</small>
            <Button type="button" variant="ghost" onClick={() => setIsDetailsOpen(false)}>Fechar</Button>
          </div>
        }
      >
        <section className="collaborator-modal-shell">
          <nav className="collaborator-modal-tabs">
            <button type="button" className={detailsTab === 'ficha' ? 'is-active' : ''} onClick={() => setDetailsTab('ficha')}>1. Ficha</button>
            <button type="button" className={detailsTab === 'permissoes' ? 'is-active' : ''} onClick={() => setDetailsTab('permissoes')}>2. Permissões</button>
            <button type="button" className={detailsTab === 'estado' ? 'is-active' : ''} onClick={() => setDetailsTab('estado')}>3. Estado</button>
          </nav>

          {isLoadingDetails && (
            <div className="collaborator-modal-panel">
              <Skeleton lines={2} />
              <div className="collaborator-kpi-grid">
                {Array.from({ length: 4 }).map((_, index) => (
                  <article key={index}>
                    <Skeleton lines={2} />
                  </article>
                ))}
              </div>
              <div className="collaborator-info-grid">
                <article>
                  <Skeleton lines={3} />
                </article>
                <article>
                  <Skeleton lines={3} />
                </article>
              </div>
            </div>
          )}

          {!isLoadingDetails && selectedRow && detailsTab === 'ficha' && (
            <section className="collaborator-modal-panel">
              <div className="collaborator-kpi-grid">
                <article>
                  <span>Nome</span>
                  <strong>{getDisplayName(selectedRow)}</strong>
                </article>
                <article>
                  <span>Email</span>
                  <strong>{selectedRow.email}</strong>
                </article>
                <article>
                  <span>Role</span>
                  <strong>{formatRoleLabel(selectedRow.role)}</strong>
                </article>
                <article>
                  <span>Equipa</span>
                  <strong>{getCollaboratorTeamInfo(selectedRow).name === '-' ? 'Sem equipa' : getCollaboratorTeamInfo(selectedRow).name}</strong>
                </article>
              </div>

              <div className="collaborator-info-grid">
                <article>
                  <h4>Identificação</h4>
                  <p><span>Username:</span> {selectedRow.username}</p>
                  <p><span>País:</span> {selectedRow.profile?.workCountry || 'PT'}</p>
                  <p><span>Localidade:</span> {selectedRow.profile?.localidade || '-'}</p>
                </article>
                <article>
                  <h4>Função</h4>
                  <p><span>Cargo:</span> {selectedRow.profile?.cargo || '-'}</p>
                  <p><span>Função:</span> {selectedRow.profile?.funcao || '-'}</p>
                  <p><span>Estado:</span> {selectedRow.isActive ? 'Ativo' : 'Inativo'}</p>
                </article>
              </div>
            </section>
          )}

          {!isLoadingDetails && selectedRow && detailsTab === 'permissoes' && (
            <section className="collaborator-modal-panel">
              <header className="collaborator-permissions-header">
                <div>
                  <h4>Permissões simplificadas</h4>
                  <p>Seleciona uma permissão na lista e configura em 3 passos rápidos.</p>
                  <p className="collab-help-inline">Dica: qualquer campo de restrição deixado vazio significa sem restrição nesse critério.</p>
                  <p className="collab-help-inline">Quando o acesso total estiver ativo, as permissões individuais ficam bloqueadas até revogares esse acesso.</p>
                </div>
                <div className="collaborator-permissions-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    isLoading={isTogglingAccessTotal}
                    onClick={() => {
                      setAccessTotalAction('grant');
                      setAccessTotalReason('');
                      setAccessTotalModalOpen(true);
                    }}
                    disabled={!canManagePermissions || selectedRow.username === 't.people' || selectedUserAccessTotal || isTogglingAccessTotal}
                  >
                    Dar acesso total
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    isLoading={isTogglingAccessTotal}
                    onClick={() => {
                      setAccessTotalAction('revoke');
                      setAccessTotalReason('');
                      setAccessTotalModalOpen(true);
                    }}
                    disabled={!canManagePermissions || selectedRow.username === 't.people' || !selectedUserAccessTotal || isTogglingAccessTotal}
                  >
                    Revogar acesso total
                  </Button>
                </div>
              </header>

              <div className="permissions-tabs collaborator-permission-categories">
                {PERMISSION_CATEGORIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={item === permissionCategory ? 'is-active' : ''}
                    onClick={() => setPermissionCategory(item)}
                  >
                    {getPermissionCategoryLabel(item)}
                  </button>
                ))}
              </div>

              <div className="collab-permissions-workbench">
                <aside className="collab-permissions-list">
                  <label className="collab-permissions-search">
                    <span>Pesquisar permissão</span>
                    <input
                      type="search"
                      placeholder="Ex: aprovar férias, editar utilizador..."
                      value={permissionSearch}
                      onChange={(event) => setPermissionSearch(event.target.value)}
                    />
                  </label>

                  <div className="collab-permissions-items">
                    {filteredCategoryPermissions.length === 0 && (
                      <EmptyState
                        title="Sem permissões nesta categoria."
                        message="Escolhe outra categoria para continuar a configuração."
                      />
                    )}
                    {filteredCategoryPermissions.map((permission) => {
                      const draft = permissionDrafts[permission.id] ?? buildDraftFromAssignment(permission);
                      const effectiveEnabled = selectedUserAccessTotal || draft.enabled;
                      return (
                        <button
                          key={permission.id}
                          type="button"
                          className={`collab-permission-item${selectedPermission?.id === permission.id ? ' is-selected' : ''}${effectiveEnabled ? ' is-enabled' : ''}`}
                          onClick={() => setSelectedPermissionId(permission.id)}
                        >
                          <strong>{permission.label}</strong>
                          <span>{effectiveEnabled ? 'Ativa' : 'Inativa'}</span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <section className="collab-permissions-editor">
                  {!selectedPermission || !selectedPermissionDraft ? (
                    <p>Seleciona uma permissão para configurar.</p>
                  ) : (
                    <article className="collab-permission-panel">
                      <header>
                        <h4>{selectedPermission.label}</h4>
                        <p>{selectedPermission.description}</p>
                        <small>Origem atual: {getGrantDisplayName(selectedPermission.assignment?.grantedBy)}</small>
                      </header>

                      <div className="collab-permission-steps">
                        <section>
                          <h5>Passo 1 · Estado</h5>
                          <div className="collab-choice-row">
                            <button
                              type="button"
                              className={selectedPermissionDraft.enabled ? 'is-active' : ''}
                              onClick={() => setPermissionDrafts((current) => ({
                                ...current,
                                [selectedPermission.id]: { ...selectedPermissionDraft, enabled: true },
                              }))}
                              disabled={!canManagePermissions || selectedUserAccessTotal}
                            >
                              Ativar
                            </button>
                            <button
                              type="button"
                              className={!selectedPermissionDraft.enabled ? 'is-active' : ''}
                              onClick={() => setPermissionDrafts((current) => ({
                                ...current,
                                [selectedPermission.id]: { ...selectedPermissionDraft, enabled: false },
                              }))}
                              disabled={!canManagePermissions || selectedUserAccessTotal}
                            >
                              Desativar
                            </button>
                          </div>
                          {selectedUserAccessTotal && <small>Acesso total ativo: todas as permissões estão efetivamente ativas.</small>}
                        </section>

                        <section>
                          <h5>Passo 2 · Restrições rápidas</h5>
                          <div className="collab-permission-form-grid">
                            <label>
                              <span>Países</span>
                              <div className="collab-token-row">
                                {['PT', 'BR'].map((country) => (
                                  <button
                                    key={country}
                                    type="button"
                                    className={selectedRestrictionCountries.includes(country) ? 'is-selected' : ''}
                                    onClick={() => setPermissionDrafts((current) => ({
                                      ...current,
                                      [selectedPermission.id]: {
                                        ...selectedPermissionDraft,
                                        restrictedToCountries: toggleCommaItem(selectedPermissionDraft.restrictedToCountries, country),
                                      },
                                    }))}
                                    disabled={!canManagePermissions || selectedUserAccessTotal}
                                  >
                                    {country}
                                  </button>
                                ))}
                              </div>
                              <small>Opcional: se não marcares nenhum país, a permissão aplica-se a todos.</small>
                            </label>

                            <label>
                              <span>Escopo adicional (opcional)</span>
                              <input
                                type="text"
                                value={selectedPermissionDraft.restrictedToLevels}
                                onChange={(event) => setPermissionDrafts((current) => ({
                                  ...current,
                                  [selectedPermission.id]: {
                                    ...selectedPermissionDraft,
                                    restrictedToLevels: event.target.value,
                                  },
                                }))}
                                placeholder="Ex: etiquetas internas separadas por vírgula"
                                disabled={!canManagePermissions || selectedUserAccessTotal}
                              />
                              <small>Opcional: usa apenas se a tua operação tiver etiquetas de escopo próprias.</small>
                            </label>

                            <label>
                              <span>Equipas</span>
                              <div className="collab-team-selector">
                                <select
                                  value={pendingTeamToAdd}
                                  onChange={(event) => setPendingTeamToAdd(event.target.value)}
                                  disabled={!canManagePermissions || selectedUserAccessTotal || availableTeamsToAdd.length === 0}
                                >
                                  <option value="">Selecionar equipa</option>
                                  {availableTeamsToAdd.map((team) => (
                                    <option key={team.id} value={team.id}>{team.name}</option>
                                  ))}
                                </select>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => addTeamRestriction(pendingTeamToAdd)}
                                  disabled={!canManagePermissions || selectedUserAccessTotal || !pendingTeamToAdd}
                                >
                                  Adicionar
                                </Button>
                              </div>
                              {selectedRestrictedTeams.length > 0 && (
                                <div className="collab-team-chips">
                                  {selectedRestrictedTeams.map((team) => (
                                    <button
                                      key={team.id}
                                      type="button"
                                      className="collab-team-chip"
                                      onClick={() => removeTeamRestriction(team.id)}
                                      disabled={!canManagePermissions || selectedUserAccessTotal}
                                    >
                                      {team.name} ×
                                    </button>
                                  ))}
                                </div>
                              )}
                              <small>Opcional: se não adicionares equipas, a permissão aplica-se a todas.</small>
                            </label>

                            <label>
                              <span>Notas</span>
                              <input
                                type="text"
                                value={selectedPermissionDraft.notes}
                                onChange={(event) => setPermissionDrafts((current) => ({
                                  ...current,
                                  [selectedPermission.id]: {
                                    ...selectedPermissionDraft,
                                    notes: event.target.value,
                                  },
                                }))}
                                placeholder="Contexto opcional para esta permissão"
                                disabled={!canManagePermissions || selectedUserAccessTotal}
                              />
                            </label>

                          </div>
                        </section>

                        <section>
                          <h5>Passo 3 · Confirmar</h5>
                          <div className="permission-card__footer">
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              isLoading={savingPermissionId === selectedPermission.id}
                              onClick={() => void savePermission(selectedPermission)}
                              disabled={!canManagePermissions || selectedUserAccessTotal}
                            >
                              Guardar configuração
                            </Button>
                          </div>
                          {selectedUserAccessTotal && <small>Para editar esta permissão individual, revoga primeiro o acesso total.</small>}
                        </section>
                      </div>
                    </article>
                  )}
                </section>
              </div>
            </section>
          )}

          {!isLoadingDetails && selectedRow && detailsTab === 'estado' && (
            <section className="collaborator-modal-panel">
              <div className="collaborator-kpi-grid">
                <article>
                  <span>Conta</span>
                  <strong>{selectedRow.isActive ? 'Ativa' : 'Inativa'}</strong>
                </article>
                <article>
                  <span>Acesso total</span>
                  <strong>{selectedUserAccessTotal ? 'Sim' : 'Não'}</strong>
                </article>
              </div>

              <div className="collaborator-status-actions">
                <Button
                  type="button"
                  variant={selectedRow.isActive ? 'danger' : 'secondary'}
                  onClick={() => openActiveConfirm(selectedRow)}
                  disabled={!canManageActive || selectedRow.username === 't.people'}
                >
                  {selectedRow.isActive ? 'Desativar conta' : 'Reativar conta'}
                </Button>
              </div>
            </section>
          )}
        </section>
      </Modal>

      <Modal
        open={Boolean(activeConfirmTarget)}
        title={activeConfirmTarget?.isActive ? 'Confirmar desativação' : 'Confirmar reativação'}
        onClose={() => setActiveConfirmTarget(null)}
        width="min(640px, 92vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setActiveConfirmTarget(null)}>Cancelar</Button>
            <Button
              type="button"
              variant={activeConfirmTarget?.isActive ? 'danger' : 'primary'}
              isLoading={Boolean(activeConfirmTarget && busyUserId === activeConfirmTarget.id)}
              disabled={Boolean(activeConfirmTarget && busyUserId === activeConfirmTarget.id)}
              onClick={() => void confirmToggleActive()}
            >
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="permissions-access-modal">
          <p>
            {activeConfirmTarget?.isActive
              ? `Isto vai desativar a conta de ${getDisplayName(activeConfirmTarget)}.`
              : `Isto vai reativar a conta de ${activeConfirmTarget ? getDisplayName(activeConfirmTarget) : 'este colaborador'}.`}
          </p>
        </div>
      </Modal>

      <Modal
        open={accessTotalModalOpen}
        title={accessTotalAction === 'grant' ? 'Dar acesso total' : 'Revogar acesso total'}
        onClose={() => setAccessTotalModalOpen(false)}
        width="min(720px, 92vw)"
        showCloseButton={false}
        footer={
          <div className="modal-footer-split">
            <Button type="button" variant="ghost" onClick={() => setAccessTotalModalOpen(false)}>Cancelar</Button>
            <Button
              type="button"
              variant={accessTotalAction === 'grant' ? 'primary' : 'danger'}
              isLoading={isTogglingAccessTotal}
              disabled={isTogglingAccessTotal}
              onClick={() => {
                void (async () => {
                  const success = await toggleAccessTotalForSelected(accessTotalAction === 'grant', accessTotalReason);
                  if (success) {
                    setAccessTotalModalOpen(false);
                    setAccessTotalReason('');
                  }
                })();
              }}
            >
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="permissions-access-modal">
          <p>
            {accessTotalAction === 'grant'
              ? 'Isto vai conceder acesso total a todas as permissões deste utilizador.'
              : 'Isto vai revogar o acesso total e repor as permissões padrão de funcionário.'}
          </p>
        </div>
      </Modal>

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}
