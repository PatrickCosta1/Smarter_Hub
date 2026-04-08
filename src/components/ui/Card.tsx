import { HTMLAttributes } from 'react';

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'article' | 'div';
};

export default function Card({ as = 'section', className = '', children, ...rest }: CardProps) {
  const Comp = as;
  return (
    <Comp className={['ui-card', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Comp>
  );
}
