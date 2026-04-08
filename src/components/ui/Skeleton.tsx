import { HTMLAttributes } from 'react';

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  lines?: number;
};

export default function Skeleton({ lines = 1, className = '', ...rest }: SkeletonProps) {
  return (
    <div className={['ui-skeleton', className].filter(Boolean).join(' ')} {...rest}>
      {Array.from({ length: lines }).map((_, index) => (
        <span key={`sk-${index}`} className="ui-skeleton__line" />
      ))}
    </div>
  );
}
