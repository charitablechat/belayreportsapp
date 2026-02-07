
# Production Readiness Audit -- v2.4.17 / v2.4.18

## 1. Summary of Findings

Three areas require attention. No critical blockers were found -- the core data integrity and autocomplete patterns are correctly implemented. The issues identified are medium-severity consistency gaps and one performance concern.

## 2. Detailed Issue Log

| # | Issue | File(s) | Severity | Details & Proposed Fix |
|---|-------|---------|----------|----------------------|
| 1 | **TrainingForm localIsNewer guard does not protect child data** | `TrainingForm.tsx` (lines 306-318) | **High** | When `localIsNewer` is true, only `status` and `inspector_id` are updated from the server, which is correct for the parent record. However, the code falls through to `else if (trainingData)` which fetches AND applies all child data from the server (delivery_approaches, operating_systems, etc.), overwriting the local IndexedDB child data. Compare with `InspectionForm.tsx` (line 872) which explicitly skips all server child data when local is newer. **Fix**: Add an early return or skip the child data fetch block when `localIsNewer` is true. |
| 2 | **DailyAssessmentForm localIsNewer guard does not protect child data** | `DailyAssessmentForm.tsx` (lines 306-349) | **High** | Same issue as TrainingForm. When `localIsNewer` is true, the code correctly preserves the parent assessment, but the child data fetch block (beginning_of_day, end_of_day, etc.) runs regardless because the `else if (assessmentData)` branch is separate. Since child data was already loaded from IndexedDB at lines 257-271, the server fetch should be skipped. **Fix**: Restructure the conditional to skip server child data loading when `localIsNewer`. |
| 3 | **OrganizationAutocomplete uses legacy `user_field_history` table** | `OrganizationAutocomplete.tsx` | **Medium** | Still queries `user_field_history` (user-scoped) instead of `global_field_history` (cross-user). This means organization suggestions are not shared across users, unlike all other GlobalAutocomplete fields. This is inconsistent with the unified global autocomplete architecture. **Fix**: Migrate to use `GlobalAutocomplete` with `fieldType="organization"`, or update queries to use `global_field_history`. |
| 4 | **DatabaseAutocomplete uses legacy `user_field_history` table** | `DatabaseAutocomplete.tsx` | **Medium** | Same issue as OrganizationAutocomplete -- still uses the legacy per-user table. **Fix**: Same approach -- migrate to GlobalAutocomplete or update the data source. |
| 5 | **Dashboard supabase query has 6s inner timeout inside 15s outer timeout** | `Dashboard.tsx` (line 316) | **Low** | The `loadInspections` function wraps the Supabase query in `withNetworkTimeout(..., 6000)` but the outer `withNetworkTimeout` default is now 15s. The inner 6s timeout will always fire first, making the 15s increase partially ineffective for this specific query. The same pattern applies to training and assessment loaders. **Fix**: Increase inner timeout to match or remove the double-wrapping. |
| 6 | **ResultSelect and SystemTypeSelect remain unchanged** | `ResultSelect.tsx`, `SystemTypeSelect.tsx` | **None (Verified)** | Both components use standard `Select` dropdowns with no inline-editable input pattern. They were correctly excluded from the v2.4.18 autocomplete redesign. No action needed. |

## 3. Verification Checklist

### v2.4.17 -- Data Persistence Logic (localIsNewer Guard)

- [x] **InspectionForm.tsx**: Correctly implemented. When `localIsNewer` is true, both parent inspection AND all child data (systems, ziplines, equipment, standards, summary) are preserved from local IndexedDB. Server data is skipped entirely (line 872).
- [ ] **TrainingForm.tsx**: INCOMPLETE. Parent record protected, but child data (delivery_approaches, operating_systems, immediate_attention, verifiable_items, systems_in_place, summary) is overwritten by server fetch. Needs fix.
- [ ] **DailyAssessmentForm.tsx**: INCOMPLETE. Parent record protected, but child data (beginning_of_day, end_of_day, operating_systems, equipment_checks, structure_checks, environment_checks) is overwritten by server fetch. Needs fix.

### v2.4.18 -- Inline-Editable Autocomplete Fields

- [x] **GlobalAutocomplete**: Correct. Uses inline Input trigger with brutalist focus style, X clear button, Enter/Escape/Blur commit logic, lazy database fetch on popover open.
- [x] **HistoryAutocomplete**: Correct. Same inline-editable pattern with localStorage + optional global_field_history sync.
- [x] **OrganizationAutocomplete**: Correct inline-editable pattern. Uses legacy data source (see Issue #3) but interaction behavior matches spec.
- [x] **DatabaseAutocomplete**: Correct inline-editable pattern. Uses legacy data source (see Issue #4) but interaction behavior matches spec.
- [x] **ResultSelect**: Unchanged. Standard Select dropdown. Correctly excluded.
- [x] **SystemTypeSelect**: Unchanged. Standard Select dropdown with custom option management. Correctly excluded.

### Performance

- [x] Dashboard timeout increased to 15s (outer wrapper)
- [x] Auth pre-fetch optimization in handleOnline/onSyncComplete (single getUserWithCache call shared across all loaders)
- [x] Safety timeouts on all form saves (8s cap)
- [x] Non-blocking cache updates (fire-and-forget pattern) across all forms
- [ ] Inner 6s timeout on individual Supabase queries may still cause premature failures (Issue #5)

## 4. Recommended Implementation Priority

1. **Fix TrainingForm localIsNewer child data protection** (High) -- prevents data loss
2. **Fix DailyAssessmentForm localIsNewer child data protection** (High) -- prevents data loss
3. **Align inner query timeouts with outer timeout** (Low) -- prevents premature timeout failures
4. **Migrate OrganizationAutocomplete to global_field_history** (Medium) -- consistency improvement, not urgent
5. **Migrate DatabaseAutocomplete to global_field_history** (Medium) -- same as above
