

## Fix: Immediate UI Refresh on Local Snapshot Deletion

**Problem**: `LocalSnapshotsPanel` reads snapshots via `const snapshots = listAllSnapshots()` directly during render (line 148). After `handleDelete` calls `deleteReportSnapshot()`, there's no state update, so the list doesn't re-render — the deleted item stays visible until manual navigation.

**Fix** in `src/components/admin/DataRecoveryTool.tsx`:

1. Convert `snapshots` and `storageInfo` from direct render-time reads into `useState` + `useEffect` pattern
2. Add a `refreshKey` counter state that increments after delete
3. Update `handleDelete` to increment `refreshKey` after calling `deleteReportSnapshot()`

```text
Before:
  const snapshots = listAllSnapshots();        // no reactivity
  const storageInfo = getBackupStorageInfo();   // no reactivity

After:
  const [snapshots, setSnapshots] = useState(() => listAllSnapshots());
  const [storageInfo, setStorageInfo] = useState(() => getBackupStorageInfo());

  const refreshSnapshots = useCallback(() => {
    setSnapshots(listAllSnapshots());
    setStorageInfo(getBackupStorageInfo());
  }, []);

  // handleDelete becomes:
  const handleDelete = (reportType, reportId) => {
    deleteReportSnapshot(reportType, reportId);
    refreshSnapshots();          // ← immediate UI update
    toast.success("Snapshot deleted");
  };
```

This is a ~10-line change in a single file. No new dependencies, no API changes.

