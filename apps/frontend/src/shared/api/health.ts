import { apiClient } from './client';
import type { HealthDto } from './dto';
import { apiWsUrl } from './urls';

export const healthApi = {
  /** Aggregated dependency health (postgres, redis, livekit, livekit_egress). */
  get: (signal?: AbortSignal) =>
    apiClient
      .get<HealthDto>('/api/health', {
        timeout: 6_000,
        ...(signal ? { signal } : {}),
      })
      .then((response) => response.data),

  /** WebSocket that pushes `system.status` heartbeats every ~5s. */
  statusSocketUrl: () => apiWsUrl('/api/ws/status'),
};
