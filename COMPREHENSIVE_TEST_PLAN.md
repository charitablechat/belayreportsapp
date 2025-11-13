# 🧪 Comprehensive Test Plan - Rope Works Inspection App

**Generated:** 2025-11-13  
**Purpose:** End-to-end testing of all production features  
**Environment:** Production-ready testing on https://rwreports.com

---

## 📋 Test Execution Checklist

- [ ] **Test 1:** Authentication & Session Management
- [ ] **Test 2:** Role-Based Access Control
- [ ] **Test 3:** Inspection Lifecycle (Online)
- [ ] **Test 4:** Offline Mode & Synchronization
- [ ] **Test 5:** Photo Management
- [ ] **Test 6:** Conflict Resolution
- [ ] **Test 7:** Cross-Device Synchronization
- [ ] **Test 8:** Form Validation & Data Integrity
- [ ] **Test 9:** Mobile Responsiveness
- [ ] **Test 10:** Performance Under Load

---

## **TEST 1: Authentication & Session Management** 🔐

### **Objective:** Verify secure authentication flow and session persistence

### **Test Cases:**

#### **1.1 New User Signup**
**Steps:**
1. Navigate to `/` (landing page)
2. Click "Create Account" / "Sign Up"
3. Enter email: `inspector-test@example.com`
4. Enter password: `SecurePass123!`
5. Submit form

**✓ Verify:**
- User receives confirmation (or auto-login if email confirmation disabled)
- Redirected to `/dashboard` automatically
- User profile created in database
- Session token stored in localStorage
- No console errors

**Expected Time:** 2 minutes

---

#### **1.2 Existing User Login**
**Steps:**
1. Navigate to `/`
2. Enter existing credentials
3. Click "Sign In"

**✓ Verify:**
- Successful login
- Redirect to `/dashboard`
- User data loaded correctly
- Session persists across page refreshes
- Logout button visible

**Expected Time:** 1 minute

---

#### **1.3 Session Persistence**
**Steps:**
1. Log in successfully
2. Refresh the page (F5)
3. Close and reopen browser tab
4. Navigate directly to `/dashboard`

**✓ Verify:**
- User remains logged in after refresh
- No redirect to login page
- Data persists across page reloads
- Session expires after reasonable timeout (check Supabase auth settings)

**Expected Time:** 2 minutes

---

#### **1.4 Logout**
**Steps:**
1. Click logout button
2. Attempt to navigate to `/dashboard`

**✓ Verify:**
- User redirected to `/`
- Session cleared from localStorage
- Protected routes inaccessible
- Must log in again to access dashboard

**Expected Time:** 1 minute

---

#### **1.5 Invalid Credentials**
**Steps:**
1. Enter invalid email/password
2. Submit form

**✓ Verify:**
- Error toast displayed: "Invalid credentials"
- User remains on login page
- No session created
- Form validation works (email format, password length)

**Expected Time:** 1 minute

---

## **TEST 2: Role-Based Access Control** 👥

### **Objective:** Verify super_admin role permissions work correctly

### **Pre-requisite Setup:**
1. Create test user A (regular user)
2. Create test user B (super_admin)
   - Add role via database: `INSERT INTO user_roles (user_id, role) VALUES ('<user_b_id>', 'super_admin')`

---

#### **2.1 Super Admin Access**
**Steps:**
1. Log in as User B (super_admin)
2. Navigate to `/super-admin` or admin dashboard

**✓ Verify:**
- Access granted to admin dashboard
- Can view all organizations' inspections
- Admin-specific UI elements visible
- No "Access Denied" errors

**Expected Time:** 2 minutes

---

#### **2.2 Regular User Restrictions**
**Steps:**
1. Log in as User A (regular user)
2. Attempt to navigate to `/super-admin`

**✓ Verify:**
- Access denied
- Redirected to `/dashboard`
- Toast notification: "Access Denied - You don't have permission"
- Admin routes protected

**Expected Time:** 2 minutes

---

