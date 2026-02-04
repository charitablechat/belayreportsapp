
# Plan: Mobile Layout & Text Wrapping Fixes (< 768px)

## Issue Analysis

Based on the screenshot and code inspection, the critical mobile layout issue is in the **EquipmentTable.tsx** component's CardHeader where the title and "Add" button compete for horizontal space on narrow screens:

**Root Cause (Line 91-97 in EquipmentTable.tsx):**
```tsx
<CardHeader className="px-4 md:px-6">
  <div className="flex items-center justify-between">
    <CardTitle className="text-lg">EQUIPMENT - {displayName.toUpperCase()}</CardTitle>
    <Button onClick={addEquipment} size="sm">
      <Plus className="w-4 h-4 mr-2" />
      Add {displayName}
    </Button>
  </div>
</CardHeader>
```

The `flex justify-between` layout forces both elements side-by-side on ALL screen sizes, causing:
- Title text wrapping awkwardly across 4+ lines
- Button text being cut off on the right edge
- Compressed, "squished" appearance

---

## Affected Components (Full Audit)

### Critical Priority (Visible in Screenshot)
| Component | Issue | Severity |
|-----------|-------|----------|
| `EquipmentTable.tsx` | Title + Button side-by-side causing severe text wrapping | **Critical** |

### Medium Priority (Same Pattern)
| Component | Issue | Severity |
|-----------|-------|----------|
| `ZiplinesTable.tsx` | Same side-by-side pattern (shorter title so less severe) | Medium |
| `OperatingSystemsTable.tsx` | Same pattern | Medium |
| `SummarySection.tsx` | Title + "Regenerate" button side-by-side | Medium |

### Low Priority (No Issues Found)
| Component | Status |
|-----------|--------|
| `StandardsTable.tsx` | Title only, no button - ✅ OK |
| `DeliveryApproachSection.tsx` | Title only - ✅ OK |
| `OperatingSystemsSection.tsx` (Training) | Title only - ✅ OK |
| `ImmediateAttentionSection.tsx` | Title only - ✅ OK |
| `VerifiableItemsSection.tsx` | Title only - ✅ OK |
| `SystemsInPlaceSection.tsx` | Title only - ✅ OK |
| `EquipmentChecksSection.tsx` (Daily) | Title only - ✅ OK |

---

## Solution Approach

Apply a **mobile-responsive stacked layout** pattern:

**Before (Broken):**
```
┌─────────────────────────────────────┐
│ EQUIPMENT -     │ + Add Connectors  │  ← Competing for space
│ CONNECTORS      │   (Carabiners...  │
│ (CARABINERS...  │                   │
└─────────────────────────────────────┘
```

**After (Fixed):**
```
┌─────────────────────────────────────┐
│ EQUIPMENT - CONNECTORS              │  ← Full width title
│ (CARABINERS & QUICKLINKS)           │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ + Add Connectors                │ │  ← Full width button below
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

## Technical Implementation

### 1. EquipmentTable.tsx (Critical Fix)

**Current (Lines 90-98):**
```tsx
<CardHeader className="px-4 md:px-6">
  <div className="flex items-center justify-between">
    <CardTitle className="text-lg">EQUIPMENT - {displayName.toUpperCase()}</CardTitle>
    <Button onClick={addEquipment} size="sm">
      <Plus className="w-4 h-4 mr-2" />
      Add {displayName}
    </Button>
  </div>
</CardHeader>
```

**Fixed:**
```tsx
<CardHeader className="px-4 md:px-6">
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
    <CardTitle className="text-base md:text-lg">
      EQUIPMENT - {displayName.toUpperCase()}
    </CardTitle>
    <Button onClick={addEquipment} size="sm" className="w-full md:w-auto shrink-0">
      <Plus className="w-4 h-4 mr-2" />
      <span className="md:hidden">Add</span>
      <span className="hidden md:inline">Add {displayName}</span>
    </Button>
  </div>
