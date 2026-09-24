import { z } from 'zod';
import type { AssistantAgentType } from '@/entities/assistant-session';
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
 * phone number). Also holds a copy-on-write clone of a `mockUsers` entry once
 * that user updates their profile. Kept separate from `mockUsers` because that
 * list is a fixed, readonly fixture used by the pagination and search tests.
 * Checked first so a clone shadows the fixture it was copied from.
 */
const createdUsers: User[] = [];

function findUserById(id: string | null | undefined): User | undefined {
  if (!id) return undefined;
  return (
    createdUsers.find((user) => user.id === id) ??
    mockUsers.find((user) => user.id === id)
  );
}

function findUserByPhone(phone: string): User | undefined {
  return (
    createdUsers.find((user) => user.phone === phone) ??
    mockUsers.find((user) => user.phone === phone)
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
 * The provider mode the mock backend is configured with. Mirrors `LIVEAVATAR_VOICE_AGENT_ID`
 * being set: the voice agent wraps the customer's ElevenLabs agent and is the only path that
 * speaks Persian, so it is the default. Tests import this to cover the `full` path too.
 */
export const MOCK_ASSISTANT_AGENT_TYPE: AssistantAgentType = 'elevenlabs';

/**
 * What the mock backend is configured with right now. A test that needs the other provider mode
 * sets `agentType` and puts it back to `MOCK_ASSISTANT_AGENT_TYPE` afterwards.
 */
export const mockAssistant: { agentType: AssistantAgentType } = {
  agentType: MOCK_ASSISTANT_AGENT_TYPE,
};

/** The mock session is 60 s long, so neither one answer nor all of them together can be longer. */
const MOCK_SESSION_LIMIT_MS = 60_000;
/** Mirrors the backend default of `ASSISTANT_ANSWERS_PER_SESSION_MAX`. */
const MOCK_ANSWERS_PER_SESSION_MAX = 200;
const ASSISTANT_ANSWERS_PATH = /^\/api\/assistant\/session\/([^/]+)\/answers$/;

/** Mirrors the backend's closed request model: two integers per answer, nothing text-shaped. */
const answersReportSchema = z.strictObject({
  answers: z
    .array(
      z.strictObject({
        index: z.number().int().min(0).max(10_000),
        durationMs: z.number().int().min(1).max(3_600_000),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * What the mock backend remembers about the one session it hands out: whether it was closed, and
 * the duration of each answer index reported for it. Creating a session starts both over.
 */
const mockAssistantSession = {
  closed: false,
  answerDurations: new Map<number, number>(),
};

function totalDuration(durations: Map<number, number>): number {
  return [...durations.values()].reduce((sum, duration) => sum + duration, 0);
}

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

/**
 * The optional birthday out of a request body.
 *
 * Mirrors `UpdateProfileBody.check_birth_date` in the backend: the field may be missing or null,
 * and anything else must be a real Gregorian day between 1900-01-01 and today. Duplicated rather
 * than imported because `data/mock` must not depend on `features` (ARCHITECTURE.md dependency
 * direction), the same reason `normalizePhone` is duplicated above.
 */
function readBirthDate(body: unknown): string | null {
  const raw =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)['birthDate']
      : undefined;
  if (raw === undefined || raw === null) return null;

  const invalid = new MockHttpError(
    422,
    'validation_error',
    'Birth date must be a real day between 1900 and today.',
  );
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw invalid;

  const parsed = new Date(`${raw}T00:00:00Z`);
  // `new Date` rolls an impossible day over ("2024-02-31" becomes 2 March), so compare the
  // round trip rather than only checking for NaN.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw invalid;
  }
  if (raw < '1900-01-01' || parsed.getTime() > Date.now()) throw invalid;
  return raw;
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
          // A fresh account has no birthday, the same as a fresh `firstName`.
          birthDate: null,
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
    method: 'put',
    path: /^\/api\/me\/profile$/,
    handle(request) {
      const current = requireUser(request);
      const firstName = readString(request.body, 'firstName').trim();
      const lastName = readString(request.body, 'lastName').trim();
      const birthDate = readBirthDate(request.body);

      if (!firstName || !lastName) {
        throw new MockHttpError(
          422,
          'validation_error',
          'First name and last name are required.',
        );
      }

      // `current` may be a `mockUsers` entry, a fixed fixture the pagination and
      // search tests rely on. Copy it into `createdUsers` and mutate the copy,
      // never the fixture itself.
      let user = createdUsers.find((candidate) => candidate.id === current.id);
      if (!user) {
        user = { ...current };
        createdUsers.push(user);
      }
      user.firstName = firstName;
      user.lastName = lastName;
      // Full replace, like the real endpoint: a missing or null birthDate clears it.
      user.birthDate = birthDate;

      return { body: user };
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

      // Defaults to "fa": the backend's configured preferred language is Persian.
      const requestedLanguage: 'fa' | 'en' =
        readString(request.body, 'language') === 'en' ? 'en' : 'fa';
      // The voice agent always answers in its own language and ignores the request. FULL mode
      // can only start in a language the provider supports, so it may fall back.
      const { agentType } = mockAssistant;
      const language =
        agentType === 'elevenlabs'
          ? 'fa'
          : (MOCK_ASSISTANT_LANGUAGES as readonly string[]).includes(
                requestedLanguage,
              )
            ? requestedLanguage
            : MOCK_ASSISTANT_LANGUAGES[0];

      mockAssistantSession.closed = false;
      mockAssistantSession.answerDurations.clear();

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
          agentType,
        },
      };
    },
  },
  {
    method: 'post',
    path: /^\/api\/assistant\/session\/[^/]+\/close$/,
    handle(request) {
      requireAssistantPrincipal(request);
      if (
        request.url.pathname ===
        `/api/assistant/session/${MOCK_ASSISTANT_SESSION_ID}/close`
      ) {
        mockAssistantSession.closed = true;
      }
      // The real backend is idempotent, so closing twice is still a 200.
      return { body: { status: 'closed' } };
    },
  },
  {
    method: 'post',
    path: ASSISTANT_ANSWERS_PATH,
    handle(request) {
      // Same order and codes as the backend, with four differences a caller must not rely on:
      // no 429 (no hourly limit, as for session creation, and no assistant_answers_busy, because
      // the mock never waits for a lock); no 409 for a session past its length
      // (only close makes it 409); a non-UUID id is 404 here, because the mock's own id is not a
      // UUID, where the API answers 422; and the per-answer 422 has no details.limitMs.
      requireAssistantPrincipal(request);
      const report = answersReportSchema.safeParse(request.body);
      if (!report.success) {
        throw new MockHttpError(
          422,
          'validation_error',
          'Send 1 to 20 answers, each with an index and a duration.',
        );
      }
      const id = ASSISTANT_ANSWERS_PATH.exec(request.url.pathname)?.[1];
      if (id !== MOCK_ASSISTANT_SESSION_ID) {
        throw new MockHttpError(
          404,
          'not_found',
          'The assistant session was not found.',
        );
      }
      if (mockAssistantSession.closed) {
        throw new MockHttpError(
          409,
          'assistant_session_closed',
          'The assistant session is not open.',
        );
      }
      const { answers } = report.data;
      if (
        answers.some(({ durationMs }) => durationMs > MOCK_SESSION_LIMIT_MS)
      ) {
        throw new MockHttpError(
          422,
          'validation_error',
          'An answer cannot be longer than the session.',
        );
      }

      const stored = mockAssistantSession.answerDurations;
      // A repeated index is a re-sent report. The first one wins, the rest are dropped.
      const fresh = new Map<number, number>();
      for (const { index, durationMs } of answers) {
        if (!stored.has(index) && !fresh.has(index)) {
          fresh.set(index, durationMs);
        }
      }
      const isOverBudget =
        stored.size + fresh.size > MOCK_ANSWERS_PER_SESSION_MAX ||
        totalDuration(stored) + totalDuration(fresh) > MOCK_SESSION_LIMIT_MS;
      if (fresh.size > 0 && isOverBudget) {
        throw new MockHttpError(
          409,
          'assistant_answers_limit',
          'The session has no room for more answers.',
        );
      }
      for (const [index, durationMs] of fresh) stored.set(index, durationMs);

      return {
        body: { recorded: fresh.size, duplicates: answers.length - fresh.size },
      };
    },
  },
];
