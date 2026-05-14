---
name: Dropdown Commit Immediate Save
description: Select / ResultSelect / SystemTypeSelect changes in inspection tables (Equipment, Ziplines, OperatingSystems) defer-trigger onImmediateSave via setTimeout(_,0) because dropdowns have no blur event; without this the 1.5s debounced auto-save can lose values on quick navigation
type: feature
---
Dropdown selections in inventory tables (Equipment result/category/type, Zipline cable_type/cable_result/braking_system/braking_result/ead_system/ead_result/result, OperatingSystem result/system_name) call `setTimeout(() => onImmediateSave(), 0)` after `onUpdate` so React state flushes before performSave reads it. Synchronous calls would race setState and ship stale payloads (see warning comment in InspectionHeader.tsx around OrganizationAutocomplete). Each table file defines a `COMMIT_FIELDS` Set; only fields in that Set trigger the deferred save — text-input fields keep their existing onBlur=onImmediateSave path and must NOT also be added to COMMIT_FIELDS (would double-fire).
