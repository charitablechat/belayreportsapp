

## Restyle Section Notes to Warning Yellow

### What's Changing
The "Structure Notes" / "Section Notes" boxes currently use a dark terminal-style theme (dark navy background, light text). These will be restyled to a **warning yellow** theme in both:

1. **The form UI** (`SectionComments.tsx`) -- what you see when editing the assessment
2. **The generated HTML report** (`generate-daily-assessment-html/index.ts`) -- what appears in the PDF/HTML output

### New Look
- Background: warm amber/yellow tint
- Border-left accent: amber/orange
- Text: dark (readable on light yellow background)
- Header icon and title: amber-toned
- Overall feel: clearly a "warning/attention" callout

### Files Changed

| File | Change |
|------|--------|
| `src/components/daily-assessment/SectionComments.tsx` | Replace dark slate classes with amber/yellow warning classes on the textarea and label |
| `supabase/functions/generate-daily-assessment-html/index.ts` | Update `.section-notes`, `.notes-header`, `.notes-icon`, `.notes-title`, `.notes-content` CSS from dark navy to warning yellow palette |

### Technical Details

**SectionComments.tsx** (form UI):
- Textarea: `bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 focus:border-amber-500`
- Label: `text-amber-700 dark:text-amber-400`
- Icon color: amber
- Left border accent on the container

**Report HTML CSS** (lines 498-539):
- `.section-notes` background: `#fffbeb` (amber-50) with `#f59e0b` (amber-500) border
- `.notes-icon` color: `#d97706` (amber-600)
- `.notes-title` color: `#92400e` (amber-800)
- `.notes-content` background: `#fef3c7` (amber-100), text color: `#78350f` (amber-900), left border: `#f59e0b` (amber-500)

No logic, data, or layout changes -- purely color/styling swap.
