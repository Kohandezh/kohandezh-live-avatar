import { useQuery } from '@tanstack/react-query';
import { healthApi, type HealthDto } from '@/shared/api';
import { useOnline } from '@/shared/hooks';

export type HealthLevel = 'checking' | 'ok' | 'degraded' | 'unreachable' | 'offline';

export const healthKeys = { all: ['health'] as const };

export function useBackendHealth() {
  const online = useOnline();
  const query = useQuery({
    queryKey: healthKeys.all,
    queryFn: ({ signal }) => healthApi.get(signal),
    enabled: online,
    refetchInterval: 15_000,
    retry: 1,
    staleTime: 5_000,
  });

  let level: HealthLevel = 'checking';
  if (!online) level = 'offline';
  else if (query.isError) level = 'unreachable';
  else if (query.data) level = query.data.status === 'ok' ? 'ok' : 'degraded';

  return { ...query, level, online, health: query.data as HealthDto | undefined };
}
