import type { ReactNode } from 'react';

/** Definition list for identifiers/metrics; values are LTR because they are machine strings. */
export function KeyValue({
  items,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; ltr?: boolean }>;
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className={item.ltr ? 'ltr break-all font-mono text-xs' : 'break-words'}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
