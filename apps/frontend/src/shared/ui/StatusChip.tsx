import type { ReactNode } from 'react';
import { cn } from '../utils';

export type StatusTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const toneClasses: Record<StatusTone, string> = {
  default: 'bg-slate-100 text-slate-700',
  accent: 'bg-indigo-100 text-indigo-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
};

/** Short status label: connection state, asset status, health level. */
export function StatusChip({
  tone = 'default',
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
