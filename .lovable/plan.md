

## Plan — make collaborator presence banner readable

### Problem
`src/components/CollaboratorPresence.tsx:79` uses `bg-warning/10` (a 10% amber tint, nearly white) with `text-warning-foreground` (designed to sit on solid amber, so it's a pale color). Result: pale text on a pale background, near-invisible — exactly what the screenshot shows.

### Fix (one-line className change)
Swap the foreground token for one with real contrast against a light tint background, and bump the tint slightly:

```tsx
className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/15 px-3 py-2 text-sm font-medium text-foreground"
```

- `text-foreground` — high-contrast against any light surface (this is the project's standard body text token; works in both light and dark themes via the index.css token system).
- `bg-warning/15` + `border-warning/50` — keeps the amber identity that signals "heads up, someone else is here" but slightly stronger so it doesn't disappear.
- `font-medium` — small weight bump for legibility in the truncated single-line context.

The icon inherits `text-foreground` too, so it picks up the same readable color.

### Out of scope (not touching this round)
- The pre-existing edge-function build errors in the build log (`generate-inspection-html`, `generate-og-image`, `web-push@3.6.6`, `pdf-parse@1.1.1`). These were present before this round of changes — unrelated to the presence banner — and the user's ask is purely a readability fix. Worth a separate pass if you want them cleaned up.

### Verdict
Approve and I'll switch to default mode and ship the one-line className change.

