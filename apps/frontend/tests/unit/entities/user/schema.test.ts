import { describe, expect, it } from 'vitest';
import { getFullName, userSchema } from '@/entities/user';
import { paginatedSchema } from '@/shared/api';

const validUser = {
  id: 'u-1',
  firstName: 'Sara',
  lastName: 'Ahmadi',
  email: 'sara@example.com',
  role: 'user',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('userSchema', () => {
  it('accepts a valid user', () => {
    expect(userSchema.parse(validUser)).toEqual(validUser);
  });

  it('rejects an unknown role', () => {
    expect(userSchema.safeParse({ ...validUser, role: 'root' }).success).toBe(
      false,
    );
  });

  it('rejects an invalid email', () => {
    expect(userSchema.safeParse({ ...validUser, email: 'nope' }).success).toBe(
      false,
    );
  });

  it('builds a full name', () => {
    expect(getFullName(validUser)).toBe('Sara Ahmadi');
  });
});

describe('paginatedSchema', () => {
  it('validates a page of items', () => {
    const page = paginatedSchema(userSchema).parse({
      items: [validUser],
      total: 1,
      page: 1,
      pageSize: 10,
    });

    expect(page.items).toHaveLength(1);
  });

  it('rejects a zero page number', () => {
    const result = paginatedSchema(userSchema).safeParse({
      items: [],
      total: 0,
      page: 0,
      pageSize: 10,
    });

    expect(result.success).toBe(false);
  });
});
