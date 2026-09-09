import { useId, type ComponentProps } from 'react';
import { cn } from '../utils';

export interface InputProps extends ComponentProps<'input'> {
  label: string;
  error?: string;
  hint?: string;
}

/** Labeled text input with error and hint text. Works with react-hook-form `register`. */
export function Input({
  label,
  error,
  hint,
  id,
  className,
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={cn(
          'h-10 rounded-lg border bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2',
          error
            ? 'border-red-500 focus:ring-red-200'
            : 'border-slate-300 focus:border-slate-900 focus:ring-slate-200',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={messageId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
