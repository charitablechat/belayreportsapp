import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/react';
import { Bold, Italic, List } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export const RichTextEditor = ({
  content,
  onChange,
  onBlur,
  placeholder = 'Enter comments...',
  className,
  autoFocus,
}: RichTextEditorProps) => {
  // Tracks the most recent HTML emitted from this editor's onUpdate so we can
  // distinguish "the parent just echoed our own change back" (ignore — would
  // clobber the user's in-flight typing and reset the cursor) from a true
  // external update like initial load, regenerate, JSON import, or remote
  // reconcile (apply, preserving cursor where possible).
  const lastEmittedHtmlRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
      }),
      Extension.create({
        name: 'tabNavigation',
        addKeyboardShortcuts() {
          const moveFocus = (direction: 1 | -1) => {
            const el = this.editor.view.dom;
            const focusables = Array.from(
              document.querySelectorAll<HTMLElement>(
                'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([role="menuitem"]), button:not([disabled]), [contenteditable="true"]'
              )
            ).filter(e => e.offsetParent !== null);
            const idx = focusables.indexOf(el);
            const next = focusables[idx + direction];
            if (next) {
              el.blur();
              next.focus();
            }
            return true;
          };
          return {
            Tab: () => moveFocus(1),
            'Shift-Tab': () => moveFocus(-1),
          };
        },
      }),
    ],
    content,
    autofocus: autoFocus ?? false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastEmittedHtmlRef.current = html;
      onChange(html);
    },
    onBlur: () => {
      if (editor) lastEmittedHtmlRef.current = editor.getHTML();
      onBlur?.();
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] px-3 py-2 break-words [overflow-wrap:anywhere]',
      },
    },
  });

  // Sync external content changes (initial load, regenerate, import, remote
  // reconcile) into TipTap. Skip when the prop is just our own onChange echo —
  // applying it would call setContent mid-typing, destroying in-flight chars
  // and slamming the cursor to the end of the document.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (content === current) return;
    if (content === lastEmittedHtmlRef.current) return;

    const { from, to } = editor.state.selection;
    editor.commands.setContent(content, { emitUpdate: false });
    lastEmittedHtmlRef.current = editor.getHTML();
    try {
      const size = editor.state.doc.content.size;
      editor.commands.setTextSelection({
        from: Math.min(from, size),
        to: Math.min(to, size),
      });
    } catch {
      // best-effort cursor restore
    }
  }, [content, editor]);

  if (!editor) {
    return null;
  }

  const isInline = className?.includes('bg-transparent');

  return (
    <div className={cn('border bg-background', !isInline && 'rounded-md', className)}>
      <div className={cn("flex items-center gap-1 p-2", !isInline && "border-b bg-muted/50")}>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={cn(
            'p-1.5 rounded hover:bg-background transition-colors',
            editor.isActive('bold') && 'bg-background'
          )}
          title="Bold"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn(
            'p-1.5 rounded hover:bg-background transition-colors',
            editor.isActive('italic') && 'bg-background'
          )}
          title="Italic"
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={cn(
            'p-1.5 rounded hover:bg-background transition-colors',
            editor.isActive('bulletList') && 'bg-background'
          )}
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};
