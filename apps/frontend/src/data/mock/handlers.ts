import type { User } from '@/entities/user';
import { mockSession } from './session';
import { MOCK_PASSWORD, mockUsers } from './users';

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

function findUserById(id: string | null | undefined): User | undefined {
  return id ? mockUsers.find((user) => user.id === id) : undefined;
}

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
    path: /^\/api\/auth\/login$/,
    handle({ body }) {
      const email = readString(body, 'email').trim().toLowerCase();
      const password = readString(body, 'password');
      const user = mockUsers.find((candidate) => candidate.email === email);

      if (!user || password !== MOCK_PASSWORD) {
        throw new MockHttpError(
          401,
          'invalid_credentials',
          'Email or password is wrong.',
        );
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

      const filtered = q
        ? mockUsers.filter((user) =>
            `${user.firstName} ${user.lastName} ${user.email}`
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

      const language =
        readString(request.body, 'language') === 'en' ? 'en' : 'fa';

      return {
        body: {
          id: MOCK_ASSISTANT_SESSION_ID,
          // A stand-in for the LiveAvatar token. The SDK is mocked in tests and never called.
          sessionToken: 'mock-session-token',
          providerSessionId: 'mock-provider-session',
          sandbox: true,
          avatarId: MOCK_SANDBOX_AVATAR_ID,
          language,
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
