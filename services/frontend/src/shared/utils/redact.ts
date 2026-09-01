const SENSITIVE_KEY = /token|secret|key|authorization|password|credential|cookie/i;
const JWT_LIKE = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

/**
 * Deep-copies a value for the diagnostics log, replacing anything that looks like a credential.
 * Keys are matched by name; string values are matched against a JWT shape. Depth is bounded so a
 * cyclic or huge object cannot freeze the UI.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return JWT_LIKE.test(value) ? '[redacted]' : value;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return out;
}
