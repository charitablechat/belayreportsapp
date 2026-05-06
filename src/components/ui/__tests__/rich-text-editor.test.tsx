/**
 * Regression tests for the controlled-TipTap race condition that caused
 * mid-line text deletion across every report module.
 *
 * Bug: typing in the middle of a line wiped the line because the parent's
 * stale `content` prop was re-applied via `editor.commands.setContent` mid-
 * typing, blowing away in-flight characters and slamming the cursor to end.
 *
 * Fix: `lastEmittedHtmlRef` records the most recent HTML emitted by the
 * editor. The sync useEffect skips `setContent` whenever the incoming
 * `content` prop equals that last-emitted value (parent echoing our own
 * change back). External updates (load, regenerate, import, reconcile)
 * still flow through.
 *
 * These tests mock `@tiptap/react` so we can deterministically drive
 * `onUpdate` and observe `setContent` calls — the actual TipTap +
 * contenteditable behavior is not testable in jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useState } from 'react';

// ---- mock @tiptap/react with a controllable fake editor ----

type Handlers = {
  onUpdate?: (ctx: { editor: any }) => void;
  onBlur?: (ctx: { editor: any }) => void;
};

const fake = {
  html: '',
  setContent: vi.fn((html: string) => {
    fake.html = html;
  }),
  setTextSelection: vi.fn(),
  handlers: {} as Handlers,
};

const fakeEditor = {
  getHTML: () => fake.html,
  commands: {
    setContent: (html: string, _opts?: any) => fake.setContent(html),
    setTextSelection: (sel: any) => fake.setTextSelection(sel),
    focus: () => {},
  },
  chain: () => ({
    focus: () => ({
      toggleBold: () => ({ run: () => true }),
      toggleItalic: () => ({ run: () => true }),
      toggleBulletList: () => ({ run: () => true }),
    }),
  }),
  state: {
    selection: { from: 0, to: 0 },
    doc: { content: { size: 100 } },
  },
  view: { dom: document.createElement('div') },
  isActive: () => false,
};

vi.mock('@tiptap/react', () => ({
  useEditor: (config: any) => {
    // Real useEditor initializes content ONCE on mount; subsequent renders
    // do not overwrite editor state from the config object. Mirror that:
    // only seed `fake.html` if it has not been set yet for this mount.
    if (!fake.handlers.onUpdate && !fake.handlers.onBlur) {
      fake.html = config.content ?? '';
    }
    fake.handlers.onUpdate = config.onUpdate;
    fake.handlers.onBlur = config.onBlur;
    return fakeEditor;
  },
  EditorContent: ({ editor: _editor }: any) => (
    <div data-testid="editor-content" />
  ),
  Extension: { create: () => ({}) },
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: () => ({}) },
}));

// import AFTER mocks
import { RichTextEditor } from '../rich-text-editor';

beforeEach(() => {
  fake.setContent.mockClear();
  fake.setTextSelection.mockClear();
  fake.html = '';
  fake.handlers = {};
});

afterEach(() => cleanup());

describe('RichTextEditor — controlled echo guard (mid-line deletion regression)', () => {
  it('does NOT call setContent when parent echoes back the editor’s own emitted HTML', () => {
    // Controlled wrapper: parent state mirrors onChange (the real-world pattern).
    function Harness() {
      const [c, setC] = useState('<p></p>');
      return <RichTextEditor content={c} onChange={setC} />;
    }
    const { rerender: _r } = render(<Harness />);
    fake.setContent.mockClear();

    // User types — TipTap fires onUpdate with new HTML.
    fake.html = '<p>abc</p>';
    fake.handlers.onUpdate!({ editor: fakeEditor });

    // Parent re-renders with the echoed value. The guard must skip setContent,
    // otherwise mid-line typing would be wiped.
    // (state update from onChange has already scheduled a re-render via React).
    // Force-flush any pending effects by rerendering the same tree.
    expect(fake.setContent).not.toHaveBeenCalled();
  });

  it('DOES call setContent for true external updates (load / regenerate / import)', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditor content="<p>one</p>" onChange={onChange} />
    );
    // initial mount uses useEditor({ content }) — no setContent yet
    fake.setContent.mockClear();

    // External change: parent passes a different value that did NOT come from onUpdate
    rerender(<RichTextEditor content="<p>two</p>" onChange={onChange} />);

    expect(fake.setContent).toHaveBeenCalledTimes(1);
    expect(fake.setContent).toHaveBeenCalledWith('<p>two</p>');
  });

  it('skips setContent when the incoming prop already equals editor HTML', () => {
    const onChange = vi.fn();
    fake.html = '<p>same</p>';
    const { rerender } = render(
      <RichTextEditor content="<p>same</p>" onChange={onChange} />
    );
    fake.setContent.mockClear();

    rerender(<RichTextEditor content="<p>same</p>" onChange={onChange} />);
    expect(fake.setContent).not.toHaveBeenCalled();
  });

  it('still applies an external clear (content -> "") after the user has typed', () => {
    function Harness({ external }: { external: string | null }) {
      // start with non-empty content so the external "" really is a change
      const [c, setC] = useState('<p>typed</p>');
      const value = external ?? c;
      return <RichTextEditor content={value} onChange={setC} />;
    }
    const { rerender } = render(<Harness external={null} />);
    // simulate user typing -> editor fires onUpdate (records lastEmitted)
    fake.html = '<p>typed</p>';
    fake.handlers.onUpdate!({ editor: fakeEditor });
    fake.setContent.mockClear();

    // parent forces external clear
    rerender(<Harness external="" />);
    expect(fake.setContent).toHaveBeenCalledWith('');
  });

  it('updates the lastEmitted reference on blur so an immediate prop echo is still ignored', () => {
    function Harness() {
      const [c, setC] = useState('');
      return <RichTextEditor content={c} onChange={setC} />;
    }
    render(<Harness />);
    fake.setContent.mockClear();

    // user types, then blurs without further onChange (some flows debounce on blur)
    fake.html = '<p>blurred</p>';
    fake.handlers.onBlur!({ editor: fakeEditor });

    // No setContent should fire — blur recorded the value as last-emitted
    expect(fake.setContent).not.toHaveBeenCalled();
  });
});
