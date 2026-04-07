import { useEffect, useMemo, useState } from 'react';
import { apiRequest, authHeaders } from '../portal/api';
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
};

type Team = {
  id: string;
  name: string;
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

  async function loadData() {
    try {
      const [usersData, teamsData] = await Promise.all([
        apiRequest<AdminUser[]>('/admin/users', { headers: getAuthHeaders() }),
        apiRequest<Team[]>('/teams', { headers: getAuthHeaders() }),
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