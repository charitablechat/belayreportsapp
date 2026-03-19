

## Remove Form CMS Tab

Remove the Form CMS tab from the admin sidebar and its corresponding content panel.

### Changes

**1. `src/components/admin/AdminTabsSection.tsx`**
- Remove the `form-cms` entry from the `tabs` array (line 28)
- Remove the `Settings` icon import (no longer needed)

**2. `src/pages/SuperAdminDashboard.tsx`**
- Remove the `<TabsContent value="form-cms">` block containing `<FormCMSManager />`
- Remove the `FormCMSManager` import

The `FormCMSManager` component file and the `useFormConfiguration` hook will remain in the codebase but simply won't be referenced from the admin UI. The database tables (`form_sections`, `form_fields`, etc.) stay untouched.

