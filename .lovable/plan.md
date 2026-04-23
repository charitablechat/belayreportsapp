

## Add regression test suite for Priorities 1–5 sync hardening

### What

Create `src/lib/__tests__/sync-hardening.test.ts` covering the five fixes from this session: empty-save guards, per-read success tracking, fresh sync counts with timeout abort, blocked-reconcile reporting, and tiered IDB timeouts.

### Files

**New:** `src/lib/__tests__/sync-hardening.test.ts`

Use the user-supplied test body as the basis, with these adjustments to match the actual codebase signatures:

1. **Path correction:** tests live in `src/lib/__tests__/` and import from `../offline-storage` and `../sync-reconciliation` (matches existing `field-merge.test.ts`, `local-data-guards.test.ts` placement).

2. **`getRelatedDataOfflineWithStatus` signature:** the real helper takes `(type, inspectionId)` not just `(inspectionId)`. Update calls to:
   ```ts
   getRelatedDataOfflineWithStatus('systems', 'insp-1')
   ```

3. **`saveRelatedDataOffline` signature:** real shape is `(type, inspectionId, items, opts?)`. Update Priority 1 mocks accordingly:
   ```ts
   await mockSaveRelatedData('systems', 'insp-1', [], { allowEmpty: true });
   ```
   *Note:* if `allowEmpty` is not yet a real option on `saveRelatedDataOffline`, this test stays mock-only (validates the contract, not the implementation). Flag in a comment.

4. **Mock module paths:** `vi.mock('../offline-storage', ...)` and `vi.mock('../sync-reconciliation', ...)` — preserve `importOriginal` so non-mocked exports (like `withIDBTimeout`) still work.

5. **Priority 2 timeout test:** the real `batch` tier is 10s; using `delay(20_000)` would make the test itself take 10s. Either:
   - Mock `withIDBTimeout` directly to force `timedOut: true` for that one test, OR
   - Override `IDB_TIMEOUTS` via a test-only env hook (not currently supported).
   
   Plan: mock `withIDBTimeout` for the timeout-specific cases. Real `withIDBTimeout` is used for the success cases.

6. **Priority 3 test:** keep as illustrative — exercises the `withIDBTimeout` contract via a fake timer rather than running `useAutoSync` directly (the hook needs React context).

7. **Priority 4 tests:** pure mock-level — validate the `ReconcileResult` shape (`blocked`, `blockReason`) that callers depend on. No real DB needed.

8. **Priority 5 test:** keep as a behavioral smoke test — a 100ms simulated read resolves under the 10s `batch` tier.

9. **Vitest config:** existing `vitest.config.ts` already picks up `src/**/*.test.ts`, so no config changes.

### Out of scope

- Not adding a real-IDB integration test (would need fake-indexeddb; separate PR).
- Not refactoring `saveRelatedDataOffline` to accept `allowEmpty` if it doesn't already — this PR only adds tests. If the option is missing, the test documents the intended contract and is marked `it.todo` until implemented.
- Not testing `useAutoSync` end-to-end; the count-timeout test exercises the underlying primitive instead.

### Risk

Low. Pure additive test file. Worst case: a test fails and reveals a real gap — which is the point.

