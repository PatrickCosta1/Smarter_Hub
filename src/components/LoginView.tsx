import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../portal/context';

type FormErrors = {
  username?: string;
  password?: string;
};

type FieldName = keyof FormErrors;

function validateLogin(username: string, password: string): FormErrors {
  const errors: FormErrors = {};

  if (!username.trim()) {
    errors.username = 'O utilizador é obrigatório.';
  }

  if (!password.trim()) {
    errors.password = 'A palavra-passe é obrigatória.';
  } else if (password.trim().length < 4) {
    errors.password = 'A palavra-passe deve ter pelo menos 4 caracteres.';
  }

  return errors;
}

export default function LoginView() {
  const navigate = useNavigate();
  const { login } = usePortal();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    username: false,
    password: false,
  });
  const [statusType, setStatusType] = useState<'idle' | 'error' | 'success'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  const canSubmit = useMemo(() => !isSubmitting, [isSubmitting]);

  function touchField(fieldName: FieldName) {
    setTouched((current) => ({ ...current, [fieldName]: true }));
  }

  function fieldError(fieldName: FieldName) {
    if (!touched[fieldName]) {
      return '';
    }

    return errors[fieldName] || '';
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formErrors = validateLogin(username, password);
    setErrors(formErrors);
    setTouched({ username: true, password: true });

    if (Object.keys(formErrors).length > 0) {
      setStatusType('error');
      setStatusMessage('Revise os campos destacados.');
      return;
    }

    setIsSubmitting(true);
    setStatusType('idle');
    setStatusMessage('');

    const result = await login(username, password);
    setIsSubmitting(false);

    if (!result.success) {
      setStatusType('error');
      setStatusMessage(result.message || 'Credenciais inválidas.');
      return;
    }

    setStatusType('success');
    setStatusMessage('Login efetuado com sucesso.');
    navigate('/');
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
              <img src="/logo.png" alt="Tlantic" />
            </div>
          </div>

          <div className="auth-headline">
            <h2 id="login-title">Smarter Hub</h2>
            <p className="auth-copy">Acede ao portal com as tuas credenciais.</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>Utilizador</span>
              <div className={`input-shell${fieldError('username') ? ' is-error' : ''}`}>
                <span className="input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21a8 8 0 0 0-16 0" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <input
                  type="text"
                  name="username"
                  placeholder="Ex: patrick"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => {
                    const value = event.target.value;
                    setUsername(value);
                    setErrors(validateLogin(value, password));
                  }}
                  onBlur={() => touchField('username')}
                  aria-invalid={fieldError('username') ? 'true' : 'false'}
                  aria-describedby={fieldError('username') ? 'username-error' : undefined}
                />
              </div>
              {fieldError('username') && (
                <p className="field-error" id="username-error" role="alert">
                  {fieldError('username')}
                </p>
              )}
            </label>

            <label className="field">
              <span>Palavra-passe</span>
              <div className={`input-shell${fieldError('password') ? ' is-error' : ''}`}>
                <span className="input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="10" width="16" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="Ex: 1212"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPassword(value);
                    setErrors(validateLogin(username, value));
                  }}
                  onBlur={() => touchField('password')}
                  aria-invalid={fieldError('password') ? 'true' : 'false'}
                  aria-describedby={fieldError('password') ? 'password-error' : undefined}
                />
                <button className="input-action" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}>
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              {fieldError('password') && (
                <p className="field-error" id="password-error" role="alert">
                  {fieldError('password')}
                </p>
              )}
            </label>

            <div className="form-meta">
              <label className="remember-me">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>Lembrar-me</span>
              </label>

              <button type="button" className="text-button">
                Esqueceu a palavra-passe?
              </button>
            </div>

            <button className="submit-button" type="submit" disabled={!canSubmit}>
              {isSubmitting ? (
                <span className="button-loading" aria-hidden="true">
                  <span className="loading-dot" />
                  A entrar...
                </span>
              ) : (
                'Entrar no portal'
              )}
            </button>

            <p className={`status-line status-${statusType}`} aria-live="polite">
              {statusMessage || ''}
            </p>
          </form>

          <footer className="auth-footer">
            <span>© 2026 Tlantic</span>
          </footer>
        </section>
      </section>
    </main>
  );
}
