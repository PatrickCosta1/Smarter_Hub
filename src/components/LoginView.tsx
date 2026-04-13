import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithPopup } from 'firebase/auth';
import { usePortal } from '../portal/context';
import { createMicrosoftProvider, firebaseAuth, isFirebaseConfigured } from '../lib/firebase';
import Button from './ui/Button';
import Toast from './ui/Toast';
import './LoginView.css';

export default function LoginView() {
  const navigate = useNavigate();
  const { loginWithMicrosoft, loginWithPassword } = usePortal();
  const localLoginEnabled = import.meta.env.VITE_AUTH_ENABLE_LOCAL_LOGIN === 'true';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);
  const [isMicrosoftSubmitting, setIsMicrosoftSubmitting] = useState(false);
  const [statusType, setStatusType] = useState<'idle' | 'error' | 'success'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  async function handlePasswordLogin() {
    if (!username.trim() || !password.trim()) {
      setStatusType('error');
      setStatusMessage('Indica utilizador e palavra-passe.');
      return;
    }

    setIsPasswordSubmitting(true);
    setStatusType('idle');
    setStatusMessage('');

    const result = await loginWithPassword(username.trim(), password);

    if (!result.success) {
      setStatusType('error');
      setStatusMessage(result.message || 'Falha no login por credenciais.');
      setIsPasswordSubmitting(false);
      return;
    }

    setStatusType('success');
    setStatusMessage('Login efetuado com sucesso.');
    setIsPasswordSubmitting(false);
    navigate('/');
  }

  async function handleMicrosoftLogin() {
    if (!firebaseAuth || !isFirebaseConfigured) {
      setStatusType('error');
      setStatusMessage('Autenticação Microsoft ainda não configurada.');
      return;
    }

    setIsMicrosoftSubmitting(true);
    setStatusType('idle');
    setStatusMessage('');

    try {
      const popupResult = await signInWithPopup(firebaseAuth, createMicrosoftProvider());
      const idToken = await popupResult.user.getIdToken(true);
      const result = await loginWithMicrosoft(idToken);

      if (!result.success) {
        setStatusType('error');
        setStatusMessage(result.message || 'Falha no login com Microsoft.');
        return;
      }

      setStatusType('success');
      setStatusMessage('Login Microsoft efetuado com sucesso.');
      navigate('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha no login Microsoft.';
      setStatusType('error');
      setStatusMessage(message);
    } finally {
      setIsMicrosoftSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-background" aria-hidden="true">
        <span className="shape shape-left" />
        <span className="shape shape-right" />
        <span className="shape shape-bottom" />
        <span className="orbs orb-a" />
        <span className="orbs orb-b" />
        <span className="grid" />
      </div>

      <section className="login-layout">
        <section className="auth-card" aria-labelledby="login-title">
          <div className="auth-card__brand">
            <div className="brand-mark" aria-label="Tlantic">
              <img src="/logo.png" alt="Tlantic" width={1123} height={651} decoding="async" />
            </div>
          </div>

          <div className="auth-headline">
            <h2 id="login-title">Smarter Hub</h2>
            <p className="auth-copy">Usa Microsoft por defeito. Para testes, podes ativar login local por credenciais.</p>
          </div>

          <form className="login-form" onSubmit={(event) => event.preventDefault()}>
            {localLoginEnabled && (
              <>
                <label className="login-input-row">
                  <span>Utilizador</span>
                  <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
                </label>

                <label className="login-input-row">
                  <span>Palavra-passe</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                </label>

                <Button variant="secondary" size="lg" type="button" onClick={() => void handlePasswordLogin()} isLoading={isPasswordSubmitting}>
                  Entrar com utilizador e password
                </Button>

                <div className="login-divider" aria-hidden="true">
                  <span>ou</span>
                </div>
              </>
            )}

            <Button variant="primary" size="lg" type="button" onClick={() => void handleMicrosoftLogin()} isLoading={isMicrosoftSubmitting} disabled={!isFirebaseConfigured}>
              Entrar com Microsoft
            </Button>

            {!isFirebaseConfigured && (
              <p className="auth-copy">Configuração Firebase em falta. Define as variáveis VITE_FIREBASE_* no ficheiro .env do frontend.</p>
            )}

            <Toast
              show={Boolean(statusMessage)}
              tone={statusType === 'error' ? 'error' : statusType === 'success' ? 'success' : 'info'}
              message={statusMessage || ''}
            />
          </form>

          <footer className="auth-footer">
            <span>© 2026 Tlantic</span>
          </footer>
        </section>
      </section>
    </main>
  );
}
