import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache, isAbortError } from '../portal/api';
import { getStoredAuthToken } from '../portal/auth-storage';
import { usePortal } from '../portal/context';
import { formatRoleLabel } from '../portal/labels';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Toast from '../components/ui/Toast';

type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  teamId: string | null;
  teamName: string | null;
  workCountry: 'PT' | 'BR';
  localidade: string;
  profile?: {
    nomeAbreviado?: string;
    nomeCompleto?: string;
    workCountry?: 'PT' | 'BR';
  } | null;
};

function getAuthHeaders() {
  const token = getStoredAuthToken();
  return authHeaders(token);
}

function getDisplayName(user?: { username: string; profile?: { nomeAbreviado?: string; nomeCompleto?: string } | null } | null) {
  const shortName = user?.profile?.nomeAbreviado?.trim();
  if (shortName) {
    return shortName;
  }

  const fullName = user?.profile?.nomeCompleto ?? '';
  return fullName || user?.username || '-';
}

function normalizeUsernamePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function buildAutoUsername(firstName: string, lastName: string) {
  const first = normalizeUsernamePart(firstName);
  const last = normalizeUsernamePart(lastName);

  if (!first && !last) {
    return '';
  }
  if (!first) {
    return last;
  }
  if (!last) {
    return first;
  }

  return `${first}.${last}`;
}

function buildAutoEmailFromName(firstName: string, lastName: string) {
  const username = buildAutoUsername(firstName, lastName);
  if (!username) {
    return '';
  }

  return `${username}@tlantic.com`;
}

function resolveStatusTone(message: string): 'success' | 'error' | 'info' {
  const normalized = message.toLowerCase();
  if (normalized.includes('falha') || normalized.includes('erro') || normalized.includes('não foi possível') || normalized.includes('obrigat')) {
    return 'error';
  }

  if (normalized.includes('sucesso') || normalized.includes('criad') || normalized.includes('atualiz')) {
    return 'success';
  }

  return 'info';
}

