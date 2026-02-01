
# Plan: Immediate Local Persistence with Background Sync for All Data Including Photos

## Overview
Implement a **local-first architecture** for all user inputs including photos, ensuring data is persisted to IndexedDB immediately upon capture, with UI feedback shown instantly. Background synchronization occurs asynchronously without blocking the user interface.

---

## Critical Issue Identified

### PhotoCapture Component Blocks UI When Online

**Current Behavior** (problematic):
```
User selects photo
    ↓
[BLOCKING] If online: Upload to Supabase Storage (5-30+ seconds on slow network)
    ↓
[BLOCKING] If online: Insert into inspection_photos table
    ↓
Finally: Call onPhotoAdded() to refresh gallery
```

**Desired Behavior** (local-first):
```
User selects photo
    ↓
[IMMEDIATE] Save compressed blob to IndexedDB
    ↓
[IMMEDIATE] Call onPhotoAdded() to refresh gallery
    ↓
[BACKGROUND] Queue for remote sync (fire-and-forget)
```

---

## Current State Analysis

### Already Working Correctly (No Changes Needed)

| Component | Pattern | Status |
|-----------|---------|--------|
| `InspectionForm.tsx` | Fire-and-forget IndexedDB + 1.5s debounce | ✅ Correct |
| `TrainingForm.tsx` | Fire-and-forget IndexedDB + 1.5s debounce | ✅ Correct |
| `DailyAssessmentForm.tsx` | Fire-and-forget IndexedDB + 1.5s debounce | ✅ Correct |
| `PhotoGallery.tsx` | Loads from IndexedDB first, merges with remote | ✅ Correct |

### Requires Fix

| Component | Issue | Impact |
|-----------|-------|--------|
| `PhotoCapture.tsx` | Awaits network upload when online (lines 72-92) | **P1: Blocks UI for 5-30+ seconds** |
| `useAutoSync.tsx` | Fixed 30s interval for all devices | Medium: Battery drain on mobile |

---

## Implementation Steps

### Step 1: Fix PhotoCapture to Use Local-First Pattern

**File**: `src/components/PhotoCapture.tsx`

**Changes**:
1. **Always save to IndexedDB first** (regardless of online status)
2. **Call `onPhotoAdded()` immediately** after local save (instant UI feedback)
3. **Queue remote sync as fire-and-forget** (non-blocking background operation)
4. **Show success feedback** based on local save, not network upload

**New Flow**:
```typescript
const handleFileSelect = async (e) => {
  // ... existing compression logic ...
  
  for (const file of Array.from(files)) {
    const processedFile = await compressImage(file, {...});
    
    // 1. ALWAYS save to IndexedDB FIRST (local-first)
    const photoId = `${inspectionId}-${Date.now()}-${randomId()}`;
    await savePhotoOffline({
      id: photoId,
      inspectionId,
      section,
      blob: processedFile,
      fileName: processedFile.name,
      uploaded: false,
    });
    
    // 2. IMMEDIATELY refresh gallery (user sees photo instantly)
    onPhotoAdded();
    
    // 3. Queue background sync (fire-and-forget, non-blocking)
    if (navigator.onLine) {
      queuePhotoUpload(photoId, processedFile).catch((error) => {
        console.warn('[PhotoCapture] Background sync queued:', error);
        // Photo remains in IndexedDB for next auto-sync
      });
    }
  }
  
  triggerHaptic('success'); // Immediate success feedback
};

// Fire-and-forget photo upload (runs in background)
const queuePhotoUpload = async (photoId: string, file: File) => {
  try {
    const user = await getUserWithCache();
    const fileName = `${user.id}/${inspectionId}/${Date.now()}.${ext}`;
    
    // Upload to storage
    await supabase.storage.from('inspection-photos').upload(fileName, file);
    
    // Insert database record
    await supabase.from('inspection_photos').insert({
      inspection_id: inspectionId,
      photo_url: fileName,
      photo_section: section,
    });
    
    // Mark as uploaded in IndexedDB (success)
    await markPhotoAsUploaded(photoId, fileName);
  } catch (error) {
    // Leave in IndexedDB - will be synced by useAutoSync
    console.warn('[PhotoCapture] Background upload failed, queued for later');
  }
};
```

