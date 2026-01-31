

# Fix: Photo Gallery Drag-and-Drop Not Working

## Problem Analysis

After thorough investigation, I identified **two distinct issues** preventing drag-and-drop from working:

### Issue 1: Sensor Order and Configuration (Primary Issue)

The current sensor configuration in `PhotoGallery.tsx`:

```typescript
const sensors = useSensors(
  useSensor(TouchSensor, {
    activationConstraint: {
      delay: 200,        // Requires 200ms hold before drag
      tolerance: 5,
    },
  }),
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,       // Requires 8px movement
    },
  }),
  useSensor(KeyboardSensor)
);
```

**Problems identified:**
1. The `TouchSensor` with `delay: 200` requires users to hold for 200ms before drag activates - this feels unresponsive
2. The sensor configuration differs from the working admin components which use `PointerSensor` without touch-specific delays
3. On desktop Chrome, the PointerSensor should work, but the 8px distance threshold may conflict with how events propagate through the nested Card/Image structure

### Issue 2: Missing `MouseSensor` for Desktop Browser Compatibility

The admin CMS components that work correctly use:
```typescript
const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  })
);
```

Key difference: No `TouchSensor` with delays, and simpler configuration.

---

## Root Cause Summary

| Factor | Current State | Expected State |
|--------|---------------|----------------|
| Touch Sensor | 200ms delay required | Should be optional or lower |
| Pointer Sensor | 8px distance threshold | Should work, but may conflict |
| Working Pattern | Not matching admin components | Should match proven pattern |
| Desktop Support | Relies on PointerSensor | Should work consistently |

---

## Solution

Simplify the sensor configuration to match the working pattern from admin components, while maintaining mobile support:

### Changes to `PhotoGallery.tsx`

**Before:**
```typescript
const sensors = useSensors(
  useSensor(TouchSensor, {
    activationConstraint: {
      delay: 200,
      tolerance: 5,
    },
  }),
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,
    },
  }),
  useSensor(KeyboardSensor)
);
```

**After:**
```typescript
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 5,  // Reduced from 8 for more responsive feel
    },
  }),
  useSensor(TouchSensor, {
    activationConstraint: {
      delay: 150,     // Reduced from 200ms for quicker activation
      tolerance: 8,   // Increased for better touch detection
    },
  }),
  useSensor(KeyboardSensor)
);
```

### Key Changes:
1. **Reorder sensors**: Put `PointerSensor` first for desktop priority
2. **Reduce distance threshold**: 8px → 5px for more responsive desktop dragging
3. **Reduce touch delay**: 200ms → 150ms for faster mobile activation
4. **Increase touch tolerance**: 5px → 8px to prevent accidental drag cancellation

---

## Additional Debug Enhancement

Add console logging to confirm drag events are firing:

```typescript
const handleDragStart = (event: DragStartEvent) => {
  console.log('[PhotoGallery] Drag started:', event.active.id);
  setActiveId(event.active.id as string);
  triggerHaptic('selection');
};

const handleDragEnd = async (event: DragEndEvent) => {
  console.log('[PhotoGallery] Drag ended:', { 
    active: event.active.id, 
    over: event.over?.id 
  });
  // ... rest of handler
};
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/PhotoGallery.tsx` | Update sensor configuration and add debug logging |

---

## Technical Details

### Why PointerSensor First?

The `PointerSensor` handles both mouse and touch events via the Pointer Events API, which is well-supported in modern browsers. Putting it first ensures:
- Desktop users get immediate response
- Touch events are still handled when PointerSensor doesn't activate

### Why Reduce Thresholds?

- **Distance 8px → 5px**: Smaller threshold = faster recognition that user wants to drag
- **Delay 200ms → 150ms**: Reduces perceived lag on mobile while still preventing accidental drags
- **Tolerance 5px → 8px**: Allows slight finger movement during the delay period without canceling

---

## Expected Outcome

After implementation:
1. Desktop users can drag photos immediately after moving 5px
2. Mobile users can drag after holding for 150ms
3. Console logs will confirm drag events are firing
4. Photos will reorder with smooth animations
5. Order will persist to database and IndexedDB

---

## Testing Checklist

- [ ] Open an inspection report you own
- [ ] Click and drag the grip handle icon on any photo
- [ ] Verify the photo lifts and other photos shift to show drop position
- [ ] Drop the photo in a new position
- [ ] Verify the new order persists after page reload
- [ ] Test on mobile device with touch gestures
- [ ] Check console for drag event logs

