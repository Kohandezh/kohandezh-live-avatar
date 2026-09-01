import { useEffect, useRef, useState } from 'react';
import { healthApi, type SystemStatusEventDto } from '@shared/api';
import { useOnline } from '@shared/hooks';
import { useDiagnosticsLog } from './useDiagnosticsLog';

export interface StatusSocketState {
  connected: boolean;
  activeSessions: number | null;
  lastHeartbeat: string | null;
}

const MAX_BACKOFF_MS = 30_000;

/** Subscribes to the orchestrator's `system.status` heartbeat with bounded reconnect backoff. */
export function useStatusSocket(enabled = true): StatusSocketState {
  const online = useOnline();
  const log = useDiagnosticsLog();
  const [state, setState] = useState<StatusSocketState>({
    connected: false,
    activeSessions: null,
    lastHeartbeat: null,
  });
  const wasConnected = useRef(false);

  useEffect(() => {
    if (!enabled || !online) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const open = () => {
      if (disposed) return;
      try {
        socket = new WebSocket(healthApi.statusSocketUrl());
      } catch (error) {
        log.warn('status-socket', 'Status WebSocket unavailable', error);
        return;
      }
      socket.onopen = () => {
        attempt = 0;
        setState((s) => ({ ...s, connected: true }));
        if (!wasConnected.current) log.info('status-socket', 'Connected to /api/ws/status');
        wasConnected.current = true;
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as SystemStatusEventDto;
          if (payload.type === 'system.status') {
            setState({
              connected: true,
              activeSessions: payload.active_sessions,
              lastHeartbeat: payload.timestamp,
            });
          }
        } catch {
          /* ignore malformed heartbeat */
        }
      };
      socket.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (wasConnected.current)
          log.warn('status-socket', 'Status WebSocket closed; reconnecting');
        wasConnected.current = false;
        if (disposed) return;
        attempt += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5));
        timer = setTimeout(open, delay);
      };
      socket.onerror = () => {
        /* onclose follows and schedules the reconnect */
      };
    };

    open();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        // A socket that is still connecting cannot be closed cleanly; close it once it opens.
        if (socket.readyState === WebSocket.CONNECTING) {
          const pending = socket;
          pending.onopen = () => pending.close();
        } else {
          socket.close();
        }
      }
    };
  }, [enabled, online, log]);

  // While disabled/offline the socket is closed, so never report it as connected.
  return enabled && online ? state : { ...state, connected: false };
}
