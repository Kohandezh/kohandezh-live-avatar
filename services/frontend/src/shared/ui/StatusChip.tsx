import { Chip } from '@heroui/react';
import type { ReactNode } from 'react';

export type StatusTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

/** Small status pill. Text carries the meaning; colour is reinforcement only. */
export function StatusChip({
  tone = 'default',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <Chip color={tone} variant="soft" size="sm">
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  );
}
