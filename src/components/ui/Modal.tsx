import { ReactNode, useEffect, useId, useRef } from 'react';
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
  const modalRef = useRef<HTMLElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const prevBodyOverflowRef = useRef<string>('');

  useEffect(() => {
    if (!open) {
      return;
    }

    prevBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const modalElement = modalRef.current;
    if (modalElement) {
      const focusable = modalElement.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        modalElement.focus();
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }

      if (event.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
          return;
        }

        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevBodyOverflowRef.current;
      if (lastFocusedElementRef.current) {
        lastFocusedElementRef.current.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const showHeaderClose = showCloseButton;

  return (
    <div className="quick-overlay" onClick={onClose} role="presentation">
      <article
        className="quick-modal ui-modal"
        style={width ? { width } : undefined}
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="quick-modal__head">
          <h3 id={titleId}>{title}</h3>
        </header>

        <div className="ui-modal__body">{children}</div>

        <footer className="ui-modal__footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {footer}
          {showCloseButton && (
            <Button variant="ghost" size="sm" type="button" onClick={onClose} aria-label="Fechar">
              Fechar
            </Button>
          )}
        </footer>
      </article>
    </div>
  );
}