### Step 2: Add Mobile-Optimized Sync Interval to useAutoSync

**File**: `src/hooks/useAutoSync.tsx`

**Changes**:
1. Import `useIsMobile` hook
2. Add `MOBILE_SYNC_INTERVAL = 300000` (5 minutes)
3. Use computed interval based on viewport
4. Add dependency to re-initialize on viewport change

**Code Changes**:
```typescript
// At top of file
import { useIsMobile } from '@/hooks/use-mobile';

// Replace constants
const DESKTOP_SYNC_INTERVAL = 30000; // 30 seconds
const MOBILE_SYNC_INTERVAL = 300000; // 5 minutes for mobile

// Inside hook
const isMobileViewport = useIsMobile();
const syncInterval = isMobileViewport ? MOBILE_SYNC_INTERVAL : DESKTOP_SYNC_INTERVAL;

// In useEffect for periodic sync
periodicSyncIntervalRef.current = setInterval(() => {
  if (!document.hidden && navigator.onLine) {
    performSync(true);
  }
}, syncInterval);

// Add syncInterval to dependency array
```

---

## Data Flow Architecture

### Before (Current - Blocking)

```text
Photo Capture (ONLINE)
    │
    ▼
[BLOCKING] Upload to Supabase Storage (5-30 seconds)
    │
    ▼
[BLOCKING] Insert to inspection_photos table
    │
    ▼
onPhotoAdded() - User finally sees photo
```

### After (Proposed - Non-Blocking)

```text
Photo Capture
    │
    ▼
[50ms] Compress image
    │
    ▼
[10ms] Save to IndexedDB (local)
    │
    ▼
[IMMEDIATE] onPhotoAdded() - User sees photo with "Pending" badge
    │
    ├─────────────────────────────────────────────────────────┐
    │                                                         │
    ▼                                                         ▼
[UI CONTINUES]                              [BACKGROUND - Fire & Forget]
User can continue                           Upload to Supabase Storage
capturing photos                            Insert to database
                                            Mark as "Synced" in IndexedDB
                                            Gallery auto-refreshes
```

---

## Files to Modify

| File | Action | Changes |
|------|--------|---------|
| `src/components/PhotoCapture.tsx` | **Modify** | Implement local-first photo save with background sync |
| `src/hooks/useAutoSync.tsx` | **Modify** | Add mobile-aware sync intervals (5 min vs 30 sec) |

---

## Detailed Code Changes

### PhotoCapture.tsx - Complete Rewrite of handleFileSelect

The key changes are:
1. Remove the `if (isOnline) {...} else {...}` branching
2. Always save locally first
3. Always call `onPhotoAdded()` immediately
4. Fire-and-forget the network upload

