import { useEffect, useState } from 'react';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

type ToastProps = {
  show: boolean;
  tone?: ToastTone;
  message: string;
  onClose?: () => void;
};

function resolveToneLabel(tone: ToastTone) {
  if (tone === 'success') {
    return 'Sucesso';
  }

  if (tone === 'error') {
    return 'Falha';
  }

  if (tone === 'warning') {
    return 'Aviso';
  }

  return 'Informação';
}

function resolveToneIcon(tone: ToastTone) {
  if (tone === 'success') {
    return '✓';
  }

  if (tone === 'error') {
    return '!';
  }

  if (tone === 'warning') {
    return '⚠';
  }

  return 'i';
}

export default function Toast({ show, tone = 'info', message, onClose }: ToastProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (show) {
      setDismissed(false);
    }
  }, [show, message]);

  if (!show || dismissed) {
    return null;
  }

  const close = () => {
    setDismissed(true);
    onClose?.();
  };

  return (
    <div className={`ui-feedback-overlay ui-feedback-overlay--${tone}`} aria-live="polite" role="status">
      <article className={`ui-feedback-card ui-feedback-card--${tone} ui-toast ui-toast--${tone} is-show`}>
        <div className="ui-feedback-card__badge" aria-hidden="true">{resolveToneIcon(tone)}</div>
        <div className="ui-feedback-card__content">
          <strong>{resolveToneLabel(tone)}</strong>
          <p>{message}</p>
        </div>
        <button type="button" className="ui-feedback-card__close" onClick={close} aria-label="Fechar mensagem">
          Fechar
        </button>
      </article>
    </div>
  );
}
