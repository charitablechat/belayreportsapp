

## Update import flash highlight to 8500ms

Two small edits:

1. **`src/index.css`** (line 698) — Change animation duration from `500ms` to `8500ms`
2. **`src/components/admin/DataRecoveryTool.tsx`** (line 169) — Change the `setTimeout` delay from `600` to `8600` so the state clears after the animation finishes

Everything else (design token usage, mobile/desktop application, non-blocking behavior) is already in place.

