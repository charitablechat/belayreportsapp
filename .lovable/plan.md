

# Fix: Locked Report Dialog Not Triggering on Completed Reports

## Root Cause Analysis

The lock mechanism relies on two layers: (1) `onClickCapture` event interception on `<main>`, and (2) passing `effectiveReadOnly` to child components to disable inputs. **Layer 2 is almost entirely missing.**

### Problem 1: Sub-components never receive `readOnly`

The following components are rendered WITHOUT any `readOnly` or `disabled` prop, so their inputs, buttons, selects, and rich text editors remain fully interactive even when the report is completed:

**InspectionForm.tsx:**
- `OperatingSystemsTable` (line 2255)
- `ZiplinesTable` (line 2256)
- `EquipmentTable` (lines 2282-2338)
- `StandardsTable` (line 2363)
- `SummarySection` (line 2386)

**TrainingForm.tsx:**
- `DeliveryApproachSection` (line 1132)
- `OperatingSystemsSection` (line 1139)
- `ImmediateAttentionSection` (line 1146)
- `VerifiableItemsSection` (line 1153)
- `TrainingSummarySection` (line 1162)

**DailyAssessmentForm.tsx:**
- `BeginningOfDaySection` (line 1251)
- `EndOfDaySection` (line 1258)
- `OperatingSystemsSection` (line 1265)
- `EquipmentChecksSection` (line 1274)
- `StructureChecksSection` (line 1281)
- `EnvironmentChecksSection` (line 1290)

### Problem 2: Portal-based components bypass `onClickCapture`

Radix UI `Select`, `Popover`, and `Combobox` render dropdown menus in **portals** at the document root. Clicks inside these portals never bubble through `<main>`, so `handleLockedFieldClick` never fires. Users can freely change dropdown values in locked reports.

### Problem 3: CSS selector matching is incomplete

The selector `'input, textarea, select, ...'` only catches clicks directly ON those elements. Clicking on a `<label>`, a card wrapper, or blank space inside a form section does not trigger the dialog -- the user must click precisely on the form control itself.

## Solution: Dual-Layer Protection

### Layer 1 -- Pointer-events overlay (blanket protection)

When `isCompletionLocked` is true, wrap each `TabsContent` body in a container that:
- Sets `pointer-events: none` on all child content (prevents ALL interactions)
- Places an invisible overlay div with `pointer-events: auto` on top that captures clicks and triggers the unlock dialog
- Keeps `TabsList` OUTSIDE this wrapper so tab navigation remains functional

This is a single, robust mechanism that blocks all input types (mouse, touch, keyboard focus) without modifying 16+ sub-components.

### Layer 2 -- CompletionLockDialog aesthetic update

Update the dialog to match the requested Retro-Tech Terminal / CRT aesthetic:
- `border-double` border style
- `bg-black` background
- `text-green-500` text color
- CRT scanline overlay effect
- Monospaced typography (already in place)

## Files to Change

### 1. `src/pages/InspectionForm.tsx`

**Wrap TabsContent areas with lock overlay** (around lines 2254-2411):

Add a reusable wrapper around the content inside each `TabsContent` (or around the entire Tabs content area below the TabsList). When `isCompletionLocked`:
- Add `style={{ pointerEvents: 'none' }}` to the content wrapper
- Render an absolutely-positioned transparent overlay div with `pointerEvents: 'auto'` and an `onClick` handler that calls `setShowCompletionLockDialog(true)`

```text
Structure:
<Tabs>
  <TabsList>...</TabsList>  (always interactive)

  <div className="relative">
    {isCompletionLocked && (
      <div
        className="absolute inset-0 z-10 cursor-not-allowed"
        onClick={() => setShowCompletionLockDialog(true)}
      />
    )}
    <div style={isCompletionLocked ? { pointerEvents: 'none' } : undefined}>
      <TabsContent>...</TabsContent>
      <TabsContent>...</TabsContent>
      ...
    </div>
  </div>
</Tabs>
```

Also wrap `InspectionHeader` in the same pointer-events guard since it sits above the tabs but inside `<main>`.

### 2. `src/pages/TrainingForm.tsx`

Same overlay pattern around the Tabs content area (lines 1121-1195). The `TrainingHeader` inside `TabsContent value="info"` is already gated with `effectiveReadOnly`, but the overlay provides blanket protection for all tabs.

### 3. `src/pages/DailyAssessmentForm.tsx`

Same overlay pattern around the Tabs content area (lines 1250-1323). The `DailyAssessmentHeader` is already gated, but the sub-section components are not.

### 4. `src/components/CompletionLockDialog.tsx`

Update the aesthetic to Retro-Tech Terminal / CRT style:

**Current:**
```
bg-black border-2 border-amber-500 font-mono
```

**New:**
```
bg-black border-double border-4 border-green-500 font-mono
```

- Change header text from `text-amber-400` to `text-green-500`
- Change description text to `text-green-400/80`
- Cancel button: `border-green-500/60 text-green-500`
- Confirm button: `bg-green-500 text-black`
- Add a CSS pseudo-element overlay for CRT scanline effect (repeating gradient of semi-transparent lines)
- Keep Lock icon and "REPORT LOCKED" header text
- Update confirm button text to "Confirm Edit"

### 5. Lock banner update (all three forms)

Update the amber lock banner at the top of locked reports to match the green CRT aesthetic:
- Change `border-amber-500/60` to `border-green-500/60`
- Change `text-amber-400` to `text-green-500`

## What Does NOT Change

- `useReportEditPermission` hook -- permission logic is correct
- `completionLockOverridden` state management -- toggle logic is correct
- Auto-save, sync, and navigation guard behavior
- Photo components (already correctly gated by `effectiveReadOnly`)
- Backend, edge functions, RLS policies
- No auth tokens or secrets are stored in frontend state

## Why This Approach

The overlay approach is chosen over adding `readOnly` props to 16+ sub-components because:
1. It provides immediate, guaranteed protection with minimal code changes
2. It cannot be bypassed by keyboard navigation, portal dropdowns, or component-specific quirks
3. It maintains the click-to-unlock UX pattern (clicking the overlay triggers the dialog)
4. Sub-components remain unchanged, reducing regression risk

