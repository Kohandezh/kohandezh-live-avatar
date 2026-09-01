import { useEffect, useState } from 'react';
import { subscribeConnectivity } from '@shared/platform/connectivity';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => subscribeConnectivity(setOnline), []);
  return online;
}
