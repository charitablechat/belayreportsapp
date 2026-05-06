## What's happening in the video

In `Training Summary → Training Observations`, the user clicks into the middle of the line `"French creek non adjustable biplane lanyards have illegible manufacture dates."` and starts editing. As soon as they type, the editor wipes part of the line back to a stale value (and the cursor jumps to the end). They retype, click back in, edit again, get wiped again.

This is the classic "controlled TipTap" race, and it lives in **one shared component** that every report uses, so the fix applies once and protects all reports.

## Root cause

`src/components/ui/rich-text-editor.tsx` syncs the `content` prop into the editor on every render:

```ts
useEffect(() => {
  if (editor && content !== editor.getHTML()) {
    editor.commands.setContent(content, { emitUpdate: false });
  }
}, [content, editor]);
```

Sequence that breaks editing:

1. User types char A → TipTap `onUpdate` fires → `onChange(htmlA)`.
2. Parent calls `setSummary({...summary, observations: htmlA})` (re-render scheduled).
3. Before React commits, user types char B → TipTap is now at `htmlB` internally.
4. React commits with `content = htmlA` (the in-flight value).
5. Effect runs: `htmlA !== editor.getHTML() (htmlB)` → calls `setContent(htmlA)`.
6. `setContent` **resets the document** to `htmlA` and **moves the cursor to the end**, destroying char B and any selection state.

When the user is editing in the middle of a line, the cursor "jumping to end" reads as "the rest of the line was deleted" because their next keystroke now appends at the end while the in-flight value they were editing got clobbered. With longer typing bursts you can lose multi-character chunks, which is exactly what the video shows.

This same component is used by:

- `TrainingSummarySection` (Training Observations + Recommendations) — visible bug.
- `SummarySection` (Inspection: Repairs, Critical Actions, Future Considerations).
- `ZiplinesTable`, `OperatingSystemsTable`, `EquipmentTable` (per-row inline notes).
- `KnownIssuesCard`, `DeveloperNotesCard`.
- `LazyRichTextEditor` (which wraps `RichTextEditor`).

So everywhere a TipTap rich-text field exists, the same race can fire — just less visibly on short fields. Fixing it once in `rich-text-editor.tsx` covers every report.

## Fix

Track the HTML the editor last emitted to the parent. Only sync the `content` prop back into the editor when it represents a **truly external** change (initial load, "Regenerate from Inspection", JSON import, server reconcile) — not when it's just our own `onChange` echoing back through React state.

Edit `src/components/ui/rich-text-editor.tsx`:

1. Add a `lastEmittedHtmlRef = useRef<string | null>(null)`.
2. In `onUpdate`, set `lastEmittedHtmlRef.current = editor.getHTML()` before calling `onChange`.
3. Change the sync effect to:
   ```ts
   useEffect(() => {
     if (!editor) return;
     const current = editor.getHTML();
     if (content === current) return;                       // already in sync
     if (content === lastEmittedHtmlRef.current) return;    // it's our own echo — ignore
     // External change (load, regenerate, import) — preserve cursor where possible.
     const { from, to } = editor.state.selection;
     editor.commands.setContent(content, { emitUpdate: false });
     try {
       const size = editor.state.doc.content.size;
       editor.commands.setTextSelection({
         from: Math.min(from, size),
         to: Math.min(to, size),
       });
     } catch { /* selection restore best-effort */ }
   }, [content, editor]);
   ```
4. Also guard against an edge case where `onChange` is called before the parent commits (focus/blur cycles): keep `lastEmittedHtmlRef` in sync inside `onBlur` too (`lastEmittedHtmlRef.current = editor.getHTML()`).

That's the entire change — single file, ~15 lines.

## Why this is safe for every other consumer

- "Regenerate from Inspection" in `SummarySection` calls `onUpdate(...)` with brand-new HTML that did **not** come from this editor's `onChange` → `lastEmittedHtmlRef.current` does not match it → effect runs → editor updates. Works.
- JSON import / Realtime reconcile / `loadTraining` set state from outside → same reasoning, works.
- Normal typing (the broken case today) → the prop coming back equals the value we just emitted → effect skips → cursor and in-flight characters preserved. Fixed.
- `LazyRichTextEditor` mounts `RichTextEditor` only on focus and unmounts on blur, so each focus cycle starts fresh — the ref-based guard still applies during the focused window, which is when the bug fires.

## Out of scope

- No changes to `VoiceRichTextEditor`, `SummarySection`, `TrainingSummarySection`, or any form page. The voice append path (`content + ' ' + text`) is fine because it goes through `onChange` like a normal user edit.
- No DB / schema changes. No styling changes. No behavior change for "Regenerate", import, or reconcile flows.
- No changes to plain `<input>` / `<textarea>` fields — they don't use TipTap and don't have this race.

## Verification

1. Training → Summary → Observations: type a sentence, click into the middle of a word, type/delete characters. Cursor stays put; no characters lost.
2. Inspection → Summary → Critical Actions: same test.
3. Inspection → Summary → click "Regenerate from Inspection" → editor updates to regenerated text (external sync still works).
4. Inspection → Equipment row inline notes (LazyRichTextEditor): focus, edit mid-string, confirm no clobber.
5. Open the same training on two browsers; edit on one, confirm the other still receives Realtime updates and reloads (external sync path).
