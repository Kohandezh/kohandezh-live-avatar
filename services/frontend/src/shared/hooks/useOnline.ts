import { useEffect, useState } from 'react';
import { isOnlineNow, subscribeConnectivity } from '@shared/platform/connectivity';

export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnlineNow);
  useEffect(() => subscribeConnectivity(setOnline), []);
  return online;
}
