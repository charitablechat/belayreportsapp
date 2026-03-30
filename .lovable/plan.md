

## Fix: Smarter Storage Warning — Only Show Red Toast When Backup Also Fails

### Root Cause
The red "Storage temporarily unavailable" toast fires whenever the circuit breaker is open AND a write operation is attempted — **regardless of whether the emergency localStorage fallback succeeded**. This means the user sees a scary warning even when their data IS being saved (just to localStorage instead of IndexedDB).

Additionally, the toast fires from `withIndexedDBErrorBoundary` on **every** write operation type, including background operations like `pruneOldSyncedPhotoBl