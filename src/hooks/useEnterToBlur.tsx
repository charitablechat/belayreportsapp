import { useEffect, RefObject } from "react";

/**
 * On Enter inside an <input> (or Cmd/Ctrl+Enter inside a <textarea>),
 * blur the active field without scrolling or moving focus elsewhere.
 *
 * Exclusions:
 * - contenteditable elements (TipTap rich text)
 * - inputs inside an open combobox/listbox (aria-expanded="true" ancestor)
 * - inputs of type submit/button/file
 */
export function useEnterToBlur(containerRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const tag = target.tagName;
      const isInput = tag === "INPUT";
      const isTextarea = tag === "TEXTAREA";
      if (!isInput && !isTextarea) return;

      // Skip contenteditable
      if ((target as HTMLElement).isContentEditable) return;

      // Skip non-text inputs
      if (isInput) {
        const type = (target as HTMLInputElement).type;
        if (["submit", "button", "file", "checkbox", "radio", "image", "reset"].includes(type)) return;
      }

      // Skip if inside an open combobox/autocomplete (let Enter select)
      if (target.closest('[aria-expanded="true"]') || target.closest('[role="combobox"][aria-expanded="true"]')) {
        return;
      }
      // cmdk / Radix listbox-attached inputs
      if (target.getAttribute("aria-controls") && target.getAttribute("aria-expanded") === "true") {
        return;
      }

      // For textareas, only blur on Cmd/Ctrl+Enter; plain Enter keeps newline
      if (isTextarea && !(e.metaKey || e.ctrlKey)) return;

      e.preventDefault();
      e.stopPropagation();

      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      (target as HTMLInputElement | HTMLTextAreaElement).blur();

      // Restore scroll across two frames (mobile keyboard can shift after blur)
      requestAnimationFrame(() => {
        window.scrollTo(scrollX, scrollY);
        requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
      });
    };

    node.addEventListener("keydown", handler, true);
    return () => node.removeEventListener("keydown", handler, true);
  }, [containerRef]);
}