export default function AdminPage() {
  const { hasPermission, isRootAccess, isAccessTotal, currentUser } = usePortal();
  const canAccess = isRootAccess || hasPermission('edit_user');
  const canEditCredentials = Boolean(currentUser?.isRootAccess) || currentUser?.username === 't.people';
  const canCreateUser = Boolean(isAccessTotal);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | AdminUser['role']>('ALL');
  const [sortBy, setSortBy] = useState<'username' | 'email' | 'teamName'>('username');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [credentialsDraft, setCredentialsDraft] = useState({ username: '', email: '' });
  const loadDataInFlightRef = useRef<Promise<void> | null>(null);
  const [newUserDraft, setNewUserDraft] = useState({
    fullName: '',
    username: '',
    email: '',
    workCountry: 'PT' as 'PT' | 'BR',
  });

  const PAGE_SIZE = 10;

  const filteredUsers = useMemo(() => {
    const normalizedQuery = userQuery.trim().toLowerCase();

    return users
      .filter((item) => item.id !== currentUser?.id)
      .filter((item) => (roleFilter === 'ALL' ? true : item.role === roleFilter))
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }

        return [getDisplayName(item), item.email, item.teamName ?? '', formatRoleLabel(item.role)]
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
  }, [users, roleFilter, userQuery, sortBy, sortDirection, currentUser?.id]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));

  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredUsers.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredUsers, currentPage]);

  useEffect(() => {
    if (!canAccess) {
      return;
    }

    const controller = new AbortController();

    void loadData(controller.signal);

    return () => controller.abort();
  }, [canAccess]);

  useEffect(() => {
    setCurrentPage(1);
  }, [userQuery, roleFilter, sortBy, sortDirection]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!editingUser) {
      setCredentialsDraft({ username: '', email: '' });
      return;
    }

    setCredentialsDraft({
      username: editingUser.username,
      email: editingUser.email,
    });
  }, [editingUser]);

  useEffect(() => {
    const parts = newUserDraft.fullName.trim().split(/\s+/).filter(p => p.length > 0);
    const firstName = parts[0] || '';
    const lastName = parts[parts.length - 1] || '';
    setNewUserDraft((current) => ({
      ...current,
      username: buildAutoUsername(firstName, lastName),
      email: buildAutoEmailFromName(firstName, lastName),
    }));
  }, [newUserDraft.fullName]);

  async function loadData(signal?: AbortSignal) {
    if (signal?.aborted) {
      return;
    }

    setIsLoadingData(users.length === 0);

    if (!loadDataInFlightRef.current) {
      loadDataInFlightRef.current = (async () => {
        try {
          const usersData = await apiRequestCached<AdminUser[]>('/admin/users', { headers: getAuthHeaders(), signal }, 15000);
          setUsers(usersData);
        } catch (error) {
          if (isAbortError(error) || signal?.aborted) {
            return;
          }

          setStatus(error instanceof Error ? error.message : 'Falha ao carregar dados de administração.');
        } finally {
          loadDataInFlightRef.current = null;
        }
      })();
    }

    try {
      await loadDataInFlightRef.current;
    } finally {
      if (!signal?.aborted) {
        setIsLoadingData(false);
      }
    }
  }

  function openEditModal(user: AdminUser) {
    setEditingUser(user);
    setIsEditModalOpen(true);
  }

  function closeEditModal() {
    setIsEditModalOpen(false);
    setEditingUser(null);
    setCredentialsDraft({ username: '', email: '' });
  }

  function openCreateModal() {
    setNewUserDraft({ fullName: '', username: '', email: '', workCountry: 'PT' });
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
    setNewUserDraft({ fullName: '', username: '', email: '', workCountry: 'PT' });
  }

  async function createUser() {
    const parts = newUserDraft.fullName.trim().split(/\s+/).filter(p => p.length > 0);
    const firstName = parts[0] || '';
      const lastName = parts[parts.length - 1] || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const username = newUserDraft.username.trim().toLowerCase();
    const email = newUserDraft.email.trim().toLowerCase();
    const workCountry = newUserDraft.workCountry;

    if (!firstName || !lastName || !username || !email) {
      setStatus('Preenche nome completo, username e email.');
      return;
    }

    setIsCreatingUser(true);
    try {
      const created = await apiRequest<{
        id: string;
        username: string;
        email: string;
        role: AdminUser['role'];
        teamId?: string | null;
        profile?: AdminUser['profile'];
      }>('/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          fullName,
          username,
          email,
          role: 'COLABORADOR',
          workCountry,
        }),
      });

      clearApiCache('/admin/users');
      setUsers((current) => [
        {
          id: created.id,
          username: created.username,
          email: created.email,
          role: created.role,
          teamId: created.teamId ?? null,
          teamName: null,
          workCountry,
          localidade: '',
          profile: created.profile ?? null,
        },
        ...current,
      ]);
      closeCreateModal();
      setStatus('Novo utilizador criado com permissões padrão de funcionário.');
      void loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao criar utilizador.');
    } finally {
      setIsCreatingUser(false);
    }
  }

  async function saveCredentials() {
    if (!editingUser) {
      return;
    }

    const username = credentialsDraft.username.trim().toLowerCase();
    const email = credentialsDraft.email.trim().toLowerCase();

    if (!username || !email) {
      setStatus('Username e email são obrigatórios.');
      return;
    }

    const payload: { username?: string; email?: string } = {};
    if (username !== editingUser.username) {
      payload.username = username;
    }
    if (email !== editingUser.email) {
      payload.email = email;
    }

    if (Object.keys(payload).length === 0) {
      setStatus('Sem alterações para guardar.');
      return;
    }

    setIsSavingCredentials(true);
    try {
      await apiRequest(`/admin/users/${editingUser.id}/credentials`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      clearApiCache('/admin/users');
      setUsers((current) => current.map((item) => (
        item.id === editingUser.id
          ? { ...item, username: payload.username ?? item.username, email: payload.email ?? item.email }
          : item
      )));
      closeEditModal();
      setStatus('Credenciais atualizadas com sucesso.');
      void loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar credenciais.');
    } finally {
      setIsSavingCredentials(false);
    }
  }

  if (!canAccess) {
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

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <div className="modal-footer-split">
            <h3>Utilizadores</h3>
            {canCreateUser && (
              <Button type="button" variant="primary" size="sm" onClick={openCreateModal}>Novo utilizador</Button>
            )}
          </div>
          <div className="admin-users-filters">
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
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'username' | 'email' | 'teamName')}>
                <option value="username">Nome de utilizador</option>
                <option value="email">Email</option>
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

        <div className="admin-users-table">
          <DataTable
            columns={[
            {
              key: 'username',
              header: 'Utilizador',
              render: (item: AdminUser) => <span className="admin-cell-truncate" title={getDisplayName(item)}>{getDisplayName(item)}</span>,
            },
            {
              key: 'email',
              header: 'Email',
              render: (item: AdminUser) => <span className="admin-cell-truncate" title={item.email}>{item.email}</span>,
            },
            {
              key: 'country',
              header: 'País',
              render: (item: AdminUser) => <Badge tone="neutral">{item.workCountry}</Badge>,
              align: 'center' as const,
            },
            {
              key: 'actions',
              header: 'Ações',
              align: 'center' as const,
              render: (item: AdminUser) => (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => openEditModal(item)}
                  disabled={!canEditCredentials}
                >
                  Editar
                </Button>
              ),
            },
          ]}
            rows={paginatedUsers}
            rowKey={(item) => item.id}
            emptyMessage="Sem utilizadores para os filtros aplicados."
            loading={isLoadingData}
            loadingLines={3}
            ariaLabel="Utilizadores"
          />
        </div>

        <div className="trainings-form-actions trainings-form-actions--between">
          <small>Página {currentPage} de {totalPages} · {filteredUsers.length} resultado(s)</small>
          <div className="trainings-form-actions__group">
            <Button type="button" variant="ghost" onClick={() => setCurrentPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}>◀</Button>
            <Button type="button" variant="ghost" onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages}>▶</Button>
          </div>
        </div>
      </section>

      {canEditCredentials && (
        <Modal
          open={isEditModalOpen}
          title={editingUser ? `Editar credenciais · ${getDisplayName(editingUser)}` : 'Editar credenciais'}
          onClose={closeEditModal}
          width="min(680px, 94vw)"
          footer={
            <div className="modal-footer-split">
              <Button type="button" variant="ghost" onClick={closeEditModal}>Cancelar</Button>
              <Button type="button" variant="primary" isLoading={isSavingCredentials} onClick={() => void saveCredentials()}>Guardar alterações</Button>
            </div>
          }
        >
          <form className="trainings-form" onSubmit={(event) => { event.preventDefault(); void saveCredentials(); }}>
            <label>
              <span>Username</span>
              <input
                type="text"
                value={credentialsDraft.username}
                onChange={(event) => setCredentialsDraft((current) => ({ ...current, username: event.target.value }))}
                autoComplete="off"
              />
            </label>

            <label>
              <span>Email</span>
              <input
                type="email"
                value={credentialsDraft.email}
                onChange={(event) => setCredentialsDraft((current) => ({ ...current, email: event.target.value }))}
                autoComplete="off"
              />
            </label>
          </form>
        </Modal>
      )}

      {canCreateUser && (
        <Modal
          open={isCreateModalOpen}
          title="Novo utilizador"
          onClose={closeCreateModal}
          width="min(700px, 94vw)"
          footer={
            <div className="modal-footer-split">
              <Button type="button" variant="ghost" onClick={closeCreateModal}>Cancelar</Button>
              <Button type="button" variant="primary" isLoading={isCreatingUser} onClick={() => void createUser()}>Criar utilizador</Button>
            </div>
          }
        >
          <form className="trainings-form" onSubmit={(event) => { event.preventDefault(); void createUser(); }}>
            <label>
              <span>Nome completo</span>
              <input
                type="text"
                value={newUserDraft.fullName}
                onChange={(event) => setNewUserDraft((current) => ({ ...current, fullName: event.target.value }))}
                autoComplete="off"
              />
            </label>

            <label>
              <span>Username</span>
              <input
                type="text"
                value={newUserDraft.username}
                onChange={(event) => setNewUserDraft((current) => ({ ...current, username: event.target.value }))}
                autoComplete="off"
              />
            </label>

            <label>
              <span>Email</span>
              <input
                type="email"
                value={newUserDraft.email}
                onChange={(event) => setNewUserDraft((current) => ({ ...current, email: event.target.value }))}
                autoComplete="off"
              />
            </label>
            <label>
              <span>País</span>
              <select
                value={newUserDraft.workCountry}
                onChange={(event) => setNewUserDraft((current) => ({ ...current, workCountry: event.target.value as 'PT' | 'BR' }))}
              >
                <option value="PT">Portugal</option>
                <option value="BR">Brasil</option>
              </select>
            </label>

            <div className="field-span-2">
              <small>O utilizador será criado como colaborador e entra exclusivamente com Microsoft (sem password local).</small>
            </div>
          </form>
        </Modal>
      )}

      <Toast show={Boolean(status)} tone={resolveStatusTone(status)} message={status} />
    </section>
  );
}