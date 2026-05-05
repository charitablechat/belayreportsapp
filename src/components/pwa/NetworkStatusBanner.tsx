import { WifiOff } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';

/**
 * Sprint 1 / C3.5: Global offline indicator.
 *
 * Field workers on flaky cell often don't notice when coverage drops. The
 * app saves to IndexedDB locally and the per-record sync badge eventually
 * surfaces "Local" vs "Synced", but the moment-to-moment connectivity state
 * was only visible on the dashboard's manual-sync tooltip. This banner
 * surfaces offline state app-wide so the user always knows the work they're
 * doing won't reach the cloud until reconnect.
 *
 * Renders nothing when online. When offline, renders a thin persistent
 * yellow strip at the very top of the viewport ("Working offline — N items
 * queued"), positioned above StaleVersionBanner (bottom) so the two banners
 * never collide.
 *
 * Uses the same `bg-card / border-border` token vocabulary as
 * StaleVersionBanner to inherit theme automatically (light + dark).
 */
export const NetworkStatusBanner = () => {
  const { isOnline, unsyncedCount } = usePWA();

  if (isOnline) return null;

  const queueText =
    unsyncedCount === 0
      ? 'Changes will sync when you reconnect.'
      : `${unsyncedCount} item${unsyncedCount === 1 ? '' : 's'} queued — will sync when you reconnect.`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="network-status-banner"
      className="fixed top-0 inset-x-0 z-[9997] bg-amber-50 dark:bg-amber-950/60 border-b border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 shadow-sm"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium">
        <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate">
          <span className="font-semibold">Working offline.</span>{' '}
          <span className="font-normal">{queueText}</span>
        </span>
      </div>
    </div>
  );
};
