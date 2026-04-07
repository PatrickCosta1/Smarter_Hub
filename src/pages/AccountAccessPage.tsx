import { FormEvent, useEffect, useState } from 'react';
import { apiRequest, authHeaders } from '../portal/api';

type MeResponse = {
  user: {
    id: string;
    username: string;
    email: string;
    role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  };
};

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

export default function AccountAccessPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [status, setStatus] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void loadMe();
  }, []);

  async function loadMe() {
    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';

    try {
      const data = await apiRequest<MeResponse>('/auth/me', {
        headers: authHeaders(token),
      });

      setUsername(data.user.username);
      setEmail(data.user.email);
      setRole(data.user.role);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao carregar dados da conta.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentPassword.trim()) {
      setStatus('Indica a password atual.');
      return;
    }

    if (newPassword && newPassword.length < 4) {
      setStatus('A nova password deve ter pelo menos 4 caracteres.');
      return;
    }

    if (newPassword && newPassword !== confirmNewPassword) {
      setStatus('A confirmação da nova password não coincide.');
      return;
    }

    setIsSaving(true);
    setStatus('A guardar alterações de acesso...');

    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';

    try {
      const payload: { username: string; currentPassword: string; newPassword?: string } = {
        username: username.trim().toLowerCase(),
        currentPassword,
      };

      if (newPassword) {
        payload.newPassword = newPassword;
      }

      const response = await apiRequest<{ token: string; user: MeResponse['user'] }>('/auth/account', {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify(payload),
      });

      localStorage.setItem(STORAGE_TOKEN_KEY, response.token);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setUsername(response.user.username);
      setStatus('Dados de acesso atualizados com sucesso.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao atualizar dados de acesso.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="account-shell">
      <header className="account-hero">
        <p className="account-kicker">Perfil de acesso</p>
        <h1>Identidade e segurança</h1>
        <p>Edita o username e a password usados no login ao sistema.</p>
      </header>

      <section className="account-card">
        <div className="account-meta">
          <div>
            <span>Email</span>
            <strong>{email || '-'}</strong>
          </div>
        </div>

        <form className="account-form" onSubmit={handleSubmit}>
          <label>
            <span>Username</span>
            <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>

          <label>
            <span>Password atual *</span>
            <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>

          <label>
            <span>Nova password</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="" />
          </label>

          <label>
            <span>Confirmar nova password</span>
            <input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="" />
          </label>

          <div className="account-actions">
            <button type="submit" className="cta-button cta-primary" disabled={isSaving}>
              {isSaving ? 'A guardar...' : 'Guardar alterações'}
            </button>
          </div>
        </form>

        {status && <p className="account-status">{status}</p>}
      </section>
    </section>
  );
}
