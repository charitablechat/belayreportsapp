

## Flash-highlight imported JSON file entry

### Approach
After a successful import, store the `reportId` of the newly imported snapshot in state. Each snapshot row (both mobile card and desktop table row) checks if its ID matches the highlighted one, and if so applies a CSS animation class that fades from a green highlight to transparent over 500ms. A `setTimeout` clears the highlight state after 500ms.

### Changes

**`src/components/admin/DataRecoveryTool.tsx`** — `LocalSnapshotsPanel`

1. Add state: `const [highlightedId, setHighlightedId] = useState<string | null>(null)`
2. In `handleImportFile`, after `refreshSnapshots()` succeeds, call `setHighlightedId(reportId)` and set a 500ms timeout to clear it back to `null`.
3. On the mobile card `<div key={s.key} ...>` and desktop `<TableRow key={s.key}>`, add a conditional class when `s.reportId === highlightedId` — e.g. `"import-flash"`.

**`src/index.css`** — Add the animation

```css
@keyframes import-flash {
  0%   { background-color: hsl(142 71% 45% / 0.25); }
  100% { background-color: transparent; }
}
.import-flash {
  animation: import-flash 500ms ease-out forwards;
}
```

This is a pure cosmetic change — no data or API impact, and the highlight auto-clears so it never blocks interaction.

