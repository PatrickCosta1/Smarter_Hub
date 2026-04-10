import { ReactNode, useEffect } from 'react';
import Button from './Button';

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  footer?: ReactNode;
  showCloseButton?: boolean;
};

export default function Modal({ open, title, onClose, children, width, footer, showCloseButton = true }: ModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="quick-overlay" onClick={onClose} role="presentation">
      <article
        className="quick-modal ui-modal"
        style={width ? { width } : undefined}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="quick-modal__head">
          <h3>{title}</h3>
          {showCloseButton && (
            <Button variant="ghost" size="sm" type="button" onClick={onClose} aria-label="Fechar">
              Fechar
            </Button>
          )}
        </header>

        <div className="ui-modal__body">{children}</div>

        {footer ? <footer className="ui-modal__footer">{footer}</footer> : null}
      </article>
    </div>
  );
}
