import { useEffect, useCallback } from "react";
import { toast } from "sonner";

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description?: string;
}

interface UseKeyboardShortcutsOptions {
  shortcuts: ShortcutConfig[];
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  shortcuts,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Only allow Ctrl/Cmd+S to save even in inputs
        const isSaveShortcut =
          event.key?.toLowerCase() === "s" &&
          (event.ctrlKey || event.metaKey) &&
          !event.shiftKey &&
          !event.altKey;

        if (!isSaveShortcut) return;
      }

      for (const shortcut of shortcuts) {
        const keyMatch = event.key?.toLowerCase() === shortcut.key?.toLowerCase();
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey : !event.ctrlKey;
        const metaMatch = shortcut.meta ? event.metaKey : !event.metaKey;
        const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const altMatch = shortcut.alt ? event.altKey : !event.altKey;

        // For Ctrl/Cmd+S, we want to match either ctrl or meta
        const isSaveShortcut = shortcut.key?.toLowerCase() === "s" && (shortcut.ctrl || shortcut.meta);
        
        if (isSaveShortcut) {
          if (keyMatch && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            shortcut.action();
            return;
          }
        } else if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch) {
          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [shortcuts, enabled]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

// Helper to get the correct modifier key label based on platform
export function getModifierKey(): string {
  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  return isMac ? "⌘" : "Ctrl";
}

// Pre-configured save shortcut
export function useSaveShortcut(onSave: () => void, enabled = true) {
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: "s",
        ctrl: true,
        meta: true,
        action: () => {
          onSave();
          toast.success("Saved", { duration: 1500 });
        },
        description: "Save",
      },
    ],
    enabled,
  });
}
