import { InputHTMLAttributes, ReactNode } from 'react';

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  success?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
};

export default function TextInput({
  id,
  label,
  error,
  success,
  icon,
  trailing,
  className = '',
  value,
  ...rest
}: TextInputProps) {
  const hasValue = typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
  const stateClass = error ? 'has-error' : success ? 'has-success' : '';

  return (
    <label className={`ui-field ${stateClass} ${className}`.trim()} htmlFor={id}>
      <span className={`ui-field__label${hasValue ? ' is-floating' : ''}`}>{label}</span>
      <div className="ui-field__control">
        {icon ? <span className="ui-field__icon" aria-hidden="true">{icon}</span> : null}
        <input id={id} value={value} {...rest} aria-invalid={error ? 'true' : 'false'} />
        {trailing ? <span className="ui-field__trailing">{trailing}</span> : null}
      </div>
      {error ? <small className="ui-field__message ui-field__message--error">{error}</small> : null}
      {!error && success ? <small className="ui-field__message ui-field__message--success">{success}</small> : null}
    </label>
  );
}