#### **2.3 Role Check on Protected Actions**
**Steps:**
1. Log in as regular user
2. Try to perform admin-only actions (if any exist in UI)

**✓ Verify:**
- Actions blocked or hidden
- Proper error messages shown
- No data leakage

**Expected Time:** 3 minutes

---

## **TEST 3: Inspection Lifecycle (Online)** 📝

### **Objective:** Test full inspection creation, editing, and completion flow

---

#### **3.1 Create New Inspection**
**Steps:**
1. Log in and navigate to `/dashboard`
2. Click "New Inspection" button
3. Fill in form:
   - Organization: "Acme Adventure Park"
   - Location: "North Course"
   - Onsite Contact: "Jane Smith"
   - Previous Inspector: "John Doe"
   - Previous Date: Select date
4. Click "Capture Location" (optional)
5. Click "Create Inspection"

**✓ Verify:**
- Success toast: "Inspection created successfully"
- Redirected to `/inspection/:id`
- Inspection appears in dashboard list
- Data saved to database
- Location captured if button clicked

**Expected Time:** 3 minutes

---

#### **3.2 Edit Inspection Details**
**Steps:**
1. Open existing inspection
2. Navigate to "Details" tab
3. Update organization name to "Updated Park Name"
4. Add/modify operating systems (add 3 systems)
5. Add ziplines (add 2 ziplines)
6. Wait 3 seconds for auto-save

**✓ Verify:**
- "Saving..." indicator appears
- "All changes saved" toast displayed
- Changes persist after page refresh
- No validation errors
- `updated_at` timestamp updated in database

**Expected Time:** 4 minutes

---

#### **3.3 Add Equipment Items**
**Steps:**
1. Navigate to "Equipment" tab
2. Click "Add Harnesses"
3. Fill in equipment details:
   - Equipment Type: "Full Body Harness"
   - Manufacturer: "Petzl"
   - Model: "AVAO BOD"
   - Serial: "ABC123"
   - Result: "Pass"
4. Add 10 more equipment items with varying results
5. Leave one equipment row with empty `equipment_type`

**✓ Verify:**
- All equipment rows save correctly
- Row with empty `equipment_type` shows red border/ring
- Auto-save succeeds without validation error
- Equipment count updates
- Can edit existing equipment

**Expected Time:** 5 minutes

---

#### **3.4 Add Standards Checklist**
**Steps:**
1. Navigate to "Standards" tab
2. Review pre-populated standards
3. Change results for 5-10 standards
4. Add comments to 2-3 standards

**✓ Verify:**
- Results update immediately
- Comments save correctly
- Auto-save works
- Standards persist after refresh

**Expected Time:** 3 minutes

---

#### **3.5 Add Summary**
**Steps:**
1. Navigate to "Summary" tab
2. Fill in:
   - Repairs Performed: "Replaced 2 carabiners"
   - Critical Actions: "None"
   - Future Considerations: "Monitor cable wear"
   - Next Inspection Date: Select future date
3. Wait for auto-save

**✓ Verify:**
- Summary saves successfully
- Date picker works correctly
- Text fields auto-save
- Data persists

**Expected Time:** 3 minutes

---

#### **3.6 Complete Inspection (Validation)**
**Steps:**
1. Attempt to click "Complete" with incomplete equipment (empty `equipment_type`)
2. Fill in missing equipment type
3. Click "Complete" again

**✓ Verify:**
- First attempt shows error toast: "Cannot complete inspection - Equipment type is required"
- After fixing, completion succeeds
- Status changes to "completed"
- Inspection marked complete in dashboard
- Completion timestamp recorded

**Expected Time:** 3 minutes

---

#### **3.7 View Completed Inspection**
**Steps:**
1. Navigate back to dashboard
2. Click on completed inspection

**✓ Verify:**
- All data displays correctly
- Edit mode disabled or restricted
- Status badge shows "Completed"
- Can view but not modify (depending on business rules)

**Expected Time:** 2 minutes

---

