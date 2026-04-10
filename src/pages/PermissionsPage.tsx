import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatRoleLabel } from '../portal/labels';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Skeleton from '../components/ui/Skeleton';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

const PERMISSION_CATEGORIES = ['SYSTEM', 'USERS', 'TEAMS', 'VACATIONS', 'TRAININGS', 'PROFILE', 'RECEIPTS', 'NOTIFICATIONS'] as const;

type PermissionCategory = typeof PERMISSION_CATEGORIES[number];

type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  isActive: boolean;
  isRootAccess?: boolean;
  profile?: {
    nomeAbreviado?: string;
    primeiroNome?: string;
    apelido?: string;
    workCountry?: 'PT' | 'BR';
    localidade?: string;
  } | null;
  teamName?: string | null;
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
  grantedById: string | null;
  grantedAt: string;
  updatedAt: string;
  grantedBy?: PermissionGrantUser | null;
};

type PermissionItem = {
  id: string;
  code: string;
  label: string;
  description: string;
  category: PermissionCategory;
  requiresRestrictions: boolean;
  assignment: PermissionAssignment | null;
};

type PermissionsResponse = {
  user: AdminUser;
  accessTotal: boolean;
  permissions: PermissionItem[];
};

type AuditGrant = {
  id: string;
  action: 'GRANT' | 'REVOKE';
  reason: string | null;
  createdAt: string;
  actorUser?: PermissionGrantUser | null;
  targetUser?: PermissionGrantUser | null;
  permission: {
    id: string;
    code: string;
    label: string;
    category: PermissionCategory;
  };
};