```typescript
// Lines 72-108 (current blocking pattern) becomes:

// ALWAYS save to IndexedDB FIRST (local-first architecture)
const photoId = `${inspectionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
await savePhotoOffline({
  id: photoId,
  inspectionId,
  section,
  blob: processedFile,
  fileName: processedFile.name,
  uploaded: false,
});

if (import.meta.env.DEV) {
  console.log('[PhotoCapture] Photo saved locally:', photoId);
}

// If online, attempt background sync (fire-and-forget)
if (isOnline) {
  const fileExt = processedFile.name.split('.').pop();
  const fileName = `${user.id}/${inspectionId}/${Date.now()}.${fileExt}`;
  
  // Fire-and-forget - don't await, don't block UI
  (async () => {
    try {
      const { error: uploadError } = await supabase.storage
        .from('inspection-photos')
        .upload(fileName, processedFile);

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('inspection_photos')
        .insert({
          inspection_id: inspectionId,
          photo_url: fileName,
          photo_section: section,
        });

      if (dbError) throw dbError;

      // Mark as uploaded in local storage
      await markPhotoAsUploaded(photoId, fileName);
      
      if (import.meta.env.DEV) {
        console.log('[PhotoCapture] Background sync completed:', photoId);
      }
    } catch (error) {
      console.warn('[PhotoCapture] Background sync failed, will retry later:', error);
      // Photo remains in IndexedDB with uploaded=false
      // Will be synced by useAutoSync
    }
  })();
}
```

### useAutoSync.tsx - Mobile Interval Configuration

```typescript
// Line 1 - Add import
import { useIsMobile } from '@/hooks/use-mobile';

// Lines 9-12 - Update constants
const DEBOUNCE_DELAY = 3000;
const DESKTOP_SYNC_INTERVAL = 30000; // 30 seconds for desktop
const MOBILE_SYNC_INTERVAL = 300000; // 5 minutes for mobile viewports
const MIN_SYNC_INTERVAL = 5000;
const INITIAL_SYNC_DELAY = 2000;
const SYNC_TIMEOUT = 30000;

// Line ~55 - Inside hook, add viewport detection
const isMobileViewport = useIsMobile();
const syncInterval = isMobileViewport ? MOBILE_SYNC_INTERVAL : DESKTOP_SYNC_INTERVAL;

// Line ~150 - Update periodic sync interval
periodicSyncIntervalRef.current = setInterval(() => {
  if (!document.hidden && navigator.onLine) {
    performSync(true);
  }
}, syncInterval);

// Line ~165 - Add syncInterval to logging
if (import.meta.env.DEV) {
  console.log('[AutoSync] Initialized with interval:', syncInterval / 1000, 's (mobile:', isMobileViewport, ')');
}

// Cleanup effect must recreate interval when viewport changes
// Add syncInterval to dependency array
}, [performSync, ..., syncInterval]);
```

---

## UI Feedback Improvements

### Immediate Visual Confirmation

The PhotoGallery already shows:
- **"Pending" badge** (orange) for `uploaded: false`
- **"Synced" badge** (green) for `uploaded: true`

This provides instant feedback that the photo is saved locally and will sync when possible.

### Suggested Toast Enhancement (Optional)

```typescript
// In PhotoCapture after local save:
toast.success('Photo saved', {
  description: isOnline ? 'Syncing to cloud...' : 'Will sync when online',
  duration: 2000,
});
```

---

## Error Handling & Resilience

### Failure Scenarios

| Scenario | Handling |
|----------|----------|
| IndexedDB write fails | Show error toast, don't call onPhotoAdded |
| Network upload fails | Photo stays in IndexedDB, useAutoSync retries every 5min/30sec |
| App closes during upload | IndexedDB persists, resumes on next app open |
| Device goes offline mid-upload | Photo marked as pending, syncs when online |

### Retry Mechanism

The existing `syncPhotos()` function in `sync-manager.ts` already handles retrying unuploaded photos. No changes needed there.

---

## Testing Checklist

After implementation:
- [ ] Take photo on mobile (online) - should appear instantly with "Pending" badge
- [ ] Verify badge changes to "Synced" after background upload completes
- [ ] Take photo offline - should appear with "Pending" badge
- [ ] Go online - verify photo syncs automatically
- [ ] Test on slow 3G network - UI should remain responsive
- [ ] Verify 5-minute sync interval on mobile viewport
- [ ] Verify 30-second sync interval on desktop viewport
- [ ] Test viewport resize - verify interval changes dynamically
- [ ] Verify all form fields still auto-save with 1.5s debounce

---

## Risk Assessment

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Duplicate photos if retry runs while original is still uploading | Low | Add upload mutex per photo ID |
| IndexedDB quota exceeded | Low | Already have quota check; photos are compressed |
| Photo lost if IndexedDB cleared | Very Low | Warn users on storage clear; data recovery guide exists |
| Mobile battery drain from frequent sync | Addressed | 5-minute interval for mobile reduces wake-ups by 10x |

---

## Summary

This implementation ensures:
1. **Photos are saved locally in <100ms** (IndexedDB write)
2. **UI updates immediately** (user sees photo with "Pending" badge)
3. **Background sync is non-blocking** (fire-and-forget pattern)
4. **Mobile battery is preserved** (5-minute sync interval)
5. **Existing form data persistence remains unchanged** (already working correctly)
