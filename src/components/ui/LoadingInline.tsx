type LoadingInlineVariant = 'title' | 'body' | 'metric' | 'cardTitle' | 'cardBody' | 'button';

type LoadingInlineProps = {
  variant?: LoadingInlineVariant;
};

export default function LoadingInline({ variant = 'body' }: LoadingInlineProps) {
  return <span className={`ui-loading-inline ui-loading-inline--${variant}`} aria-hidden="true" />;
}
