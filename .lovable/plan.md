

## Remove Organizations Column from User Management Table

A straightforward change to remove the "Organizations" column from the User Management table in the Super Admin Dashboard.

---

### What Will Change

The User Management table currently has 6 columns:
1. Email
2. Name
3. Organizations ← **Will be removed**
4. Roles
5. Last Sign In
6. Actions

After the change, the table will have 5 columns:
1. Email
2. Name
3. Roles
4. Last Sign In
5. Actions

---

### File to Modify

**`src/pages/SuperAdminDashboard.tsx`**

1. Remove the Organizations table header (line 852):
   ```diff
   - <TableHead>Organizations</TableHead>
   ```

2. Remove the Organizations table cell content (lines 863-875):
   ```diff
   - <TableCell>
   -   {user.organizations?.length > 0 ? (
   -     <div className="flex flex-wrap gap-1">
   -       {user.organizations.map((org: any, idx: number) => (
   -         <Badge key={idx} variant="secondary" className="text-xs">
   -           {org.name}
   -         </Badge>
   -       ))}
   -     </div>
   -   ) : (
   -     <span className="text-muted-foreground text-sm">No organizations</span>
   -   )}
   - </TableCell>
   ```

---

### Result

The User Management table will display users with just their Email, Name, Roles, Last Sign In, and Actions - the Organizations column will no longer appear.

