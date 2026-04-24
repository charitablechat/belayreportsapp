---
name: deferred-reconcile
description: Atomic sync runs UPSERT first then reconcile (DELETE) after commit, so a failed transaction never leaves orphaned server deletes
type: feature
---

H3 fix. src/lib/deferred-reconcile.ts wraps reconcileAllChildTables. All three syncInspectionAtomic / syncTrainingAtomic / syncDailyAssessmentAtomic in src/lib/atomic-sync-manager.ts now: (1) capture a `*ReconcileSpec` instead of running reconcile pre-transaction, (2) execute upsert transaction, (3) on success call `runDeferredReconcile`, (4) if reconcile is blocked or throws, return `{ success: true, partial: true, reason: 'reconcile_pending' }` so the caller's unsynced count keeps the record dirty for the next cycle. Removed C4 `restoreReconciledDeletions` call sites — no longer needed since upsert failure leaves server untouched. The 70%-tripwire and per-table guards inside reconcileChildTable still fire.
