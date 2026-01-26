

## Add Inline Descriptions to Admin Dashboard Tabs

This plan adds a small description text to the right of each tab name, providing context about what each section does.

---

### Design

Each tab will display the name on the left and a muted description on the right, all in a single row:

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Organizations         Manage client facilities and companies       │
├─────────────────────────────────────────────────────────────────────┤
│  User Management       Create, edit, and manage user accounts       │
├─────────────────────────────────────────────────────────────────────┤
│  Inspections           View and manage all inspection reports       │
├─────────────────────────────────────────────────────────────────────┤
│  Training Reports      View and manage training documentation       │
├─────────────────────────────────────────────────────────────────────┤
│  Daily Assessments     View daily operational assessments           │
├─────────────────────────────────────────────────────────────────────┤
│  Form CMS              Customize form fields and options            │
├─────────────────────────────────────────────────────────────────────┤
│  Notifications         View notification history and logs           │
├─────────────────────────────────────────────────────────────────────┤
│  Conflicts             Resolve data synchronization conflicts       │
├─────────────────────────────────────────────────────────────────────┤
│  Data Recovery         Recover deleted or corrupted data            │
├─────────────────────────────────────────────────────────────────────┤
│  Report Ownership      Transfer report ownership between users      │
├─────────────────────────────────────────────────────────────────────┤
│  Maintenance           System maintenance and cleanup tools         │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Tab Descriptions

| Tab | Description |
|-----|-------------|
| Organizations | Manage client facilities and companies |
| User Management | Create, edit, and manage user accounts |
| Inspections | View and manage all inspection reports |
| Training Reports | View and manage training documentation |
| Daily Assessments | View daily operational assessments |
| Form CMS | Customize form fields and options |
| Notifications | View notification history and logs |
| Conflicts | Resolve data synchronization conflicts |
| Data Recovery | Recover deleted or corrupted data |
| Report Ownership | Transfer report ownership between users |
| Maintenance | System maintenance and cleanup tools |

---

### Implementation

**File to Modify:** `src/pages/SuperAdminDashboard.tsx`

1. Update each `TabsTrigger` to use a flex row layout with `justify-between`:
   - Tab name on the left (regular font)
   - Description on the right (smaller, muted text)

2. Each tab changes from:
```tsx
<TabsTrigger value="organizations" className="justify-start">
  Organizations
</TabsTrigger>
```

To:
```tsx
<TabsTrigger value="organizations" className="justify-between w-full">
  <span>Organizations</span>
  <span className="text-xs text-muted-foreground font-normal ml-4">
    Manage client facilities and companies
  </span>
</TabsTrigger>
```

---

### Styling Details

- Tab name: Default font weight, left-aligned
- Description: `text-xs` size, `text-muted-foreground` color, `font-normal` weight
- Layout: `justify-between` with `w-full` to spread name and description apart
- Spacing: `ml-4` on description for minimum gap between name and description

