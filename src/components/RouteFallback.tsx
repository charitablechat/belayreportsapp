import { Loader2 } from 'lucide-react';

/**
 * Audit C3.8 — Suspense fallback for lazy-loaded route chunks.
 *
 * Why: `<Suspense fallback={null}>` shows a fully blank white screen
 * during chunk download. On a slow LTE connection the InspectionForm
 * chunk (~300 KB gzipped) can take 3-8s — long enough that field users
 * assume the app crashed and kill the tab. A minimal skeleton with a
 * spinner + "Loading…" label preserves the perception that something
 * is happening.
 *
 * Intentionally lightweight: no Card, no shadows, no complex layout —
 * just a centered spinner so the route transition feels deliberate
 * rather than broken. Marked with `role="status"` and `aria-live="polite"`
 * so screen readers announce the loading state.
 */
export function RouteFallback() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center px-4"
      role="status"
      aria-live="polite"
      data-testid="route-fallback"
    >
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2
          className="h-8 w-8 animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm">Loading…</p>
      </div>
    </div>
  );
}
