import type { ReactNode } from 'react';
import { cn } from '../utils';

/** Definition list for identifiers/metrics; values are LTR because they are machine strings. */
export function KeyValue({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode; ltr?: boolean }>;
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs', className)}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-slate-500">{item.label}</dt>
          <dd
            className={cn(
              'min-w-0 truncate font-mono text-slate-800',
              item.ltr !== false && 'ltr',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
