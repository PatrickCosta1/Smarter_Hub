import { HTMLAttributes } from 'react';

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export default function Badge({ tone = 'neutral', className = '', children, ...rest }: BadgeProps) {
  return (
    <span className={['ui-badge', `ui-badge--${tone}`, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </span>
  );
}
