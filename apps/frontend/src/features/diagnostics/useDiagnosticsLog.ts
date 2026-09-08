import { useMemo } from 'react';
import { useDispatch } from 'react-redux';
import { logEvent } from './eventLogSlice';

export interface DiagnosticsLogger {
  info(source: string, message: string, data?: unknown): void;
  warn(source: string, message: string, data?: unknown): void;
  error(source: string, message: string, data?: unknown): void;
}

/** Stable logger used by every feature hook to append structured events. */
export function useDiagnosticsLog(): DiagnosticsLogger {
  const dispatch = useDispatch();
  return useMemo(
    () => ({
      info: (source, message, data) => dispatch(logEvent({ level: 'info', source, message, data })),
      warn: (source, message, data) => dispatch(logEvent({ level: 'warn', source, message, data })),
      error: (source, message, data) =>
        dispatch(logEvent({ level: 'error', source, message, data })),
    }),
    [dispatch],
  );
}
