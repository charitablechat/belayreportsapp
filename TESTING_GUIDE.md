# 📋 Comprehensive Data Saving Test Plan

**Generated:** 2025-11-12  
**Current System Status:** ✅ Clean slate - 0 unsynced items, no conflicts, system healthy

---

## **TEST 1: Offline Creation & Sync** ⭐ Critical Path

**Steps:**
1. Press `Ctrl+Shift+O` to open OfflineSimulator
2. Toggle "Simulate Offline" → Banner should appear
3. Click "New Inspection" button
4. Fill in form:
   - Organization: "Test Offline Org"
   - Location: "Test Location"
   - Onsite Contact: "John Doe"
5. Click "Create Inspection (Offline)"

**✓ Verify:**
- Toast shows "Created offline - will sync when online"
- Dashboard shows new card with "Unsynced" badge
- Console logs: `[Offline Storage] Saved inspection offline`

**Steps (continued):**
6. Click on the inspection card to open it
7. Add at least 3 operating systems
8. Add at least 2 ziplines
9. Add at least 5 equipment items
10. Navigate back to dashboard

**✓ Verify:**
- All data persists after navigation
- "Unsynced" badge still visible

**Steps (continued):**
11. Toggle "Simulate Offline" to go back online
12. Click the prominent "Sync Now" button (should appear with badge showing "1")
13. Watch the progress modal

**✓ Verify:**
- Progress modal shows: "Syncing inspection 1 of 1..."
- Confetti animation on success
- "Unsynced" badge disappears
- Refresh page → data persists
- Check console: `[Sync Manager] Sync completed successfully`

**Expected Time:** 3-4 minutes

---

## **TEST 2: Concurrent Edits (Conflict Detection)** ⚠️ Edge Case

**Setup Required:** Open app in two browser tabs/windows

**Steps:**
1. Tab 1: Open inspection "Lighthouse CC"
2. Tab 2: Open same inspection "Lighthouse CC"
3. Tab 1: Change location to "Lake Tahoe North"
4. Tab 1: Click save
5. Tab 2: Change location to "Lake Tahoe South"
6. Tab 2: Click save (creates conflict)

**✓ Verify:**
- Toast notification: "Sync Conflict Detected"
- ConflictResolver dialog opens automatically
- Shows both versions side-by-side
- Can choose "Keep Local" or "Keep Remote"

**Steps (continued):**
7. Click "Keep Local Version"
8. Refresh both tabs

**✓ Verify:**
- Both tabs show the same data
- No conflict notification
- Check database for resolved conflict

**Expected Time:** 2-3 minutes

---

## **TEST 3: Photo Upload Under Load** 📸 Performance Test

**Steps:**
1. Go to OfflineSimulator → Toggle offline
2. Open any inspection
3. Scroll to Photos section
4. Click "Capture Photo" 10 times rapidly
5. For each photo, either:
   - Use camera (if available)
   - Or select a test image file

**✓ Verify (while offline):**
- All 10 photos appear in gallery
- Cloud badge shows "☁️ 10"
- Console: `[Offline Storage] Saved 10 photos offline`

**Steps (continued):**
6. Go back online (toggle simulator)
7. Open SyncControlPanel
8. Click "Sync Now"
9. Watch detailed progress

**✓ Verify:**
- Progress shows: "Uploading photos: 1 of 10..." → "2 of 10..." etc.
- No errors in error list
- All photos uploaded within 30 seconds
- Cloud badge disappears
- Photos accessible with URLs (click to view full size)

**Expected Time:** 5-6 minutes

---

## **TEST 4: Large Data Validation** 📊 Stress Test

**Steps:**
1. Create new inspection (online)
2. Add 50+ equipment items:
   - Use rapid data entry
   - Vary equipment types
   - Include pass/fail mix
3. Add 20+ ziplines
4. Add 10+ operating systems
5. Click "Save" or navigate away

**✓ Verify:**
- No validation errors
- Data saves within 3 seconds
- Console shows: `[Atomic Sync] Synced inspection with X items`
- Refresh page → all data persists
- Performance: No UI lag or freezing

**Steps (continued):**
6. Edit the same inspection
7. Change 10 random fields
8. Save again

**✓ Verify:**
- Incremental sync works (only changed data sent)
- No timeout errors
- Console: Check network tab for payload size

**Expected Time:** 8-10 minutes

---

## **TEST 5: Storage Quota Monitoring** 💾 Resource Test

**Steps:**
1. Open Chrome DevTools → Application → IndexedDB → inspectionDB
2. Note current size (should be < 5MB)
3. Create 20 new inspections rapidly with:
   - Each having 10+ equipment items
   - Each having 5+ photos
4. Monitor IndexedDB size in DevTools

**✓ Verify:**
- Size increases predictably
- No quota warnings in console
- Database operations remain fast (< 100ms)

**Steps (continued):**
5. Sync all inspections
6. Check if old synced data is cleaned up
7. Verify IndexedDB size decreases

**✓ Verify:**
- Synced inspections cleared from IndexedDB
- Only unsynced data remains
- Console: `[Cleanup] Removed X synced inspections`

**Expected Time:** 15 minutes

---

## 🚨 What to Watch For

**Red Flags:**
- `QuotaExceededError` in console
- `Failed to open IndexedDB` errors
- Network requests timing out (> 30s)
- Sync conflicts not resolving
- Photos failing to upload silently

**Performance Benchmarks:**
- Photo upload: < 3s per photo
- Inspection sync: < 2s per inspection
- IndexedDB queries: < 50ms
- UI responsiveness: No freezing

---

## 📊 Test Results Template

After each test, record:

```
TEST X: [Name]
✅ PASS / ❌ FAIL
Time: [X minutes]
Issues Found: [None / List issues]
Console Errors: [None / Copy errors]
Notes: [Any observations]
```

---

## 🎯 Success Criteria

All 5 tests must pass with:
- No data loss
- No unhandled errors
- Performance within benchmarks
- User experience smooth and intuitive

---

## 📝 Notes

- Run tests in order (1-5) as they build on each other
- Use Chrome DevTools console with "Preserve log" enabled
- Keep Network tab open to monitor requests
- Test on multiple browsers (Chrome, Firefox, Safari)
- Test on mobile devices for touch interactions

---

**Questions or issues during testing?** Open DevTools console and report any red error messages.
