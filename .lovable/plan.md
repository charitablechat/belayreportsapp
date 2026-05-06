## Goal

Lock in the mid-line text-deletion fix in `src/components/ui/rich-text-editor.tsx` with a regression test so the controlled-TipTap race condition can never silently come back.

## Background

The bug: typing in the middle of a line caused the entire line to vanish. Root cause was a controlled-component race — the parent re-rendered with stale `content` while the user kept typing, and the sync `useEffect` called `editor.commands.setContent(stale)`, blowing away in-flight characters and slamming the cursor to the end.

Fix already applied: `lastEmittedHtmlRef` tracks the most recent HTML emitted by `onUpdate`/`onBlur`, and the sync effect skips `setContent` whenever the incoming `content` prop equals that last-emitted value (i.e. it's just the parent echoing our own change back). External updates (initial load, regenerate, JSON import, Realtime reconcile) still flow through.

Because every report (Training, Inspection, Daily Assessment, Equipment notes, Known Issues, Developer Notes, etc.) consumes the same `RichTextEditor`, one regression test covers all report modules.

## Plan

1. Add `src/components/ui/__tests__/rich-text-editor.test.tsx` with these cases:
   - **Echo guard (the regression):** Render a controlled wrapper that mirrors `onChange` back into `content`, but with a one-render delay (simulates React batching / parent state lag). Type "abc", then place cursor between `a` and `b` and type "X". Assert the final HTML contains `aXbc` — not `abc`, not empty, not `Xabc` (cursor jumped to end).
   - **External update still applies:** Mount with `content="<p>one</p>"`, then change the prop to `<p>two</p>` from outside (not via onChange echo). Assert the editor DOM updates to `two`.
   - **Echo of identical content is a no-op:** Spy on `editor.commands.setContent` (or assert via DOM that cursor/selection is preserved). Re-render parent passing back the exact same HTML the editor just emitted; the editor's selection should not be reset.
   - **Empty → typed → cleared:** Type into an initially-empty editor, then have the parent reset `content` to `""`. Assert the editor clears (external reset still works).

2. Co-locate the file under `src/components/ui/__tests__/` (matches the project convention referenced in the testing setup doc). No new dependencies — `vitest`, `@testing-library/react`, `jsdom`, and `@testing-library/jest-dom` are already installed and configured.

3. Run the suite via the test runner and confirm all four cases pass. If any fail, fix the test (not the component) unless a real bug surfaces.

## Technical notes

- TipTap in jsdom is finicky around `contenteditable`. Use `@testing-library/react`'s `fireEvent` with `input`/`beforeinput` events on the `[contenteditable="true"]` node, or drive the editor via the exposed `editor` instance using a `ref` on a small test harness component that calls `editor.commands.insertContentAt(pos, 'X')`. The latter is more deterministic in jsdom and is the recommended approach for the echo-guard test.
- The harness component should look roughly like:
  ```tsx
  function Harness() {
    const [c, setC] = useState('');
    return <RichTextEditor content={c} onChange={setC} />;
  }
  ```
  For the echo-guard test, wrap `setC` in a `startTransition` or a `setTimeout(..., 0)` to simulate the parent-lag window where the bug fires.
- Do not modify `rich-text-editor.tsx`. The tests must pass against the current implementation; their job is to fail loudly if the `lastEmittedHtmlRef` guard is ever removed.

## Out of scope

- Plain `<input>`/`<textarea>` audit (separate request if needed).
- `VoiceRichTextEditor`, `LazyRichTextEditor` wrapper behavior.
- Any production code change.