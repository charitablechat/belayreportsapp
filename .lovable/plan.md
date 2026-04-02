

## Fix Mobile Wrapping for All Super Admin Tables

### Problem
All admin tables render as standard HTML `<table>` on every screen size. On mobile, narrow columns force text to wrap vertically character-by-character, making the UI unusable (as shown in the screenshot).

### Approach
For each table section in `SuperAdminDashboard.tsx`, use a **responsive dual-layout pattern**:
- **Desktop/tablet** (`md:` and up): Keep existing `<Table>` with `overflow-x-auto`
- **Mobile** (below `md`): Render a stacked card list instead

This follows the existing project convention documented in the responsive text handling memory.

### Tables to Convert (all in `SuperAdminDashboard.tsx`)

| Tab / Section | Columns | Priority |
|---|---|---|
| User Management | Email, Name, Status, Roles, Last Sign In, Actions | High (screenshot) |
| Organizations | Org, Inspections, Trainings, Daily, Last Inspection, Created, Actions | High |
| Inspections | Org, Location, Status, Date, Created, Inspector | Medium |
| Trainings | Org, Trainer, Status, Start, End, Created | Medium |
| Daily Assessments | Org, Site, Inspector, Status, Date, Created | Medium |
| Notifications | Type, Title, Status, Sent | Low |
| Stat card dialogs (5) | Various | Low |

### Implementation Detail

For each table section, wrap the existing `<Table>` in `<div className="hidden md:block overflow-x-auto">` and add a sibling `<div className="md:hidden space-y-3">` containing mapped card items. Each card uses the existing `Card` component with key fields as stacked rows.

**Example card layout for User Management:**
```text
┌─────────────────────────────┐
│ john@example.com            │
│ John Doe                    │
│ [Active]  [inspector]       │
│ Last sign in: Mar 23, 2026  │
│ [⚡] [🛡] [✏] [🗑]          │
└─────────────────────────────┘
```

### Files Changed

| File | Change |
|---|---|
| `src/pages/SuperAdminDashboard.tsx` | Add mobile card layouts alongside each table; wrap tables in `hidden md:block` |

No new files or dependencies needed. Single file change, pattern repeated for each tab.

