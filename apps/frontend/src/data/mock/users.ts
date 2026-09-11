import type { User } from '@/entities/user';

/** One-time code accepted for every mock account (see docs/DEVELOPMENT.md). */
export const MOCK_OTP_CODE = '123456';

const firstNames = [
  'Sara',
  'Ali',
  'Maryam',
  'Reza',
  'Nina',
  'Omid',
  'Leila',
  'Kian',
  'Hana',
  'Arash',
  'Yasmin',
  'Dara',
];

const lastNames = [
  'Ahmadi',
  'Karimi',
  'Rahimi',
  'Moradi',
  'Hosseini',
  'Jafari',
  'Sadeghi',
  'Ebrahimi',
  'Rostami',
  'Shirazi',
  'Tehrani',
  'Kazemi',
];

function isoDaysFrom(start: Date, days: number): string {
  return new Date(start.getTime() + days * 86_400_000).toISOString();
}

/** Deterministic Iranian mobile number, distinct from the two fixed demo accounts. */
function phoneFor(index: number): string {
  return `+98990${String(index).padStart(7, '0')}`;
}

const start = new Date(Date.UTC(2026, 0, 1));

/** Deterministic list. Same data on every run, which keeps tests stable. */
function generateUsers(count: number): User[] {
  const users: User[] = [
    {
      id: 'u-admin',
      phone: '+989121234567',
      firstName: 'Admin',
      lastName: 'Example',
      email: 'admin@example.com',
      role: 'admin',
      status: 'active',
      createdAt: isoDaysFrom(start, 0),
    },
    {
      id: 'u-user',
      phone: '+989351234567',
      firstName: 'User',
      lastName: 'Example',
      email: 'user@example.com',
      role: 'user',
      status: 'active',
      createdAt: isoDaysFrom(start, 1),
    },
  ];

  for (let i = 0; users.length < count; i += 1) {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[(i * 7) % lastNames.length];

    users.push({
      id: `u-${String(i + 1).padStart(3, '0')}`,
      phone: phoneFor(i),
      firstName,
      lastName,
      email: `${firstName}.${lastName}${i + 1}@example.com`.toLowerCase(),
      role: i % 15 === 0 ? 'admin' : 'user',
      // i === 0 gives one disabled account (u-001) so the "account disabled" flow is testable.
      status: i % 9 === 0 ? 'disabled' : 'active',
      createdAt: isoDaysFrom(start, 2 + i * 3),
    });
  }

  return users;
}

export const mockUsers: readonly User[] = generateUsers(57);
