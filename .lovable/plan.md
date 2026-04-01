

## Remove Maintenance Tab from Admin Dashboard

### Changes

**1. `src/components/admin/AdminTabsSection.tsx`**
- Remove the `maintenance` entry from the `tabs` array (the one with `icon: Wrench, title: "Maintenance"`)
- Remove the `Wrench` import from lucide-react

**2. `src/pages/SuperAdminDashboard.tsx`**
- Remove the entire `<TabsContent value="maintenance">` block (lines 1245–1307)
- Remove related state/handler (`isCleaningUp`, `handleCleanupDuplicates`) if they're only used by the maintenance tab
- Clean up any unused imports (`Image`, `Wrench`, `Loader2` if no longer referenced elsewhere)

