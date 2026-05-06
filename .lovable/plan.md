I reviewed the uploaded recording context, current console logs, and the toast implementation. The repeated alarming notifications are coming from two main patterns:

1. Low-level storage/sync infrastructure is creating user-facing toasts for recoverable conditions, especially when IndexedDB’s circuit breaker is open and the app safely falls back to backup storage.
2. Some app flows use direct `sonner` imports, bypassing the filtered wrapper already present in `src/components/ui/sonner.tsx`, so routine warnings/success messages can still appear as intrusive popups.

Plan to stop the noisy toasts while preserving persistence:

1. Silence recoverable storage fallback notifications
   - In `src/lib/offline-storage.ts`, remove the user-facing amber toasts for:
     - “Using backup storage”
     - “Offline storage not guaranteed”
   - Keep console warnings for diagnostics.
   - Keep truly critical destructive storage toasts only when data is not saved at all, such as:
     - local backup failure
     - storage full / quota exceeded
     - storage unavailable with no fallback
   - Preserve the localStorage emergency fallback path exactly as-is so data persistence is not affected.

2. Prevent false “not found” / redirect alarms during storage degradation
   - In `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx`, adjust the “report not found” logic so it only shows a toast and redirects when the server response is conclusive and local storage is healthy enough to confirm the record is actually missing.
   - If the server query timed out or IndexedDB is degraded, stay on the form and log a diagnostic instead of alarming the user.
   - This prevents false “Inspection not found” style alerts during transient storage/network problems.

3. Route direct Sonner calls through the filtered toast wrapper
   - Update report/dashboard-related code that imports `toast` directly from `sonner` to import from `@/components/ui/sonner` where appropriate.
   - This ensures the existing criticality rules are applied consistently.
   - Leave admin/dev-only panels alone unless they are part of the user-facing field workflow.

4. Tighten notification classification rules
   - Update `src/lib/notification-config.ts` so routine operational phrases are silent or notification-center-only, including:
     - saved locally
     - backup storage
     - will sync when storage recovers
     - items haven’t synced yet
     - restored from local backup
     - report refreshed
   - Keep only important user-facing events as toasts:
     - explicit successful user actions, such as manual save/import/export/generate/send
     - critical failures where the user must act
     - authentication/session problems that block sync

5. Make global toast styling calmer and less alarming
   - In `src/components/ui/sonner.tsx`, set a global toaster policy:
     - lower visible toast count, likely `visibleToasts={1}` or `2`
     - shorter default duration for non-critical toasts
     - calmer neutral styling for warning/info notifications
     - no stacked wall of alerts
   - Keep destructive styling for genuine critical failures, but avoid overusing it.

6. Keep report persistence and sync behavior intact
   - Do not change IndexedDB write logic, localStorage fallback, report save flow, sync queues, conflict merge logic, RLS, or database schema.
   - The refactor is only about when/to whom notifications are surfaced.

7. Verification after implementation
   - Reproduce the dashboard/manual sync flow shown in the recording.
   - Confirm repeated storage fallback events log to console but do not produce user-facing toast spam.
   - Confirm manual save still produces one clear success toast.
   - Confirm critical conditions still surface, especially storage full, no local/remote save, and expired session.
   - Confirm report state remains stable after editing and saving inspection/training/daily assessment records.