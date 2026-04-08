import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export default function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const classes = ['ui-button', `ui-button--${variant}`, `ui-button--${size}`, isLoading ? 'is-loading' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classes}
      disabled={disabled || isLoading}
      aria-busy={isLoading ? 'true' : 'false'}
      {...rest}
    >
      {isLoading ? (
        <span className="ui-button__loader" aria-hidden="true" />
      ) : (
        leftIcon ? <span className="ui-button__icon">{leftIcon}</span> : null
      )}
      <span className="ui-button__content">{children}</span>
      {!isLoading && rightIcon ? <span className="ui-button__icon">{rightIcon}</span> : null}
    </button>
  );
}
