import type { ComponentProps } from 'react';
import {
  buttonClassName,
  type ButtonSize,
  type ButtonVariant,
} from './buttonStyles';
import { Spinner } from './Spinner';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={buttonClassName({ variant, size, className })}
      {...rest}
    >
      {loading ? <Spinner size="sm" className="border-t-current" /> : null}
      {children}
    </button>
  );
}
