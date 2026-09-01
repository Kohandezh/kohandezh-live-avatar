import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';

/**
 * MOCK BACKEND — exists so the frontend runs end-to-end locally against the API contract in
 * docs/api/openapi.yaml. It demonstrates the rules the real backend must follow:
 *  - one identity, two transports: HttpOnly cookie (web) OR Bearer token (native)
 *  - public / authenticated / privileged tiers
 *  - explicit PUBLIC_FIELDS allowlist
 *  - uniform error envelope { error: { code, message, details? } }
 *  - pagination envelope { items, page, pageSize, total }
 * It has no persistence, no password hashing, no real security. Never deploy it.
 */

const PORT = Number(process.env.PORT ?? 8787);
const WEB_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');

interface User {
  id: string;
  email: string;
  password: string; // plaintext ONLY because this is a mock
  displayName: string;
  role: 'user' | 'admin';
  createdAt: string;
}

const users: User[] = [
  { id: 'u_1', email: 'demo@example.com', password: 'demo1234', displayName: 'Demo User', role: 'user', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'u_2', email: 'admin@example.com', password: 'admin1234', displayName: 'Admin', role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'u_3', email: 'sara@example.com', password: 'sara1234', displayName: 'سارا', role: 'user', createdAt: '2026-02-01T00:00:00Z' },
];

const PUBLIC_FIELDS = ['id', 'displayName'] as const;
const PRIVATE_FIELDS = ['id', 'email', 'displayName', 'role', 'createdAt'] as const;
const pick = <T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;

const sessions = new Map<string, string>(); // token -> userId (cookie sessions and bearer tokens share one table)
const COOKIE = 'sid';

type Env = { Variables: { user: User } };
const app = new Hono<Env>();

app.use(
  '*',
  cors({
    origin: (o) => (WEB_ORIGINS.includes(o) ? o : ''), // explicit allowlist, never '*' with credentials
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-Auth-Mode'],
  }),
);

const fail = (c: import('hono').Context, status: 400 | 401 | 403 | 404 | 422 | 429 | 500, code: string, message: string, details?: unknown) =>
  c.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, status);

function resolveUser(c: import('hono').Context): User | null {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : getCookie(c, COOKIE);
  const uid = token && sessions.get(token);
  return uid ? (users.find((u) => u.id === uid) ?? null) : null;
}

const requireAuth = async (c: import('hono').Context<Env>, next: () => Promise<void>) => {
  const user = resolveUser(c);
  if (!user) return fail(c, 401, 'UNAUTHENTICATED', 'Authentication required');
  c.set('user', user);
  await next();
};
const requireAdmin = async (c: import('hono').Context<Env>, next: () => Promise<void>) => {
  if (c.get('user').role !== 'admin') return fail(c, 403, 'FORBIDDEN', 'Admin only');
  await next();
};

// ---- health
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// ---- auth
app.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) return fail(c, 422, 'VALIDATION', 'email and password are required');
  const user = users.find((u) => u.email === body.email && u.password === body.password);
  if (!user) return fail(c, 401, 'INVALID_CREDENTIALS', 'Wrong email or password');

  const token = randomUUID();
  sessions.set(token, user.id);
  const mode = c.req.header('X-Auth-Mode') === 'bearer' ? 'bearer' : 'cookie';
  if (mode === 'cookie') {
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: false, path: '/', maxAge: 60 * 60 * 24 });
    return c.json({ user: pick(user, PRIVATE_FIELDS) });
  }
  return c.json({ user: pick(user, PRIVATE_FIELDS), accessToken: token });
});

app.post('/auth/logout', (c) => {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : getCookie(c, COOKIE);
  if (token) sessions.delete(token);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.body(null, 204);
});

app.get('/auth/me', requireAuth, (c) => c.json(pick(c.get('user'), PRIVATE_FIELDS)));

// ---- public tier (explicit allowlist)
app.get('/public/users', (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 20)));
  const q = (c.req.query('q') ?? '').toLowerCase();
  const filtered = users.filter((u) => !q || u.displayName.toLowerCase().includes(q));
  const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((u) => pick(u, PUBLIC_FIELDS));
  return c.json({ items, page, pageSize, total: filtered.length });
});

// ---- authenticated tier
app.get('/users/:id', requireAuth, (c) => {
  const u = users.find((x) => x.id === c.req.param('id'));
  if (!u) return fail(c, 404, 'NOT_FOUND', 'User not found');
  return c.json(pick(u, PRIVATE_FIELDS));
});

app.patch('/users/me', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as { displayName?: unknown } | null;
  if (typeof body?.displayName !== 'string' || body.displayName.trim().length < 2)
    return fail(c, 422, 'VALIDATION', 'displayName must be at least 2 characters', { field: 'displayName' });
  const user = c.get('user');
  user.displayName = body.displayName.trim();
  return c.json(pick(user, PRIVATE_FIELDS));
});

// ---- privileged tier
app.get('/admin/users', requireAuth, requireAdmin, (c) =>
  c.json({ items: users.map((u) => pick(u, PRIVATE_FIELDS)), page: 1, pageSize: users.length, total: users.length }),
);

app.notFound((c) => fail(c, 404, 'NOT_FOUND', 'Route not found'));
app.onError((err, c) => {
  console.error(err);
  return fail(c, 500, 'INTERNAL', 'Internal error'); // never leak stack traces to clients
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`mock-backend listening on http://localhost:${PORT}`);
  console.log(`  demo login: demo@example.com / demo1234   admin: admin@example.com / admin1234`);
});
