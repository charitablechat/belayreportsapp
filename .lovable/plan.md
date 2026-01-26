

## Add Icons and Closer Descriptions to Admin Dashboard Tabs

This plan adds icons to the left of each tab name and repositions the descriptions closer to the tab names for better visual grouping.

---

### Design

Each tab will display an icon, the name, and a muted description grouped together:

```text
┌──────────────────────────────────────────────────────────────────────┐
│  🏢  Organizations · Manage client facilities and companies          │
├──────────────────────────────────────────────────────────────────────┤
│  👥  User Management · Create, edit, and manage user accounts        │
├──────────────────────────────────────────────────────────────────────┤
│  📋  Inspections · View and manage all inspection reports            │
├──────────────────────────────────────────────────────────────────────┤
│  🎓  Training Reports · View and manage training documentation       │
├──────────────────────────────────────────────────────────────────────┤
│  ✅  Daily Assessments · View daily operational assessments          │
├──────────────────────────────────────────────────────────────────────┤
│  ⚙️  Form CMS · Customize form fields and options                    │
├──────────────────────────────────────────────────────────────────────┤
│  🔔  Notifications · View notification history and logs              │
├──────────────────────────────────────────────────────────────────────┤
│  ⚠️  Conflicts · Resolve data synchronization conflicts              │
├──────────────────────────────────────────────────────────────────────┤
│  🔄  Data Recovery · Recover deleted or corrupted data               │
├──────────────────────────────────────────────────────────────────────┤
│  👤  Report Ownership · Transfer report ownership between users      │
├──────────────────────────────────────────────────────────────────────┤
│  🔧  Maintenance · System maintenance and cleanup tools              │
└──────────────────────────────────────────────────────────────────────┘
```

---

### Icon Assignments

| Tab | Icon | Reasoning |
|-----|------|-----------|
| Organizations | `Building2` | Already imported, represents companies/facilities |
| User Management | `Users` | Already imported, represents user accounts |
| Inspections | `ClipboardList` | Already imported, represents inspection reports |
| Training Reports | `GraduationCap` | Already imported, represents training/education |
| Daily Assessments | `ClipboardCheck` | Already imported, represents daily checklists |
| Form CMS | `Settings` | New import needed, represents configuration |
| Notifications | `Bell` | Already imported, represents alerts/notifications |
| Conflicts | `AlertTriangle` | Already imported, represents warnings/issues |
| Data Recovery | `RotateCcw` | New import needed, represents recovery/restore |
| Report Ownership | `UserCog` | New import needed, represents user administration |
| Maintenance | `Wrench` | Already imported, represents maintenance tools |

---

### Implementation

**File to Modify:** `src/pages/SuperAdminDashboard.tsx`

1. **Update lucide-react imports (line 11):**
   - Add: `Settings`, `RotateCcw`, `UserCog`

2. **Update each TabsTrigger (lines 722-765):**
   - Change layout from `justify-between` to `justify-start` for left alignment
   - Add icon before the tab name
   - Use a separator (dash or middot) between name and description
   - Group elements closer together with consistent spacing

---

### Code Structure

Each tab will change from:
```tsx
<TabsTrigger value="organizations" className="justify-between w-full">
  <span>Organizations</span>
  <span className="text-xs text-muted-foreground font-normal ml-4">
    Manage client facilities and companies
  </span>
</TabsTrigger>
```

To:
```tsx
<TabsTrigger value="organizations" className="justify-start gap-3 w-full">
  <Building2 className="h-4 w-4 shrink-0" />
  <span>Organizations</span>
  <span className="text-xs text-muted-foreground font-normal">
    — Manage client facilities and companies
  </span>
</TabsTrigger>
```

---

### Styling Details

- **Icon**: `h-4 w-4 shrink-0` - consistent size, prevents shrinking
- **Tab name**: Default font weight
- **Separator**: Em dash (—) for visual separation
- **Description**: `text-xs text-muted-foreground font-normal` - smaller, muted
- **Layout**: `justify-start gap-3` - left-aligned with consistent spacing between elements

