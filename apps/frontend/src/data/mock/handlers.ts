import type { User } from '@/entities/user';
import { mockSession } from './session';
import { MOCK_OTP_CODE, mockUsers } from './users';

export interface MockRequest {
  method: string;
  url: URL;
  body: unknown;
  authorization?: string;
  /** `X-Embed-Key` header: how the website widget authenticates without a user. */
  embedKey?: string;
}

export interface MockResponse {
  status?: number;
  body: unknown;
}

export class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MockHttpError';
  }
}

export interface MockRoute {
  method: string;
  path: RegExp;
  handle(request: MockRequest): MockResponse;
}

const TOKEN_PREFIX = 'mock-token-';

/**
 * OTP verification can create a user that is not in the seed data (an unknown
 * phone number). Kept separate from `mockUsers` because that list is a fixed,
 * readonly fixture used by the pagination and search tests.
 */
const createdUsers: User[] = [];

function findUserById(id: string | null | undefined): User | undefined {
  if (!id) return undefined;
  return (
    mockUsers.find((user) => user.id === id) ??
    createdUsers.find((user) => user.id === id)
  );
}

function findUserByPhone(phone: string): User | undefined {
  return (
    mockUsers.find((user) => user.phone === phone) ??
    createdUsers.find((user) => user.phone === phone)
  );
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function toAsciiDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (char) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(char);
    if (persianIndex !== -1) return String(persianIndex);
    const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(char);
    return arabicIndex !== -1 ? String(arabicIndex) : char;
  });
}

/**
 * Mirrors `features/authentication/schemas.ts#normalizePhone`. Duplicated
 * (not imported) because `data/mock` must not depend on `features` — see
 * ARCHITECTURE.md dependency direction.
 */
function normalizePhone(input: string): string {
  const compact = toAsciiDigits(input).trim().replace(/[\s-]/g, '');

  if (compact.startsWith('+')) {
    return `+${compact.slice(1).replace(/\D/g, '')}`;
  }
  if (compact.startsWith('0098')) {
    return `+${compact.slice(2).replace(/\D/g, '')}`;
  }
  if (compact.startsWith('09')) {
    return `+98${compact.slice(1).replace(/\D/g, '')}`;
  }
  return compact.replace(/\D/g, '');
}

function isValidPhone(value: string): boolean {
  return /^\+\d{8,15}$/.test(value);
}

interface PendingOtp {
  expiresAt: number;
}

const OTP_TTL_MS = 120_000;
const OTP_RESEND_AFTER_SECONDS = 60;

/** Pending codes, keyed by normalized phone. Cleared on verify (success or expiry). */
const pendingOtps = new Map<string, PendingOtp>();

function currentUser(request: MockRequest): User | undefined {
  const bearer = request.authorization?.replace(/^Bearer\s+/i, '');
  const fromToken = bearer?.startsWith(TOKEN_PREFIX)
    ? findUserById(bearer.slice(TOKEN_PREFIX.length))
    : undefined;

  return fromToken ?? findUserById(mockSession.get());
}

function requireUser(request: MockRequest): User {
  const user = currentUser(request);
  if (!user) throw new MockHttpError(401, 'unauthorized', 'Not logged in.');
  return user;
}

function requireAdmin(request: MockRequest): User {
  const user = requireUser(request);
  if (user.role !== 'admin')
    throw new MockHttpError(403, 'forbidden', 'Admin role required.');
  return user;
}

/** The public Wayne avatar. Sandbox sessions always use it (PLAN D6). */
const MOCK_SANDBOX_AVATAR_ID = 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a';
const MOCK_ASSISTANT_SESSION_ID = 'mock-assistant-session';
/** Stands in for `ASSISTANT_EMBED_KEY`, the key the website widget sends. */
const MOCK_EMBED_KEY = 'mock-embed-key';
/**
 * Languages the mock lets a session actually start in. Mirrors the backend default
 * (`LIVEAVATAR_ASSISTANT_LANGUAGES=en`): the real provider accepts "fa" when the token is
 * minted but rejects it at session start, so Persian is not offered until a supporting
 * provider exists.
 */
const MOCK_ASSISTANT_LANGUAGES = ['en'] as const;

/**
 * The assistant accepts either a logged-in user or the widget's embed key.
 * The real backend also checks the request origin; the mock cannot see one.
 */
function requireAssistantPrincipal(request: MockRequest): void {
  if (request.embedKey === MOCK_EMBED_KEY) return;
  requireUser(request);
}

function readString(body: unknown, key: string): string {
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as Record<string, unknown>)[key] === 'string'
  ) {
    return (body as Record<string, string>)[key];
  }
  return '';
}

