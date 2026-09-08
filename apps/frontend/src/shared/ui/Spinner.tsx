import { cn } from '../utils';

const sizes = {
  sm: 'size-4 border-2',
  md: 'size-6 border-2',
  lg: 'size-10 border-[3px]',
};

export function Spinner({
  size = 'md',
  className,
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block animate-spin rounded-full border-slate-300 border-t-slate-900',
        sizes[size],
        className,
      )}
    />
  );
}
