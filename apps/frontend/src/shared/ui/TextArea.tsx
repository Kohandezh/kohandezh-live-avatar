import type { ComponentProps } from 'react';
import { cn } from '../utils';

/** Multi-line text input styled like the starter's Input. */
export function TextArea({ className, ...rest }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...rest}
    />
  );
}