function toInt(
  value: string | null,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export const routes: MockRoute[] = [
  {
    method: 'post',
    path: /^\/api\/auth\/otp\/request$/,
    handle({ body }) {
      const phone = normalizePhone(readString(body, 'phone'));

      if (!isValidPhone(phone)) {
        throw new MockHttpError(
          422,
          'validation_error',
          'Enter a valid phone number.',
        );
      }

      pendingOtps.set(phone, { expiresAt: Date.now() + OTP_TTL_MS });

      return {
        status: 202,
        body: {
          phone,
          expiresInSeconds: OTP_TTL_MS / 1000,
          resendAfterSeconds: OTP_RESEND_AFTER_SECONDS,
          devCode: MOCK_OTP_CODE,
        },
      };
    },
  },
  {
    method: 'post',
    path: /^\/api\/auth\/otp\/verify$/,
    handle({ body }) {
      const phone = normalizePhone(readString(body, 'phone'));
      const code = readString(body, 'code').trim();
      const pending = pendingOtps.get(phone);

      if (!pending || pending.expiresAt < Date.now()) {
        pendingOtps.delete(phone);
        throw new MockHttpError(410, 'otp_expired', 'The code has expired.');
      }

      if (code !== MOCK_OTP_CODE) {
        throw new MockHttpError(401, 'invalid_code', 'The code is wrong.');
      }

      pendingOtps.delete(phone);

      // First successful verification of an unknown phone creates the account.
      let user = findUserByPhone(phone);
      if (!user) {
        user = {
          id: `u-otp-${createdUsers.length + 1}`,
          phone,
          firstName: '',
          lastName: '',
          email: null,
          role: 'user',
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        createdUsers.push(user);
      }

      if (user.status === 'disabled') {
        throw new MockHttpError(
          403,
          'account_disabled',
          'This account is disabled.',
        );
      }

      mockSession.set(user.id);

      return { body: { user, accessToken: `${TOKEN_PREFIX}${user.id}` } };
    },
  },
  {
    method: 'post',
    path: /^\/api\/auth\/logout$/,
    handle() {
      mockSession.clear();
      return { status: 204, body: null };
    },
  },
  {
    method: 'get',
    path: /^\/api\/me$/,
    handle(request) {
      return { body: requireUser(request) };
    },
  },
  {
    method: 'get',
    path: /^\/api\/admin\/users$/,
    handle(request) {
      requireAdmin(request);

      const params = request.url.searchParams;
      const q = (params.get('q') ?? '').trim().toLowerCase();
      const page = toInt(params.get('page'), 1);
      const pageSize = toInt(params.get('pageSize'), 10, 100);

      // `email` is nullable now that phone is the identity; guard against
      // stringifying `null` into a literal "null" match.
      const filtered = q
        ? mockUsers.filter((user) =>
            `${user.firstName} ${user.lastName} ${user.phone} ${user.email ?? ''}`
              .toLowerCase()
              .includes(q),
          )
        : mockUsers;

      const startIndex = (page - 1) * pageSize;

      return {
        body: {
          items: filtered.slice(startIndex, startIndex + pageSize),
          total: filtered.length,
          page,
          pageSize,
        },
      };
    },
  },
  {
    method: 'get',
    path: /^\/api\/admin\/dashboard$/,
    handle(request) {
      requireAdmin(request);

      const activeUsers = mockUsers.filter(
        (user) => user.status === 'active',
      ).length;
      const newest = [...mockUsers]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 7).length;

      return {
        body: {
          totalUsers: mockUsers.length,
          activeUsers,
          disabledUsers: mockUsers.length - activeUsers,
          newUsersThisWeek: newest,
        },
      };
    },
  },
  {
    method: 'post',
    path: /^\/api\/assistant\/session$/,
    handle(request) {
      requireAssistantPrincipal(request);

      // Defaults to "fa": the backend's configured preferred language is Persian, even though
      // the provider cannot start a session in it today.
      const requestedLanguage: 'fa' | 'en' =
        readString(request.body, 'language') === 'en' ? 'en' : 'fa';
      const language = (MOCK_ASSISTANT_LANGUAGES as readonly string[]).includes(
        requestedLanguage,
      )
        ? requestedLanguage
        : MOCK_ASSISTANT_LANGUAGES[0];

      return {
        body: {
          id: MOCK_ASSISTANT_SESSION_ID,
          // A stand-in for the LiveAvatar token. The SDK is mocked in tests and never called.
          sessionToken: 'mock-session-token',
          providerSessionId: 'mock-provider-session',
          sandbox: true,
          avatarId: MOCK_SANDBOX_AVATAR_ID,
          language,
          requestedLanguage,
          maxSessionDurationSeconds: 60,
        },
      };
    },
  },
  {
    method: 'post',
    path: /^\/api\/assistant\/session\/[^/]+\/close$/,
    handle(request) {
      requireAssistantPrincipal(request);
      // The real backend is idempotent, so closing twice is still a 200.
      return { body: { status: 'closed' } };
    },
  },
];
