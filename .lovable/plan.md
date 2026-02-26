

## Convert Data Recovery Panels to Tabbed Interface

### What Changes
Replace the vertically stacked panels in the Data Recovery Tool with a clean tabbed layout, matching the professional style used throughout the app (similar to the inspection form's Systems/Equipment/Criteria/Summary tabs).

### Current Layout (stacked)
All five panels render one after another in a long scrollable list:
1. Local Snapshots
2. Cloud Snapshots
3. All User Snapshots
4. Admin Edit History
5. IndexedDB Recovery
6. *(Below)* Deleted Records Recovery

### New Layout (tabbed)

```text
+-----------------------------------------------------------+
| Local | Cloud | All Users | Edit History | IndexedDB | Deleted |
+-----------------------------------------------------------+
|                                                           |
|  [Active tab content renders here]                        |
|                                                           |
+-----------------------------------------------------------+
```

On mobile, the tab bar will scroll horizontally to fit all labels cleanly.

### Technical Details

**File: `src/components/admin/DataRecoveryTool.tsx`**
- Wrap the `DataRecoveryTool` component's content in a `<Tabs>` component with `defaultValue="local"`
- Replace the stacked `<div className="space-y-6">` with a `<TabsList>` and individual `<TabsContent>` wrappers around each panel
- Each tab gets a short, clean label: Local, Cloud, All Users, Edit History, IndexedDB
- Style the TabsList with the same glassmorphic treatment used elsewhere (`backdrop-blur-md bg-white/5 border border-white/10`)

**File: `src/pages/SuperAdminDashboard.tsx`** (lines 1132-1138)
- Move `DeletedRecordsRecovery` inside the `DataRecoveryTool` as a 6th tab called "Deleted Records" instead of rendering it separately above
- Remove the separator div and "Local Browser Data Recovery" heading since the tabs are self-explanatory
- The tab labels on mobile will be compact (e.g., "Local", "Cloud", "Users", "Edits", "IDB", "Deleted")

### What Does NOT Change
- All panel internals remain identical -- only the wrapper changes
- The `UserDataRecoverySheet` (regular user view) continues to stack panels since it only shows two
- No database or logic changes

