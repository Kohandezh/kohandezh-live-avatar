import type { ComponentProps } from 'react';
import { cn } from '../utils';

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white p-5 shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
