

# Fix "Force Local Backup" Filename to Use Report Name + Date/Time

## Problem
Currently the backup filename is: `backup_inspection_Acme_Corp_a1b2c3d4_1712345678.zip`
User wants: `camp_oro_quay_4_10_2026_4_36.zip`

## Change
In `src/lib/local-backup-ledger.ts`, replace the filename construction on **3 lines** (ZIP download ~line 412, JSON fallback ~line 428) with a human-readable format:

```
{Organization}_{M}_{D}_{YYYY}_{H}_{MM}.{ext}
```

### Implementation
Add a small helper inside the file:

```typescript
function buildBackupFilename(org: string | undefined, ext: 'zip' | 'json'): string {
  const name = sanitizeFilename(org || 'report');
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  const hour = now.getHours();
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${name}_${month}_${day}_${year}_${hour}_${min}.${ext}`;
}
```

Then replace:
- Line 412: `link.download = buildBackupFilename(snapshot.parent?.organization, 'zip');`
- Line 428: `link.download = buildBackupFilename(snapshot.parent?.organization, 'json');`

Remove the now-unused `orgPart` variable (~line 360).

## File
- `src/lib/local-backup-ledger.ts` — 3 line changes + 1 helper function

