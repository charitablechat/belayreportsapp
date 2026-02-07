

# Plan: Remove "Repairs Performed" Heading Text from Generated Reports - v2.4.10

## What Changes

Remove only the **heading text** "Repairs Performed" from the HTML and PDF generated reports. The repairs content itself will still appear in the report — just without its title.

## Technical Details

### File 1: `supabase/functions/generate-inspection-html/index.ts`

**Line 2397** — Remove the `<h3>` element that renders "Repairs Performed":

```html
<!-- Remove this line -->
<h3 style="...">Repairs Performed</h3>
```

The surrounding `<div>` and the content block remain unchanged.

### File 2: `supabase/functions/generate-inspection-pdf/index.ts`

**Lines 531-535** — Remove the bold "Repairs Performed" text heading:

```typescript
// Remove these lines:
doc.setFontSize(12);
doc.setFont('helvetica', 'bold');
doc.setTextColor(0, 0, 0);
doc.text('Repairs Performed', margin, yPos);
yPos += 6;
```

The repair content text that follows will still render.

### File 3: `vite.config.ts`

Bump version to **v2.4.10**.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` | Remove `<h3>Repairs Performed</h3>` heading |
| `supabase/functions/generate-inspection-pdf/index.ts` | Remove bold heading text output |
| `vite.config.ts` | Version bump to v2.4.10 |

## What Stays the Same

- The repairs content still renders in both HTML and PDF reports
- The form input field in SummarySection.tsx is untouched
- No database, sync, or auth changes

