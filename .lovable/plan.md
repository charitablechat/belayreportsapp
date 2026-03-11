

## Gap Analysis Results

### 1. JSON Export Filenames — No gaps found
All download paths (`downloadReportBackup`, cloud snapshot download, admin edit export) consistently use `sanitizeFilename()` with the same `backup_{type}{orgPart}_{idPrefix}` pattern. The `sanitizeFilename` function correctly caps length at 60 chars, strips special characters, and collapses whitespace. Verified across all three call sites in `DataRecoveryTool.tsx` and the one in `local-backup-ledger.ts`.

### 2. 'Completed' Button State — GAP FOUND
**Severity: Medium — UX inconsistency, potential double-completion**

The memory states: *"the 'Complete' button remains visible but is updated to a disabled 'Completed' state with a CheckCircle icon."* However, the actual implementation does NOT do this.

Current behavior across all three forms:
- The **Complete** button is gated by `{!effectiveReadOnly && (` — which is `false` only for non-owners/non-admins
- When the owner views their own completed report, `effectiveReadOnly` is `false` (ownership grants edit rights regardless of status)
- The Complete button **remains fully clickable** even after completion
- There is no disabled "Completed" indicator anywhere

**Fix:** In all three forms, conditionally render the Complete button based on `inspection?.status !== 'completed'`, and show a disabled "Completed" indicator when the status IS completed:

```tsx
{!effectiveReadOnly && inspection?.status !== 'completed' && (
  <Button onClick={() => setShowCompleteDialog(true)} ...>
    <CheckCircle /> Complete
  </Button>
)}
{inspection?.status === 'completed' && (
  <Button disabled variant="outline" size="sm" className="opacity-70 cursor-default">
    <CheckCircle className="w-4 h-4" />
    <span>Completed</span>
  </Button>
)}
```

Apply to: `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`

### 3. Retro-compatibility / Import Inference — No gaps found
The `inferReportType()` function uses field-presence heuristics that map cleanly to each schema:
- **Inspection**: `inspection_date` OR (`location` AND `acct_number`) — unique combination
- **Training**: `start_date` AND `end_date` AND `trainee_names` — all three required, no ambiguity
- **Daily assessment**: `assessment_date` OR (`site` AND `environment_comments`)

The three-format normalizer (Format A/B/C) correctly handles: standard exports, cloud/admin exports with `snapshot_data`, and raw ReportSnapshot objects. Snake_case (`report_type`, `report_id`) is handled at line 418-419 via `??` fallback. No misclassification risk with correctly-formatted reports since Format A/B always carry explicit `reportType`.

### 4. Green Flash Highlight — No gaps found
- CSS animation defined in `index.css` line 693-699, using `hsl(var(--success) / 0.25)` → `--success` is defined in both light (line 39) and dark (line 178) themes
- `highlightedId` state set with `setTimeout(() => setHighlightedId(null), 8600)` — 100ms buffer over the 8500ms CSS animation duration prevents premature class removal
- Applied to both mobile card view (line 305) and desktop table row (line 365) — consistent across viewports
- No race condition: `setHighlightedId` is called synchronously after import success, and `refreshSnapshots()` is called before it so the new entry is in the list when the highlight is applied
- No performance concern: single string comparison per row during render, cleared by timeout

### Summary

| Area | Status | Action |
|------|--------|--------|
| Filename standardization | Clean | None |
| Completed button persistence | **Gap** | Add disabled "Completed" indicator in all 3 forms |
| Import retro-compatibility | Clean | None |
| Green flash highlight | Clean | None |