type AuditResponse = {
  total: number;
  limit: number;
  offset: number;
  grants: AuditGrant[];
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

function getDisplayName(user?: { username: string; profile?: { nomeAbreviado?: string; primeiroNome?: string; apelido?: string } | null } | null) {
  const shortName = user?.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = `${user?.profile?.primeiroNome ?? ''} ${user?.profile?.apelido ?? ''}`.trim();
  return fullName || user?.username || '-';
}

function getCategoryLabel(category: PermissionCategory) {
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

function normalizeList(input: string) {
  return input
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function buildDraftFromAssignment(item: PermissionItem): PermissionDraft {
  return {
    enabled: item.assignment?.isEnabled ?? false,
    restrictedToTeams: item.assignment?.restrictedToTeams?.join(', ') ?? '',
    restrictedToCountries: item.assignment?.restrictedToCountries?.join(', ') ?? '',
    restrictedToLevels: item.assignment?.restrictedToLevels?.join(', ') ?? '',
    customRestrictions: item.assignment?.customRestrictions ? JSON.stringify(item.assignment.customRestrictions, null, 2) : '',
    notes: item.assignment?.notes ?? '',
  };
}

export default function PermissionsPage() {
  const { hasPermission, isRootAccess } = usePortal();
  const canAccess = isRootAccess || hasPermission('manage_permissions');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PermissionDraft>>({});
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'ROOT'>('ALL');
  const [category, setCategory] = useState<PermissionCategory>('SYSTEM');
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [savingPermissionId, setSavingPermissionId] = useState<string | null>(null);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [accessTotalModalOpen, setAccessTotalModalOpen] = useState(false);
  const [accessTotalAction, setAccessTotalAction] = useState<'grant' | 'revoke'>('grant');
  const [accessReason, setAccessReason] = useState('');
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return users.filter((user) => {
      if (userFilter === 'ACTIVE' && !user.isActive) return false;
      if (userFilter === 'INACTIVE' && user.isActive) return false;
      if (userFilter === 'ROOT' && !user.isRootAccess) return false;

      if (!normalizedSearch) return true;

      return [user.username, user.email, getDisplayName(user), user.teamName || '', formatRoleLabel(user.role)]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [search, userFilter, users]);

  const categoryPermissions = useMemo(() => permissions.filter((item) => item.category === category), [permissions, category]);
  const accessTotal = selectedUser?.isRootAccess ? true : Boolean(permissions.length > 0 && permissions.every((permission) => permission.assignment?.isEnabled));

  useEffect(() => {
    if (!canAccess) {
      return;
    }

    void loadUsers();
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess || !selectedUserId) {
      return;
    }

    void loadPermissions(selectedUserId);
  }, [canAccess, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId && filteredUsers.length > 0) {
      setSelectedUserId(filteredUsers[0].id);
    }
  }, [filteredUsers, selectedUserId]);

  async function loadUsers() {
    setIsUsersLoading(true);
    try {
      const data = await apiRequestCached<AdminUser[]>('/admin/users', { headers: getAuthHeaders() }, 12000);
      setUsers(data);
      if (!selectedUserId && data.length > 0) {
        setSelectedUserId(data[0].id);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar utilizadores.');
    } finally {
      setIsUsersLoading(false);
    }
  }

  async function loadPermissions(userId: string) {
    setIsDetailsLoading(true);
    try {
      const data = await apiRequestCached<PermissionsResponse>(`/users/${userId}/permissions`, { headers: getAuthHeaders() }, 10000, true);
      setSelectedUser(data.user);
      setPermissions(data.permissions);
      setDrafts(Object.fromEntries(data.permissions.map((permission) => [permission.id, buildDraftFromAssignment(permission)])));
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar permissões.');
    } finally {
      setIsDetailsLoading(false);
    }
  }

  async function savePermission(permission: PermissionItem) {
    if (!selectedUser) {
      return;
    }

    const draft = drafts[permission.id] ?? buildDraftFromAssignment(permission);

    if (!draft.enabled && !permission.assignment) {
      setStatus('Ativa a permissão antes de guardar uma nova atribuição.');
      return;
    }

    setSavingPermissionId(permission.id);

    try {
      if (!draft.enabled) {
        await apiRequest(`/users/${selectedUser.id}/permissions/${permission.id}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
      } else {
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
          reason: `Atualizado manualmente para ${getDisplayName(selectedUser)}.`,
        };

        if (permission.assignment) {
          await apiRequest(`/users/${selectedUser.id}/permissions/${permission.id}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest(`/users/${selectedUser.id}/permissions`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body),
          });
        }
      }

      clearApiCache();
      await loadPermissions(selectedUser.id);
      setStatus('Permissão guardada com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao guardar permissão.');
    } finally {
      setSavingPermissionId(null);
    }
  }

  async function openAudit() {
    if (!selectedUser) {
      return;
    }

    setAuditModalOpen(true);
    setIsLoadingAudit(true);
    try {
      const data = await apiRequestCached<AuditResponse>(`/audit/permission-grants?userId=${selectedUser.id}&limit=50&offset=0`, {
        headers: getAuthHeaders(),
      }, 5000, true);
      setAudit(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar auditoria.');
    } finally {
      setIsLoadingAudit(false);
    }
  }

  async function toggleAccessTotal() {
    if (!selectedUser) {
      return;
    }

    try {
      await apiRequest(`/users/${selectedUser.id}/access-total`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          isEnabled: accessTotalAction === 'grant',
          reason: accessReason.trim() || undefined,
        }),
      });

      clearApiCache();
      setAccessTotalModalOpen(false);
      setAccessReason('');
      await loadUsers();
      await loadPermissions(selectedUser.id);
      setStatus(accessTotalAction === 'grant' ? 'Acesso total concedido.' : 'Acesso total revogado.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao alterar acesso total.');
    }
  }

  if (!canAccess) {
    return (
      <section className="trainings-shell">
        <article className="trainings-list-card">
          <h3>Acesso restrito</h3>
          <p>Esta área está disponível apenas para Admin.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="permissions-shell trainings-shell">
      <header className="trainings-hero permissions-hero">
        <div>
          <p className="hero-kicker">Permissões</p>
          <h2>Gestão granular e delegada</h2>
          <p>Configuração detalhada por utilizador, com acesso total, restrições e auditoria visível.</p>
        </div>

        <div className="trainings-hours-summary permissions-summary">
          <article>
            <span>Utilizadores</span>
            <strong>{filteredUsers.length}</strong>
          </article>
          <article>
            <span>Permissões</span>
            <strong>{permissions.length}</strong>
          </article>
          <article>
            <span>Acesso total</span>
            <strong>{accessTotal ? 'Sim' : 'Não'}</strong>
          </article>
        </div>
      </header>

      <div className="permissions-layout">
        <aside className="permissions-sidebar trainings-list-card">
          <div className="trainings-list-head permissions-sidebar__head">
            <h3>Utilizadores</h3>
            <div className="permissions-sidebar__actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => void loadUsers()}>Atualizar</Button>
            </div>
          </div>

          <div className="permissions-filters">
            <label>
              <span>Pesquisar</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, email, equipa..." />
            </label>
            <label>
              <span>Filtro</span>
              <select value={userFilter} onChange={(event) => setUserFilter(event.target.value as typeof userFilter)}>
                <option value="ALL">Todos</option>
                <option value="ACTIVE">Ativos</option>
                <option value="INACTIVE">Inativos</option>
                <option value="ROOT">Raiz</option>
              </select>
            </label>
          </div>

          <DataTable
            columns={[
              { key: 'user', header: 'Utilizador', render: (item: AdminUser) => (
                <div className="permissions-user-cell">
                  <strong>{getDisplayName(item)}</strong>
                  <small>{item.email}</small>
                  <div className="permissions-user-badges">
                    <Badge tone="info">{formatRoleLabel(item.role)}</Badge>
                    <Badge tone={item.isActive ? 'success' : 'danger'}>{item.isActive ? 'Ativo' : 'Inativo'}</Badge>
                    {item.isRootAccess && <Badge tone="warning">Raiz</Badge>}
                  </div>
                </div>
              ) },
            ]}
            rows={filteredUsers}
            rowKey={(row) => row.id}
            emptyMessage="Sem utilizadores para apresentar."
            loading={isUsersLoading}
            loadingLines={4}
            ariaLabel="Utilizadores para gestão de permissões"
            onRowClick={(row) => setSelectedUserId(row.id)}
            selectedRowKey={selectedUserId || null}
          />
        </aside>

        <main className="permissions-main trainings-list-card">
          <div className="permissions-main__head">
            <div>
              <p className="hero-kicker">Editor</p>
              <h3>{selectedUser ? getDisplayName(selectedUser) : 'Seleciona um utilizador'}</h3>
              {selectedUser && (
                <p>{selectedUser.email} · {selectedUser.profile?.workCountry || 'PT'} · {selectedUser.profile?.localidade || '-'}</p>
              )}
            </div>

            <div className="permissions-main__actions">
              <Button type="button" variant="secondary" onClick={() => { setAccessTotalAction(accessTotal ? 'revoke' : 'grant'); setAccessTotalModalOpen(true); }} disabled={!selectedUser || selectedUser.isRootAccess}>
                {selectedUser?.isRootAccess ? 'Raiz permanente' : accessTotal ? 'Revogar acesso total' : 'Dar acesso total'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void openAudit()} disabled={!selectedUser}>Ver auditoria</Button>
            </div>
          </div>

          <div className="permissions-tabs">
            {PERMISSION_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                className={item === category ? 'is-active' : ''}
                onClick={() => setCategory(item)}
              >
                {getCategoryLabel(item)}
              </button>
            ))}
          </div>

          <div className="permissions-card-grid">
            {isDetailsLoading && (
              <div className="permissions-card-grid permissions-card-grid--loading">
                {Array.from({ length: 3 }).map((_, index) => (
                  <article key={index} className="permission-card permission-card--loading">
                    <Skeleton lines={2} />
                    <Skeleton lines={3} />
                    <Skeleton lines={1} />
                  </article>
                ))}
              </div>
            )}
            {!isDetailsLoading && categoryPermissions.length === 0 && <p className="permissions-empty-state">Sem permissões nesta categoria.</p>}

            {!isDetailsLoading && categoryPermissions.map((permission) => {
              const draft = drafts[permission.id] ?? buildDraftFromAssignment(permission);
              const assignedBy = permission.assignment?.grantedBy ? getDisplayName(permission.assignment.grantedBy) : 'Sistema';
              const isDirty = Boolean(permission.assignment) || draft.enabled;

              return (
                <article key={permission.id} className={`permission-card${draft.enabled ? ' is-enabled' : ''}`}>
                  <header className="permission-card__head">
                    <div>
                      <h4>{permission.label}</h4>
                      <p>{permission.description}</p>
                    </div>
                    <label className="permission-switch">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) => setDrafts((current) => ({ ...current, [permission.id]: { ...draft, enabled: event.target.checked } }))}
                      />
                      <span>{draft.enabled ? 'Ativa' : 'Inativa'}</span>
                    </label>
                  </header>

                  <div className="permission-card__meta">
                    <Badge tone="neutral">{getCategoryLabel(permission.category)}</Badge>
                    {permission.requiresRestrictions && <Badge tone="warning">Requer restrições</Badge>}
                    {permission.assignment?.grantedAt && <span>Concedida em {new Date(permission.assignment.grantedAt).toLocaleString('pt-PT')}</span>}
                    {permission.assignment?.notes && <span>Notas: {permission.assignment.notes}</span>}
                    <span>Origem: {assignedBy}</span>
                  </div>

                  <div className="permission-card__fields">
                    <label>
                      <span>Equipas</span>
                      <textarea
                        value={draft.restrictedToTeams}
                        onChange={(event) => setDrafts((current) => ({ ...current, [permission.id]: { ...draft, restrictedToTeams: event.target.value } }))}
                        placeholder="team-1, team-2"
                        rows={2}
                      />
                    </label>
                    <label>
                      <span>Países</span>
                      <textarea
                        value={draft.restrictedToCountries}
                        onChange={(event) => setDrafts((current) => ({ ...current, [permission.id]: { ...draft, restrictedToCountries: event.target.value } }))}
                        placeholder="PT, BR"
                        rows={2}
                      />
                    </label>
                    <label>
                      <span>Levels</span>
                      <textarea
                        value={draft.restrictedToLevels}
                        onChange={(event) => setDrafts((current) => ({ ...current, [permission.id]: { ...draft, restrictedToLevels: event.target.value } }))}
                        placeholder="COLABORADOR, MANAGER"
                        rows={2}
                      />
                    </label>
                    <label className="field-span-2">
                      <span>Regras avançadas (JSON)</span>
                      <textarea
                        value={draft.customRestrictions}
                        onChange={(event) => setDrafts((current) => ({ ...current, [permission.id]: { ...draft, customRestrictions: event.target.value } }))}
                        placeholder='{"maxDays": 10, "note": "Apenas urgências"}'
                        rows={3}
                      />
                    </label>
                    <label className="field-span-2">
                      <span>Notas internas</span>
                      <textarea
                        value={draft.notes}
                        onChange={(event) => setDrafts((current) => ({ ...current, [permission.id]: { ...draft, notes: event.target.value } }))}
                        placeholder="Contexto ou observações sobre esta permissão"
                        rows={2}
                      />
                    </label>
                  </div>

                  <div className="permission-card__footer">
                    <Button
                      type="button"
                      variant="primary"
                      isLoading={savingPermissionId === permission.id}
                      onClick={() => void savePermission(permission)}
                    >
                      Guardar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setDrafts((current) => ({ ...current, [permission.id]: buildDraftFromAssignment(permission) }))}
                      disabled={!isDirty}
                    >
                      Repor
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </main>
      </div>

      <Modal
        open={auditModalOpen}
        title={`Auditoria · ${selectedUser ? getDisplayName(selectedUser) : ''}`}
        onClose={() => setAuditModalOpen(false)}
        width="min(980px, 96vw)"
        showCloseButton={false}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
            <small>{audit?.total ?? 0} eventos registados</small>
            <Button type="button" variant="ghost" onClick={() => setAuditModalOpen(false)}>Fechar</Button>
          </div>
        }
      >
        {isLoadingAudit ? (
          <div className="permissions-audit-list">
            {Array.from({ length: 3 }).map((_, index) => (
              <article key={index} className="permissions-audit-item">
                <Skeleton lines={2} />
                <Skeleton lines={1} />
              </article>
            ))}
          </div>
        ) : (
          <div className="permissions-audit-list">
            {(audit?.grants ?? []).map((entry) => (
              <article key={entry.id} className="permissions-audit-item">
                <div>
                  <strong>{entry.action === 'GRANT' ? 'Concedido' : 'Revogado'}</strong>
                  <p>{entry.permission.label} · {entry.permission.code}</p>
                </div>
                <small>
                  {getDisplayName(entry.actorUser)} → {getDisplayName(entry.targetUser)} · {new Date(entry.createdAt).toLocaleString('pt-PT')}
                </small>
                {entry.reason && <p>{entry.reason}</p>}
              </article>
            ))}
            {(audit?.grants ?? []).length === 0 && <p>Sem eventos de auditoria para este utilizador.</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={accessTotalModalOpen}
        title={accessTotalAction === 'grant' ? 'Dar acesso total' : 'Revogar acesso total'}
        onClose={() => setAccessTotalModalOpen(false)}
        width="min(720px, 92vw)"
        showCloseButton={false}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%' }}>
            <Button type="button" variant="ghost" onClick={() => setAccessTotalModalOpen(false)}>Cancelar</Button>
            <Button type="button" variant={accessTotalAction === 'grant' ? 'primary' : 'danger'} onClick={() => void toggleAccessTotal()}>
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="permissions-access-modal">
          <p>
            {accessTotalAction === 'grant'
              ? 'Este utilizador vai passar a ter acesso total a todas as permissões disponíveis.'
              : 'Este utilizador vai perder o conjunto completo de permissões que recebeu.'}
          </p>
          <p className="permissions-access-warning">
            {selectedUser?.isRootAccess
              ? 'Este utilizador é raiz permanente; não deve ser alterado por esta via.'
              : 'A operação fica registada no histórico de auditoria.'}
          </p>
          <label>
            <span>Motivo opcional</span>
            <textarea value={accessReason} onChange={(event) => setAccessReason(event.target.value)} rows={4} placeholder="Explica o motivo da alteração" />
          </label>
        </div>
      </Modal>

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}
