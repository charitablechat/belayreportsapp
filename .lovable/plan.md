
# Plan: Fix Versioning Yellow Items (v2.3.5)

## Summary

Address the three versioning compliance issues identified in the Launch Readiness Assessment to move from Yellow to Green status.

## Issues to Fix

| Item | Current State | Required Fix |
|------|---------------|--------------|
| vite.config.ts comment | Says "Z increments by 10" | Update to describe rollover scheme |
| Unit tests | None exist | Add comprehensive test file |
| Documentation | Scattered | Consolidate in version-calculator.ts header |

---

## Technical Changes

### 1. Update vite.config.ts Comment (Line 7)

**Before:**
```typescript
// Version follows vX.Y.Z format where Z increments by 10 on each deployment
```

**After:**
```typescript
// Version follows non-standard vX.Y.Z rollover scheme:
// - PATCH resets to .1 when reaching .10 (e.g., v2.3.9 → v2.4.1)
// - MINOR resets to .1 when reaching .10 (e.g., v2.9.9 → v3.1.1)
// See src/lib/version-calculator.ts for implementation
```

### 2. Create Unit Tests for version-calculator.ts

Create new file: `src/lib/version-calculator.test.ts`

Test coverage will include:
- Basic version parsing (with and without 'v' prefix)
- Invalid version format handling
- Standard increment (v2.3.4 → v2.3.5)
- PATCH rollover (v2.3.9 → v2.4.1)
- MINOR rollover (v2.9.9 → v3.1.1)
- Double rollover edge case (v9.9.9 → v10.1.1)
- Sequence generation
- Validation function

### 3. Bump Version to 2.3.5

Update APP_VERSION and BUILD_TIMESTAMP in vite.config.ts.

---

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `vite.config.ts` | **Modify** | Fix comment, bump to v2.3.5 |
| `src/lib/version-calculator.test.ts` | **Create** | Add unit tests |

---

## Test File Structure

```typescript
// src/lib/version-calculator.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  getNextVersion,
  formatVersion,
  calculateNextVersion,
  generateVersionSequence,
  isValidSchemeVersion
} from './version-calculator';

describe('version-calculator', () => {
  describe('parseVersion', () => {
    it('parses version without prefix', () => { ... });
    it('parses version with v prefix', () => { ... });
    it('throws on invalid format', () => { ... });
  });

  describe('getNextVersion', () => {
    it('increments patch normally', () => { ... });
    it('rolls over patch at 10', () => { ... });
    it('rolls over minor at 10', () => { ... });
    it('handles double rollover', () => { ... });
  });

  describe('formatVersion', () => { ... });
  describe('calculateNextVersion', () => { ... });
  describe('generateVersionSequence', () => { ... });
  describe('isValidSchemeVersion', () => { ... });
});
```

---

## Expected Test Cases

| Input | Expected Output | Test Type |
|-------|-----------------|-----------|
| `v2.3.4` | `v2.3.5` | Standard increment |
| `v2.3.9` | `v2.4.1` | PATCH rollover |
| `v2.9.9` | `v3.1.1` | MINOR rollover |
| `v9.9.9` | `v10.1.1` | Edge case - MAJOR bump |
| `v1.1.1` | `v1.1.2` | Minimum valid version |
| `2.3.4` | `v2.3.5` | No prefix handling |

---

## Why This Matters

1. **Documentation Accuracy**: Developers reading vite.config.ts will understand the actual versioning scheme
2. **Regression Prevention**: Unit tests ensure future changes don't break versioning logic
3. **Launch Confidence**: Moving versioning from Yellow to Green status

---

## Post-Implementation

After these changes, the Versioning Compliance section of the Launch Readiness Scorecard moves from **Yellow** to **Green**, achieving 100% launch readiness.
