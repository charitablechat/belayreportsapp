

## Hide Email and SMS Buttons on Mobile in Report Viewer

### What Changes

In `src/components/HtmlReportViewer.tsx`, add responsive CSS classes to conditionally hide the Email and SMS/Text buttons on screens below 768px, while keeping the Share and Close buttons visible.

### Technical Details

**File: `src/components/HtmlReportViewer.tsx`**

Two buttons need the `hidden sm:inline-flex` (or `hidden md:flex`) treatment:

1. **Email button** (~line 211-221): Wrap or add `hidden md:inline-flex` to hide it below 768px
2. **SMS/Text button** (~line 223-233): Same treatment -- `hidden md:inline-flex`

The Share and Close buttons remain untouched.

This uses Tailwind's responsive prefix `md:` (768px breakpoint) which aligns with the project's existing `MOBILE_BREAKPOINT = 768` in `use-mobile.tsx`. No CSS media queries in a separate stylesheet are needed -- Tailwind's utility classes are the established pattern in this codebase.

No changes to PDF generation logic, share logic, or any other file.