</CardHeader>
```

**Key Changes:**
- `flex-col md:flex-row`: Stack vertically on mobile, horizontal on desktop
- `gap-3`: Consistent spacing between title and button
- `text-base md:text-lg`: Slightly smaller title on mobile
- `w-full md:w-auto`: Full-width button on mobile for better touch targets
- `shrink-0`: Prevent button from shrinking
- Shorter button text on mobile: "Add" vs "Add {displayName}"

### 2. ZiplinesTable.tsx (Same Pattern Fix)

**Current (Lines 92-99):**
```tsx
<CardHeader className="px-4 md:px-6">
  <div className="flex items-center justify-between">
    <CardTitle>Ziplines</CardTitle>
    <Button onClick={addZipline} size="sm">
      <Plus className="w-4 h-4 mr-2" />
      Add Zipline
    </Button>
  </div>
</CardHeader>
```

**Fixed:**
```tsx
<CardHeader className="px-4 md:px-6">
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
    <CardTitle>Ziplines</CardTitle>
    <Button onClick={addZipline} size="sm" className="w-full md:w-auto shrink-0">
      <Plus className="w-4 h-4 mr-2" />
      Add Zipline
    </Button>
  </div>
</CardHeader>
```

### 3. OperatingSystemsTable.tsx (Same Pattern Fix)

**Current (Lines 82-89):**
```tsx
<CardHeader className="px-4 md:px-6">
  <div className="flex items-center justify-between">
    <CardTitle>Operating Systems</CardTitle>
    <Button onClick={addSystem} size="sm">
      <Plus className="w-4 h-4 mr-2" />
      Add System
    </Button>
  </div>
</CardHeader>
```

**Fixed:**
```tsx
<CardHeader className="px-4 md:px-6">
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
    <CardTitle>Operating Systems</CardTitle>
    <Button onClick={addSystem} size="sm" className="w-full md:w-auto shrink-0">
      <Plus className="w-4 h-4 mr-2" />
      Add System
    </Button>
  </div>
</CardHeader>
```

### 4. SummarySection.tsx (Same Pattern Fix)

**Current (Lines 22-35):**
```tsx
<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
  <CardTitle>Report Summary</CardTitle>
  {onRegenerate && (
    <Button variant="outline" size="sm" onClick={onRegenerate} className="gap-2">
      <RefreshCw className="h-4 w-4" />
      Regenerate from Inspection
    </Button>
  )}
</CardHeader>
```

**Fixed:**
```tsx
<CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 space-y-0 pb-4">
  <CardTitle>Report Summary</CardTitle>
  {onRegenerate && (
    <Button variant="outline" size="sm" onClick={onRegenerate} className="w-full md:w-auto shrink-0 gap-2">
      <RefreshCw className="h-4 w-4" />
      <span className="md:hidden">Regenerate</span>
      <span className="hidden md:inline">Regenerate from Inspection</span>
    </Button>
  )}
</CardHeader>
```

---

## Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| `src/components/inspection/EquipmentTable.tsx` | Stacked mobile layout, shorter button text | Critical |
| `src/components/inspection/ZiplinesTable.tsx` | Stacked mobile layout | Medium |
| `src/components/inspection/OperatingSystemsTable.tsx` | Stacked mobile layout | Medium |
| `src/components/inspection/SummarySection.tsx` | Stacked mobile layout, shorter button text | Medium |

---

## Version Update

Increment version to `v2.1.20` in `vite.config.ts` to reflect these mobile layout fixes:

```typescript
// v2.1.20 - Mobile CardHeader layout fixes: stacked title/button layout for Equipment, Ziplines, Operating Systems, Summary sections
const APP_VERSION = "2.1.20";
```

---

## Visual Result (Expected)

**Equipment Section - Mobile (< 768px):**
```
┌─────────────────────────────────────┐
│ EQUIPMENT - CONNECTORS              │
│ (CARABINERS & QUICKLINKS)           │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │     + Add                       │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Equipment Section - Desktop (≥ 768px):**
```
┌──────────────────────────────────────────────────────────────┐
│ EQUIPMENT - CONNECTORS (CARABINERS & QUICKLINKS)   + Add... │
└──────────────────────────────────────────────────────────────┘
```

---

## Testing Checklist

- [ ] Equipment section titles no longer wrap awkwardly on mobile
- [ ] "Add" buttons are full-width and easily tappable on mobile
- [ ] Desktop layout remains unchanged (side-by-side)
- [ ] All four components display correctly at 320px, 375px, 414px widths
- [ ] Version badge shows v2.1.20 in profile dropdown