## **TEST 4: Offline Mode & Synchronization** ✈️

### **Objective:** Test offline capabilities and sync behavior

---

#### **4.1 Enable Offline Mode**
**Steps:**
1. Press `Ctrl+Shift+O` to open OfflineSimulator
2. Toggle "Simulate Offline"

**✓ Verify:**
- Offline banner appears at top
- Network status indicator shows offline
- UI adjusts for offline mode

**Expected Time:** 1 minute

---

#### **4.2 Create Inspection Offline**
**Steps:**
1. While offline, click "New Inspection"
2. Fill in form with test data
3. Click "Create Inspection (Offline)"

**✓ Verify:**
- Toast: "Created offline - will sync when online"
- Inspection card shows "Unsynced" badge
- Data saved to IndexedDB
- Console log: `[Offline Storage] Saved inspection offline`
- Can open and edit the offline inspection

**Expected Time:** 3 minutes

---

#### **4.3 Edit Offline Inspection**
**Steps:**
1. Open offline inspection
2. Add 5 equipment items
3. Add 2 operating systems
4. Navigate away and back

**✓ Verify:**
- All changes persist in IndexedDB
- "Unsynced" badge remains
- Auto-save works offline
- Data not lost

**Expected Time:** 4 minutes

---

#### **4.4 Sync When Back Online**
**Steps:**
1. Toggle "Simulate Offline" to go back online
2. Observe sync status indicator
3. Click "Sync Now" button (should show badge with "1")
4. Watch sync progress modal

**✓ Verify:**
- Progress modal shows: "Syncing inspection 1 of 1..."
- Confetti animation on success
- "Unsynced" badge disappears
- Inspection now in Supabase database
- Can view from different device/browser

**Expected Time:** 2 minutes

---

