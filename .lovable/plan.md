

# Fix Corrupted Records and Remove Ghost Duplicates

## Impact Assessment

**No report content will be changed or removed.** Here is exactly what happens:

### Production Year Corrections (3 records)
These equipment rows currently display nonsensical year values (7012024, 5292024). They will be corrected to `2024` -- the actual year embedded in the corrupted MMDDYYYY format.

| ID | Equipment Type | Current Year | Corrected Year |
|----|---------------|-------------|----------------|
| `75835ff6-...` | Dynamic | 7012024 | 2024 |
| `7bdb315f-...` | Dynamic | 5292024 | 2024 |
| `9d9da640-...` | Dynamic | 5292024 | 2024 |

### Negative Quantity Fix (1 record)
| ID | Equipment Type | Current Qty | Corrected Qty |
|----|---------------|------------|---------------|
| `1cac4962-...` | Headwall Seat Harness | -1 | 1 |

### Ghost Duplicate Removal (2 records)
These are empty placeholder rows in `inspection_systems` with no name and no comments -- they are invisible in the report and carry no data. Deleting them removes clutter only.

| ID | System Name | Name | Comments |
|----|------------|------|----------|
| `e2d22e89-...` | Spotted/Low | (empty) | (empty) |
| `1bf6a534-...` | Spotted/Low | (empty) | (empty) |

The 9 real "Spotted/Low" systems (Whale Watch, Spider Web, Low Wall, etc.) with actual names and comments are **untouched**.

---

## SQL Migration

```sql
-- Fix 3 corrupted production_year values (MMDDYYYY -> YYYY)
UPDATE public.inspection_equipment
SET production_year = 2024
WHERE id IN (
  '75835ff6-7427-45a5-b274-0e8977a6c07b',
  '7bdb315f-01e7-4467-b062-f3faae986e60',
  '9d9da640-843a-41ca-a8eb-a9ef504a058a'
);

-- Fix negative quantity
UPDATE public.inspection_equipment
SET quantity = 1
WHERE id = '1cac4962-0d8a-484c-a75e-3bc719d2d9bd';

-- Remove 2 ghost placeholder rows (no name, no comments)
DELETE FROM public.inspection_systems
WHERE id IN (
  'e2d22e89-e382-4385-a294-31e9f0b0a0d6',
  '1bf6a534-08e0-4d4a-b5e3-c6e6f6726f8a'
);
```

All 6 changes are in a single migration. No code file changes needed.

