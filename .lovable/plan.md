

## Hide Report Viewer Toolbar from Print/PDF Output

### Problem
The header toolbar bar in the HTML Report Viewer (containing Email, Save PDF, Close buttons) could appear in PDF output if a user triggers the browser's native print function (Cmd+P / Ctrl+P) while the report dialog is open.

### Solution
Add a `@media print` CSS rule to hide the toolbar, and a `print:hidden` Tailwind class on the header div. This ensures:
- The toolbar is fully visible during normal browsing
- The toolbar is completely hidden when printing/saving as PDF

### Changes

**File: `src/components/HtmlReportViewer.tsx`**

Add the `print:hidden` Tailwind utility class to the header bar div (line 259):

```tsx
// BEFORE
<div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b bg-background">

// AFTER
<div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b bg-background print:hidden">
```

This single class addition uses Tailwind's built-in `print:` variant, which applies `display: none` only inside `@media print`. No other files need changes.