#### **4.5 Automatic Background Sync**
**Steps:**
1. Create another offline inspection
2. Go back online (don't click sync button)
3. Wait 30 seconds

**✓ Verify:**
- Automatic sync triggers
- Background sync notification appears
- Unsynced count decreases
- Service worker handles sync

**Expected Time:** 2 minutes

---

## **TEST 5: Photo Management** 📸

### **Objective:** Test photo capture, upload, and offline storage

---

#### **5.1 Upload Photos (Online)**
**Steps:**
1. Open inspection
2. Navigate to Photos section
3. Click "Capture Photo"
4. Select/capture 3 photos
5. Wait for upload

**✓ Verify:**
- Upload progress visible
- Photos appear in gallery
- Each photo shows "Synced" status
- Photos stored in Supabase Storage bucket `inspection-photos`
- Can view full-size photo on click

**Expected Time:** 3 minutes

---

#### **5.2 Capture Photos (Offline)**
**Steps:**
1. Go offline (`Ctrl+Shift+O`)
2. Open inspection
3. Capture 5 photos
4. Check photo gallery

**✓ Verify:**
- Photos save to IndexedDB
- Each photo shows "Pending" status
- Cloud badge shows "☁️ 5"
- Console: `[Offline Storage] Saved 5 photos offline`
- Photos visible in gallery with base64 data

**Expected Time:** 4 minutes

---

#### **5.3 Sync Photos When Online**
**Steps:**
1. Go back online
2. Open SyncControlPanel
3. Click "Sync Now"
4. Watch photo upload progress

**✓ Verify:**
- Progress: "Uploading photos: 1 of 5..." → "2 of 5..." etc.
- All 5 photos upload successfully
- Status changes from "Pending" to "Synced"
- Cloud badge disappears
- Photos now have Supabase URLs

**Expected Time:** 3 minutes

---

#### **5.4 Delete Photo**
**Steps:**
1. Hover over a photo
2. Click delete button (X icon)
3. Confirm deletion

**✓ Verify:**
- Photo removed from gallery
- Deleted from Supabase Storage
- Deleted from IndexedDB
- Gallery updates immediately

**Expected Time:** 1 minute

---

## **TEST 6: Conflict Resolution** ⚠️

### **Objective:** Test concurrent editing and conflict detection

### **Setup:** Open app in two browser tabs/windows

---

#### **6.1 Create Edit Conflict**
**Steps:**
1. **Tab 1:** Open inspection "Test Course A"
2. **Tab 2:** Open same inspection "Test Course A"
3. **Tab 1:** Change location to "North Side"
4. **Tab 1:** Click save (or wait for auto-save)
5. **Tab 2:** Change location to "South Side"
6. **Tab 2:** Click save

**✓ Verify:**
- Conflict detected
- Toast: "Sync Conflict Detected"
- ConflictResolver dialog opens
- Shows both versions side-by-side:
  - Local: "South Side"
  - Remote: "North Side"

**Expected Time:** 3 minutes

---

#### **6.2 Resolve Conflict (Keep Local)**
**Steps:**
1. In conflict dialog, click "Keep Local Version"
2. Refresh both tabs

**✓ Verify:**
- Both tabs show "South Side"
- Conflict marked as resolved in database
- No more conflict notifications

**Expected Time:** 2 minutes

---

#### **6.3 Resolve Conflict (Keep Remote)**
**Steps:**
1. Create another conflict (repeat 6.1)
2. Click "Keep Remote Version"
3. Refresh both tabs

**✓ Verify:**
- Both tabs show remote version
- Local changes discarded
- Conflict resolved

**Expected Time:** 2 minutes

---

## **TEST 7: Cross-Device Synchronization** 🔄

### **Objective:** Verify data syncs across multiple devices

### **Setup:** Use 2 different devices/browsers (Desktop + Mobile, or Chrome + Firefox)

---

#### **7.1 Create on Device A, View on Device B**
**Steps:**
1. **Device A:** Log in as same user
2. **Device A:** Create new inspection
3. **Device B:** Log in as same user
4. **Device B:** Refresh dashboard

**✓ Verify:**
- Inspection appears on Device B
- All data matches Device A
- Photos visible on both devices

**Expected Time:** 4 minutes

---

#### **7.2 Edit on Device B, Verify on Device A**
**Steps:**
1. **Device B:** Edit inspection, add equipment
2. **Device A:** Refresh page

**✓ Verify:**
- Changes from Device B visible on Device A
- No data loss
- Sync indicator updates

**Expected Time:** 3 minutes

---

## **TEST 8: Form Validation & Data Integrity** ✅

### **Objective:** Test validation rules prevent invalid data

---

#### **8.1 Required Field Validation (New Inspection)**
**Steps:**
1. Click "New Inspection"
2. Leave organization field empty
3. Click "Create Inspection"

**✓ Verify:**
- Error toast or inline error
- Form submission blocked
- Field highlighted as invalid

**Expected Time:** 2 minutes

---

#### **8.2 Equipment Type Validation**
**Steps:**
1. Open inspection
2. Add equipment row
3. Leave `equipment_type` empty
4. Try to complete inspection

**✓ Verify:**
- Red border/ring on empty field
- Toast: "Cannot complete inspection - Equipment type is required"
- Completion blocked
- Can still save as draft

**Expected Time:** 2 minutes

---

#### **8.3 Date Validation**
**Steps:**
1. Set "Next Inspection Date" to a past date
2. Try to save/complete

**✓ Verify:**
- Validation error if business rules require future date
- Or saves successfully if past dates allowed
- Consistent behavior

**Expected Time:** 2 minutes

---

## **TEST 9: Mobile Responsiveness** 📱

### **Objective:** Verify app works on mobile devices

### **Test on:** Physical mobile device or browser DevTools mobile emulation (iPhone, Android)

---

#### **9.1 Mobile Navigation**
**Steps:**
1. Open app on mobile device
2. Navigate through all pages
3. Test hamburger menu (if exists)
4. Scroll through forms

**✓ Verify:**
- UI responsive and readable
- No horizontal scrolling
- Touch targets at least 44x44px
- Forms accessible and usable

**Expected Time:** 5 minutes

---

#### **9.2 Mobile Photo Capture**
**Steps:**
1. Open inspection on mobile
2. Click "Capture Photo"
3. Use device camera

**✓ Verify:**
- Camera launches correctly
- Photo captured and uploaded
- Image quality acceptable
- No crashes

**Expected Time:** 3 minutes

---

#### **9.3 Mobile Offline Mode**
**Steps:**
1. Enable airplane mode on device
2. Create/edit inspection
3. Re-enable connectivity
4. Verify sync

**✓ Verify:**
- Offline banner appears
- Data saves locally
- Syncs when online
- No data loss

**Expected Time:** 5 minutes

---

## **TEST 10: Performance Under Load** ⚡

### **Objective:** Test app performance with realistic data volume

---

#### **10.1 Large Equipment List**
**Steps:**
1. Add 100+ equipment items to single inspection
2. Scroll through list
3. Edit random items
4. Save inspection

**✓ Verify:**
- UI remains responsive (< 2s lag)
- No browser freeze
- Save completes within 5 seconds
- Database handles large payload

**Expected Time:** 10 minutes

---

#### **10.2 Multiple Photos**
**Steps:**
1. Upload 20+ photos to single inspection
2. Navigate to Photos section
3. Scroll through gallery

**✓ Verify:**
- Gallery loads smoothly
- Lazy loading works (if implemented)
- Memory usage acceptable (< 500MB)
- No crashes

**Expected Time:** 8 minutes

---

#### **10.3 Dashboard with Many Inspections**
**Steps:**
1. Create 50+ inspections (or use seed data)
2. Load dashboard
3. Scroll through list
4. Search/filter inspections

**✓ Verify:**
- Dashboard loads within 3 seconds
- Scrolling smooth
- Pagination or infinite scroll works
- Search/filter responsive

**Expected Time:** 10 minutes

---

## 🚨 **Common Issues to Watch For**

### **Authentication:**
- Session not persisting after refresh
- Logout not clearing all data
- Redirect loops

### **Offline Sync:**
- `QuotaExceededError` in IndexedDB
- Sync conflicts not resolving
- Data duplication after sync

### **Photos:**
- Failed uploads with no error message
- Photos not displaying after sync
- Memory leaks with large images

### **Validation:**
- Validation too strict (blocks legitimate saves)
- Validation too lenient (allows invalid data)
- Inconsistent error messages

### **Performance:**
- Slow auto-save (> 3s)
- UI freezing with large data sets
- Network timeout errors

---

## 📊 **Test Results Template**

After each test, record results:

```
TEST X.Y: [Test Name]
✅ PASS / ❌ FAIL
Browser: [Chrome/Firefox/Safari/Mobile]
Time: [X minutes]
Issues Found: [None / List issues with severity]
Console Errors: [None / Copy errors]
Screenshots: [Attach if relevant]
Notes: [Any observations]
```

---

## 🎯 **Success Criteria**

**All tests must pass with:**
- ✅ No data loss across any scenario
- ✅ No unhandled errors in console
- ✅ Performance within acceptable benchmarks
- ✅ Security: No unauthorized access
- ✅ Mobile: Fully functional on iOS/Android
- ✅ Offline: Seamless offline/online transitions

---

## 📝 **Post-Testing Actions**

1. **Document All Bugs:** Create issues for any failures
2. **Performance Report:** Note any slowdowns or bottlenecks
3. **User Experience Notes:** Identify UX improvements
4. **Security Review:** Flag any access control issues
5. **Retest After Fixes:** Verify all bugs resolved

---

## 🔗 **Testing Resources**

- **Chrome DevTools:** Network throttling, mobile emulation
- **React DevTools:** Component inspection
- **Supabase Dashboard:** Database verification
- **Browser Console:** Error tracking (Preserve log enabled)

---

**Questions during testing?** Check console logs and report red error messages immediately.

**Estimated Total Testing Time:** 4-6 hours for complete test suite