import { useState, useEffect } from 'react';
import { getCircuitBreakerStatus } from '@/lib/offline-storage';

/**
 * Polls circuit breaker status every 30 seconds.
 * Returns true when IndexedDB is unreachable (circuit breaker open).
 */
export function useStorageHealthCheck(enabled: boolean = true) {
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const check = () => {
      const status = getCircuitBreakerStatus();
      setStorageUnavailable(status.open);
    };

    check(); // immediate
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [enabled]);

  return storageUnavailable;
}
