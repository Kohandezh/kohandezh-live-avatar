import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@shared/utils';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'default';
  loading?: boolean;
}

export function Button({ variant = 'default', loading, className, children, disabled, ...rest }: Props) {
  return (
    <button
      className={cn('btn', variant === 'primary' && 'btn--primary', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
