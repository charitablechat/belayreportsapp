

## Fix: Dashboard Shows "0" After Navigation

### Root Cause
The 8-second safety timeout (line 255) sets both `loading=false` and `dataValidated=true` before network requests complete. This causes tab counts to render `inspections.length` (which is `0`) instead of showing `…`.

### Changes

**1. `src/pages/Dashboard.tsx` (lines 255-263)**
- Increase `LOAD_TIMEOUT` from `8000` to `20000`
- Remove `setDataValidated(true)` from the safety timeout handler — only `refreshReports` (line 246) should set that

**2. `src/components/dashboard/DashboardReportsSection.tsx` (lines 294-305)**
- Update all 3 tab count expressions to show `…` when data is empty and not yet validated:
```
// Before:
loading ? '…' : (totalInspections ?? inspections.length)

// After:
loading || (!totalInspections && inspections.length === 0)
  ? '…'
  : (totalInspections ?? inspections.length)
```
Same pattern for training and daily tabs. This prevents showing `0` in the gap between the safety timeout firing and network data arriving.

### Files
| File | Lines | Change |
|------|-------|--------|
| `src/pages/Dashboard.tsx` | 255-263 | Increase timeout to 20s, remove `setDataValidated(true)` |
| `src/components/dashboard/DashboardReportsSection.tsx` | 294-305 | Guard tab counts against premature `0` |

