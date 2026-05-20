import { useEffect, useState } from 'react';
import { apiRequestCached, authHeaders, isAbortError } from '../portal/api';
import { getStoredAuthToken } from '../portal/auth-storage';
import { formatRoleLabel } from '../portal/labels';
import { useFeedbackToast } from '../portal/useFeedbackToast';
import Toast from '../components/ui/Toast';

type MeResponse = {
  user: {
    id: string;
    username: string;
    email: string;
    role: 'COLABORADOR' | 'MANAGER' | 'COORDENADOR' | 'ADMIN' | 'CONVIDADO';
  };
};

export default function AccountAccessPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const { toast, showToast } = useFeedbackToast();

  useEffect(() => {
    const controller = new AbortController();

    void loadMe(controller.signal);

    return () => controller.abort();
  }, []);

  async function loadMe(signal?: AbortSignal) {
    const token = getStoredAuthToken();

    try {
      const data = await apiRequestCached<MeResponse>('/auth/me', {
        headers: authHeaders(token),
        signal,
      }, 20000);

      setUsername(data.user.username);
      setEmail(data.user.email);
      setRole(data.user.role);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return;
      }

      showToast('error', 'Não foi possível carregar os teus dados de acesso.');
    }
  }

  return (
    <section className="account-shell">
      <header className="account-hero">
        <p className="account-kicker">Perfil de acesso</p>
        <h1>Identidade e segurança</h1>
        <p>O Smarter Hub usa autenticação exclusiva com Microsoft. A gestão de password local foi desativada.</p>
      </header>

      <section className="account-card">
        <div className="account-meta">
          <div>
            <span>Email Microsoft</span>
            <strong>{email || '-'}</strong>
          </div>
          <div>
            <span>Tipo de conta</span>
            <strong>{formatRoleLabel(role || '-')}</strong>
          </div>
          <div>
            <span>Identificador interno</span>
            <strong>{username || '-'}</strong>
          </div>
        </div>

        <div className="account-form">
          <p>Para alterar credenciais de login (Microsoft), usa os canais oficiais do Microsoft 365/Entra ID da empresa.</p>
          <p>Se precisares de acesso adicional ao Smarter Hub, contacta um administrador para ajuste de permissões.</p>
        </div>

        <Toast show={toast.visible} tone={toast.tone} message={toast.message} />
      </section>
    </section>
  );
}
