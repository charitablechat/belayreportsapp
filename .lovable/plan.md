

## Fix: "Regenerate from Inspection" Button Appears to Do Nothing

### Root Cause

The `RichTextEditor` component (TipTap-based) only reads the `content` prop once -- during initial editor creation. After that, TipTap manages its own internal state and ignores React prop changes. So when the "Regenerate" button calls `setSummary(...)`, the new HTML content flows into the `content` prop but the TipTap editor never updates its display.

The toast ("Summary Updated") likely does fire, but the editor fields visually remain unchanged, making it appear broken.

### Fix (1 file)

**File: `src/components/ui/rich-text-editor.tsx`**

Add a `useEffect` that detects when the `content` prop changes externally (i.e., not from the user typing in the editor) and calls `editor.commands.setContent(content)` to sync TipTap's internal state.

To avoid an infinite loop (since `onUpdate` also fires `onChange` which could cycle back), the effect will compare the incoming `content` against the editor's current HTML. If they differ, it updates the editor.

```text
useEffect(() => {
  if (editor && content !== editor.getHTML()) {
    editor.commands.setContent(content, false);
  }
}, [content, editor]);
```

The `false` parameter tells TipTap not to emit a parse event, preventing unnecessary re-renders.

### Why This Is Safe

- The comparison `content !== editor.getHTML()` prevents infinite loops: when the user types, `onUpdate` fires `onChange`, which updates the parent's state, which passes a new `content` prop back down -- but since that content matches what the editor already has, the `setContent` call is skipped.
- External updates (like the regenerate button) produce content that differs from the editor's current HTML, so the update fires exactly once.
- No other files need changes. The `SummarySection`, `VoiceRichTextEditor`, and `InspectionForm` are all wired correctly already.

### Testing

1. Open an inspection report with items that have comments (e.g., the "Test" report).
2. Navigate to the Summary tab.
3. Click "Regenerate from Inspection."
4. The three rich text fields (Repairs, Critical Actions, Future Considerations) should immediately update with the aggregated content and a success toast should appear.

