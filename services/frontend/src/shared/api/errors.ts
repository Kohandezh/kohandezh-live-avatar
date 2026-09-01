// Normalized error shape. Every failure from the API client becomes an ApiError so UI code
// never branches on raw fetch/network internals.
//
// The orchestrator returns `{ error: { code, message, retryable, details }, correlation_id }`.
// `serverCode` carries the orchestrator code (e.g. `configuration_error`, `provider_quota`);
// `code` is the transport-level category used for generic UI decisions.
export type ApiErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'SERVER'
  | 'UNKNOWN';

export interface ApiErrorBody {
  error: { code: string; message: string; retryable?: boolean; details?: unknown };
  correlation_id?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly serverCode: string | undefined;
  readonly details: unknown;
  readonly correlationId: string | undefined;
  private readonly serverRetryable: boolean | undefined;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: {
      serverCode?: string | undefined;
      details?: unknown;
      correlationId?: string | undefined;
      retryable?: boolean | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.serverCode = options.serverCode;
    this.details = options.details;
    this.correlationId = options.correlationId;
    this.serverRetryable = options.retryable;
  }

  /** The server's own verdict wins; otherwise only transport failures and 5xx are retryable. */
  get isRetryable(): boolean {
    if (this.serverRetryable !== undefined) return this.serverRetryable;
    return this.code === 'NETWORK' || this.code === 'TIMEOUT' || this.status >= 500;
  }
}

export function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422 || status === 400) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'UNAVAILABLE';
  if (status >= 500) return 'SERVER';
  return 'UNKNOWN';
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Message safe to show and log. Never includes headers, tokens or request bodies. */
export function describeError(value: unknown): string {
  if (value instanceof ApiError) {
    return value.serverCode ? `${value.serverCode}: ${value.message}` : value.message;
  }
  if (value instanceof Error) return value.message;
  return String(value);
}
