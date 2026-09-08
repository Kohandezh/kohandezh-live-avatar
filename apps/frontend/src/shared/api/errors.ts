import axios, { type AxiosError } from 'axios';

/**
 * One normalized error type for every failure, so UI code never branches on axios internals.
 *
 * Two body shapes are accepted:
 *   flat      `{ code, message, details }`        - the starter contract (docs/API.md)
 *   enveloped `{ error: {...}, correlation_id }`  - the orchestrator (apps/api)
 *
 * `code` is the backend's own code when it sent one (for example `unauthorized`,
 * `configuration_error`, `liveavatar_quota`); `serverCode` is the same value, kept as a
 * separate name because the avatar features read it explicitly. `category` is the
 * transport-level class used for generic UI decisions.
 */
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

/** Error body shape the frontend expects from the backend. */
export interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
  correlation_id?: string;
}

export class ApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly details?: unknown;
  /** The backend's own error code, when it sent one. Same value as `code` when present. */
  readonly serverCode?: string;
  /** Transport-level class of the failure, for generic UI decisions. */
  readonly category: ApiErrorCode;
  /** Request id echoed by the orchestrator, for matching a UI failure to server logs. */
  readonly correlationId?: string;
  /** True when the request never reached the server (offline, DNS, CORS). */
  readonly isNetworkError: boolean;
  private readonly serverRetryable?: boolean;

  constructor(init: {
    message: string;
    status?: number;
    code?: string;
    details?: unknown;
    serverCode?: string;
    category?: ApiErrorCode;
    correlationId?: string;
    isNetworkError?: boolean;
    retryable?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.serverCode = init.serverCode;
    this.category = init.category ?? 'UNKNOWN';
    this.correlationId = init.correlationId;
    this.isNetworkError = init.isNetworkError ?? false;
    this.serverRetryable = init.retryable;
  }

  /** The server's own verdict wins; otherwise only transport failures and 5xx are retryable. */
  get isRetryable(): boolean {
    if (this.serverRetryable !== undefined) return this.serverRetryable;
    if (this.isNetworkError) return true;
    return (this.status ?? 0) >= 500;
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

/** Normalizes any thrown value into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorBody>;
    const body = axiosError.response?.data;
    // The orchestrator wraps its payload; the starter contract does not.
    const envelope = body?.error;
    const status = axiosError.response?.status;
    const isTimeout = axiosError.code === 'ECONNABORTED';
    const isNetworkError =
      !axiosError.response && axiosError.code !== axios.AxiosError.ERR_CANCELED;

    return new ApiError({
      message: envelope?.message ?? body?.message ?? axiosError.message,
      status: status as number | undefined,
      // `code` keeps the starter contract: the backend's code when it sent one.
      code: envelope?.code ?? body?.code ?? axiosError.code,
      details: envelope?.details ?? body?.details,
      serverCode: envelope?.code ?? body?.code,
      category: status
        ? codeFromStatus(status)
        : isTimeout
          ? 'TIMEOUT'
          : isNetworkError
            ? 'NETWORK'
            : 'UNKNOWN',
      correlationId: body?.correlation_id,
      isNetworkError,
      retryable: envelope?.retryable,
    });
  }

  if (error instanceof Error) {
    return new ApiError({ message: error.message });
  }

  return new ApiError({ message: 'Unknown error' });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

export function isForbidden(error: unknown): boolean {
  return isApiError(error) && error.status === 403;
}

export function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

export function isNetworkError(error: unknown): boolean {
  return isApiError(error) && error.isNetworkError;
}

/** Message safe to show and log. Never includes headers, tokens or request bodies. */
export function describeError(value: unknown): string {
  if (value instanceof ApiError) {
    return value.serverCode
      ? `${value.serverCode}: ${value.message}`
      : value.message;
  }
  if (value instanceof Error) return value.message;
  return String(value);
}
