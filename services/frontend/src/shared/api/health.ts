import { api, apiWsUrl } from './client';
import type { HealthDto } from './dto';

export const healthApi = {
  /** Aggregated dependency health (postgres, redis, livekit, livekit_egress). */
  get: (signal?: AbortSignal) =>
    api.get<HealthDto>('/health', { timeoutMs: 6_000, ...(signal ? { signal } : {}) }),
  /** WebSocket that pushes `system.status` heartbeats every ~5s. */
  statusSocketUrl: () => apiWsUrl('/ws/status'),
};
