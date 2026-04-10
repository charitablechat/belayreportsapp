

# Implement Automatic Report Naming Convention

## Current State
Report filenames are scattered across 3 form files with inconsistent patterns like:
- `training-report-{org}-2024-03-15.html`
- `inspection-{org}-1710500000.pdf`
- `daily-assessment-{site}-2024-03-15.html`

## Target Convention
**`{Organization} {MM-YYYY}`** — e.g., `"Acme Corp 03-2024"`

Applied to both the filename (for downloads) and the viewer title.

## Plan

### Step 1: Create a shared utility function
**File:** `src/lib/report-naming.ts` (new)

```typescript
export function formatReportFilename(
  organization: string | undefined,
  reportType: 'inspection' | 'training' | 'daily-assessment',
  extension: 'pdf' | 'html' = 'html'
): string {
  const org = (organization || 'Report').trim();
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${org} ${mm}-${yyyy}.${extension}`;
}
```

### Step 2: Update all filename references across forms

**`src/pages/InspectionForm.tsx`** — 4 locations:
- HTML viewer filename (line ~2369, ~3035)
- PDF download filename (lines ~2204, ~2231)

**`src/pages/TrainingForm.tsx`** — 3 locations:
- HTML viewer filename (line ~1144, ~1841)
- PDF download filename (line ~1030)

**`src/pages/DailyAssessmentForm.tsx`** — 2 locations:
- HTML viewer filename (line ~1332, ~1830)

All will import and use `formatReportFilename()`.

### Step 3: Update backup/recovery filenames (DataRecoveryTool)
**`src/components/admin/DataRecoveryTool.tsx`** — 3 download locations will also use the new convention where an organization name is available.

## Files Changed
1. `src/lib/report-naming.ts` — new shared utility
2. `src/pages/InspectionForm.tsx` — use new naming
3. `src/pages/TrainingForm.tsx` — use new naming
4. `src/pages/DailyAssessmentForm.tsx` — use new naming
5. `src/components/admin/DataRecoveryTool.tsx` — use new naming

## Cross-Platform
The naming uses only alphanumeric characters, spaces, and hyphens — safe on Windows, macOS, iOS, and Android. No special characters that would cause filesystem issues.

