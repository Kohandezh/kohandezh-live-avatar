import type { ReactNode } from 'react';
import {
  Button as HeroButton,
  Spinner,
  type ButtonProps as HeroButtonProps,
} from '@heroui/react';

export interface ButtonProps extends Omit<HeroButtonProps, 'children'> {
  children?: ReactNode;
}

/** Project Button: a thin wrapper over HeroUI Button that shows a spinner while pending. */
export function Button({ children, isPending, isDisabled, ...rest }: ButtonProps) {
  return (
    <HeroButton isPending={isPending} isDisabled={isDisabled || isPending} {...rest}>
      {isPending ? <Spinner color="current" size="sm" aria-hidden /> : null}
      {children}
    </HeroButton>
  );
}
