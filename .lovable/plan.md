

# Complete Super Admin Visibility Fix (v2.4.1)

## Problem Summary

As a Super Admin viewing another user's "Uranus" inspection:

| What You See | What's In Database | Issue |
|--------------|-------------------|-------|
| Empty tables | 1 Zipline, 2 Systems, 6 Standards, 1 Summary | **RLS blocks SELECT** |
| No photos | 3 photos uploaded | **RLS blocks SELECT on table + storage** |

## Root Cause: Missing SELECT Policies

### Database Tables Missing Super Admin SELECT

| Table | Has UPDATE Policy | Has SELECT Policy | Fix Needed |
|-------|-------------------|-------------------|------------|
| `inspection_systems` | ✅ | ❌ | Add SELECT |
| `inspection_ziplines` | ✅ | ❌ | Add SELECT |
| `inspection_equipment` | ✅ | ❌ | Add SELECT |
| `inspection_standards` | ✅ | ❌ | Add SELECT |
| `inspection_summary` | ✅ | ❌ | Add SELECT |
| `inspection_photos` | ✅ | ❌ | **Add SELECT** |
| `daily_assessment_*` (6 tables) | ✅ | ❌ | Add SELECT |

### Storage Bucket Missing Super Admin Access

The `inspection-photos` storage bucket only allows users to view photos in their **own folder** (where folder = user ID). Super Admins cannot view other users' photos!

---

## Solution: Add 13 RLS Policies

### 1. Inspection Child Tables (6 policies)

```sql
-- Systems
CREATE POLICY "Super admins can view all inspection systems"
  ON public.inspection_systems FOR SELECT
  USING (is_super_admin());

-- Ziplines  
CREATE POLICY "Super admins can view all inspection ziplines"
  ON public.inspection_ziplines FOR SELECT
  USING (is_super_admin());

-- Equipment
CREATE POLICY "Super admins can view all inspection equipment"
  ON public.inspection_equipment FOR SELECT
  USING (is_super_admin());

-- Standards
CREATE POLICY "Super admins can view all inspection standards"
  ON public.inspection_standards FOR SELECT
  USING (is_super_admin());

-- Summary
CREATE POLICY "Super admins can view all inspection summaries"
  ON public.inspection_summary FOR SELECT
  USING (is_super_admin());

-- Photos (database metadata)
CREATE POLICY "Super admins can view all inspection photos"
  ON public.inspection_photos FOR SELECT
  USING (is_super_admin());
```

### 2. Daily Assessment Child Tables (6 policies)

```sql
CREATE POLICY "Super admins can view all beginning of day checks"
  ON public.daily_assessment_beginning_of_day FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all end of day checks"
  ON public.daily_assessment_end_of_day FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all environment checks"
  ON public.daily_assessment_environment_checks FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all equipment checks"
  ON public.daily_assessment_equipment_checks FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all daily assessment operating systems"
  ON public.daily_assessment_operating_systems FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all structure checks"
  ON public.daily_assessment_structure_checks FOR SELECT
  USING (is_super_admin());
```

### 3. Storage Bucket Policy (1 policy)

```sql
CREATE POLICY "Super admins can view all inspection photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspection-photos' 
    AND is_super_admin()
  );
```

---

## Files to Update

| File | Change |
|------|--------|
| Database migration | Add 13 RLS policies |
| `vite.config.ts` | Bump version to 2.4.1 |

---

## Expected Result After Fix

When you open the "Uranus" inspection:

| Component | Before | After |
|-----------|--------|-------|
| Ziplines table | Empty | Shows "Zip Line Right" (50,000ft GAC) |
| Operating Systems | Empty | Shows 2 systems |
| Standards | Empty | Shows 6 standards |
| Summary | Empty | Shows critical actions |
| **Photos** | **Not visible** | **3 photos visible** |

---

## Testing Checklist

1. Open Uranus inspection as Super Admin
2. Verify all table data appears (Ziplines, Systems, Standards)
3. Verify **3 photos** are visible in the gallery
4. Test a Daily Assessment report from another user
5. Confirm regular users can still only see their own reports

