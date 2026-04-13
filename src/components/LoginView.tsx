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
  const { loginWithMicrosoft } = usePortal();
  const [isMicrosoftSubmitting, setIsMicrosoftSubmitting] = useState(false);
  const [statusType, setStatusType] = useState<'idle' | 'error' | 'success'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

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
            <p className="auth-copy"></p>
          </div>

          <form className="login-form" onSubmit={(event) => event.preventDefault()}>
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
