import { useEffect } from 'react';
import { toast } from 'sonner';
import { triggerCompletionConfetti } from '@/lib/confetti';
import { APP_VERSION } from '@/lib/attestation';

const UPDATE_APPLIED_KEY = 'pwa-update-just-applied';

/**
 * One-shot celebration when the app boots after a PWA service-worker
 * update was just applied. Reads & clears the flag set by usePWAUpdate's
 * updateServiceWorker(...) right before reload — covers both manual
 * "Install Update" clicks and any future auto-update path that goes
 * through the same call site.
 */
export const UpdateAppliedCelebration = () => {
  useEffect(() => {
    let flag: string | null = null;
    try {
      flag = localStorage.getItem(UPDATE_APPLIED_KEY);
      if (flag) localStorage.removeItem(UPDATE_APPLIED_KEY);
    } catch {
      return;
    }
    if (!flag) return;

    // Slight delay so the toast container has mounted and the burst
    // doesn't compete with first-paint work.
    const t = setTimeout(() => {
      triggerCompletionConfetti();
      toast.success('UPDATE INSTALLED', {
        description: APP_VERSION && APP_VERSION !== 'unknown'
          ? `Now running v${APP_VERSION}`
          : 'You are on the latest version',
        duration: 5000,
        style: {
          background: 'hsl(0, 0%, 5%)',
          color: 'hsl(120, 100%, 56%)',
          border: '1px solid hsl(120, 100%, 50%, 0.4)',
          fontFamily: 'monospace',
          fontSize: '12px',
          boxShadow: '0 0 12px hsl(120, 100%, 50%, 0.25)',
        },
      });
    }, 400);

    return () => clearTimeout(t);
  }, []);

  return null;
};
