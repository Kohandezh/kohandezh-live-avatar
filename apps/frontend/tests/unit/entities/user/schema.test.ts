import { describe, expect, it } from 'vitest';
import { getFullName, userSchema } from '@/entities/user';
import { paginatedSchema } from '@/shared/api';

const validUser = {
  id: 'u-1',
  phone: '+989121234567',
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

  it('accepts a null email', () => {
    expect(userSchema.safeParse({ ...validUser, email: null }).success).toBe(
      true,
    );
  });

  it('rejects an empty phone', () => {
    expect(userSchema.safeParse({ ...validUser, phone: '' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown role', () => {
    expect(userSchema.safeParse({ ...validUser, role: 'root' }).success).toBe(
      false,
    );
  });

  it('rejects an invalid email type', () => {
    expect(userSchema.safeParse({ ...validUser, email: 42 }).success).toBe(
      false,
    );
  });

  it('builds a full name', () => {
    expect(getFullName(validUser)).toBe('Sara Ahmadi');
  });

  it('falls back to the phone when there is no name yet', () => {
    expect(
      getFullName({ ...validUser, firstName: '', lastName: '' }),
    ).toBe('+989121234567');
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
