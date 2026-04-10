import { useEffect, useMemo, useState } from 'react';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from '../portal/api';
import { usePortal } from '../portal/context';
import { formatRoleLabel } from '../portal/labels';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';

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
  profile?: {
    nomeAbreviado?: string;
    primeiroNome?: string;
    apelido?: string;
    workCountry?: 'PT' | 'BR';
  } | null;
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
  const [credentialsDraft, setCredentialsDraft] = useState({ username: '', email: '', password: '' });
  const [newUserDraft, setNewUserDraft] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    password: '',
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

    void loadData();
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
      setCredentialsDraft({ username: '', email: '', password: '' });
      return;
    }

    setCredentialsDraft({
      username: editingUser.username,
      email: editingUser.email,
      password: '',
    });
  }, [editingUser]);

  useEffect(() => {
    setNewUserDraft((current) => ({
      ...current,
      username: buildAutoUsername(current.firstName, current.lastName),
      email: buildAutoEmailFromName(current.firstName, current.lastName),
    }));
  }, [newUserDraft.firstName, newUserDraft.lastName]);

  async function loadData() {
    setIsLoadingData(true);
    try {
      const usersData = await apiRequestCached<AdminUser[]>('/admin/users', { headers: getAuthHeaders() }, 15000);

      setUsers(usersData);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar dados de administração.');
    } finally {
      setIsLoadingData(false);
    }
  }

  function openEditModal(user: AdminUser) {
    setEditingUser(user);
    setIsEditModalOpen(true);
  }

  function closeEditModal() {
    setIsEditModalOpen(false);
    setEditingUser(null);
    setCredentialsDraft({ username: '', email: '', password: '' });
  }

  function openCreateModal() {
    setNewUserDraft({ firstName: '', lastName: '', username: '', email: '', password: '' });
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
    setNewUserDraft({ firstName: '', lastName: '', username: '', email: '', password: '' });
  }

  async function createUser() {
    const firstName = newUserDraft.firstName.trim();
    const lastName = newUserDraft.lastName.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const username = newUserDraft.username.trim().toLowerCase();
    const email = newUserDraft.email.trim().toLowerCase();
    const password = newUserDraft.password.trim();

    if (!firstName || !lastName || !username || !email || !password) {
      setStatus('Preenche primeiro nome, apelido, email e password.');
      return;
    }

    if (password.length < 4) {
      setStatus('A password deve ter pelo menos 4 caracteres.');
      return;
    }

    setIsCreatingUser(true);
    try {
      await apiRequest('/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          fullName,
          username,
          email,
          password,
          role: 'COLABORADOR',
        }),
      });

      clearApiCache('/admin/users');
      await loadData();
      closeCreateModal();
      setStatus('Novo utilizador criado com permissões padrão de funcionário.');
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
    const password = credentialsDraft.password.trim();

    if (!username || !email) {
      setStatus('Username e email são obrigatórios.');
      return;
    }

    if (password && password.length < 4) {
      setStatus('A password deve ter pelo menos 4 caracteres.');
      return;
    }

    const payload: { username?: string; email?: string; password?: string } = {};
    if (username !== editingUser.username) {
      payload.username = username;
    }
    if (email !== editingUser.email) {
      payload.email = email;
    }
    if (password) {
      payload.password = password;
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
      await loadData();
      closeEditModal();
      setStatus('Credenciais atualizadas com sucesso.');
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
      <header className="trainings-hero">
        <div>
          <p className="hero-kicker">Administração</p>
          <h2>Gestão de utilizadores</h2>
          <p>Painel de controlo para consulta e edição segura de contas.</p>
        </div>
      </header>

      <section className="trainings-list-card">
        <div className="trainings-list-head">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
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

        <div className="trainings-form-actions" style={{ justifyContent: 'space-between' }}>
          <small>Página {currentPage} de {totalPages} · {filteredUsers.length} resultado(s)</small>
          <div style={{ display: 'flex', gap: 8 }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
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

            <label className="field-span-2">
              <span>Nova password (opcional)</span>
              <input
                type="password"
                value={credentialsDraft.password}
                onChange={(event) => setCredentialsDraft((current) => ({ ...current, password: event.target.value }))}
                autoComplete="new-password"
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
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 12 }}>
              <Button type="button" variant="ghost" onClick={closeCreateModal}>Cancelar</Button>
              <Button type="button" variant="primary" isLoading={isCreatingUser} onClick={() => void createUser()}>Criar utilizador</Button>
            </div>
          }
        >
          <form className="trainings-form" onSubmit={(event) => { event.preventDefault(); void createUser(); }}>
            <label>
              <span>Primeiro nome</span>
              <input
                type="text"
                value={newUserDraft.firstName}
                onChange={(event) => setNewUserDraft((current) => ({ ...current, firstName: event.target.value }))}
                autoComplete="off"
              />
            </label>

            <label>
              <span>Apelido</span>
              <input
                type="text"
                value={newUserDraft.lastName}
                onChange={(event) => setNewUserDraft((current) => ({ ...current, lastName: event.target.value }))}
                autoComplete="off"
              />
            </label>

            <label>
              <span>Username</span>
              <input
                type="text"
                value={newUserDraft.username}
                readOnly
                autoComplete="off"
              />
            </label>

            <label>
              <span>Email</span>
              <input
                type="email"
                value={newUserDraft.email}
                readOnly
                autoComplete="off"
              />
            </label>

            <label>
              <span>Password inicial</span>
              <input
                type="password"
                value={newUserDraft.password}
                onChange={(event) => setNewUserDraft((current) => ({ ...current, password: event.target.value }))}
                autoComplete="new-password"
              />
            </label>

            <div className="field-span-2">
              <small>O utilizador será criado como colaborador e recebe automaticamente as permissões padrão de funcionário.</small>
            </div>
          </form>
        </Modal>
      )}

      {status && <p className="trainings-status">{status}</p>}
    </section>
  );
}