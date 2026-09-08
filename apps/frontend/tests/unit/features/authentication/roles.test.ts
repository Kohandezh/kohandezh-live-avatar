import { describe, expect, it } from 'vitest';
import { hasRole } from '@/features/authentication/roles';

describe('hasRole', () => {
  it('returns false for anonymous users', () => {
    expect(hasRole(null, ['admin'])).toBe(false);
    expect(hasRole(undefined, ['admin'])).toBe(false);
  });

  it('matches when the user role is in the list', () => {
    expect(hasRole({ role: 'admin' }, ['admin'])).toBe(true);
    expect(hasRole({ role: 'user' }, ['admin', 'user'])).toBe(true);
  });

  it('rejects roles that are not in the list', () => {
    expect(hasRole({ role: 'user' }, ['admin'])).toBe(false);
    expect(hasRole({ role: 'admin' }, [])).toBe(false);
  });
});
