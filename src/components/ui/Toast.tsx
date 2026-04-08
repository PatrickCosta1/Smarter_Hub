type ToastTone = 'success' | 'error' | 'info';

type ToastProps = {
  show: boolean;
  tone?: ToastTone;
  message: string;
};

export default function Toast({ show, tone = 'info', message }: ToastProps) {
  return (
    <p className={`ui-toast ui-toast--${tone}${show ? ' is-show' : ''}`} aria-live="polite" role="status">
      {message}
    </p>
  );
}
