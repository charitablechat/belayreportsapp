import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const REPORT_ROUTE_PATTERNS = [
  /^\/inspection\//,
  /^\/training\//,
  /^\/daily-assessment\//,
  /^\/new-inspection(\/|$)/,
  /^\/new-training(\/|$)/,
  /^\/new-daily-assessment(\/|$)/,
];

function isReportRoute(pathname: string) {
  return REPORT_ROUTE_PATTERNS.some((re) => re.test(pathname));
}

/**
 * Global Enter-to-blur for report forms.
 *
 * - Plain Enter inside an <input> blurs it (prevents form submit / navigation).
 * - Cmd/Ctrl+Enter inside a <textarea> blurs it; plain Enter keeps newline.
 * - Skips contenteditable (TipTap), open comboboxes/autocompletes, non-text inputs.
 * - Preserves scroll position so the page doesn't jump.
 */
export function GlobalEnterToBlur() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!isReportRoute(pathname)) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const tag = target.tagName;
      const isInput = tag === "INPUT";
      const isTextarea = tag === "TEXTAREA";
      if (!isInput && !isTextarea) return;

      if ((target as HTMLElement).isContentEditable) return;

      if (isInput) {
        const type = (target as HTMLInputElement).type;
        if (["submit", "button", "file", "checkbox", "radio", "image", "reset"].includes(type)) return;
      }

      // Skip if inside an open combobox / autocomplete (let Enter select)
      if (target.closest('[aria-expanded="true"]')) return;

      // For textareas: only blur on Cmd/Ctrl+Enter
      if (isTextarea && !(e.metaKey || e.ctrlKey)) return;

      e.preventDefault();
      e.stopPropagation();

      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      (target as HTMLInputElement | HTMLTextAreaElement).blur();

      requestAnimationFrame(() => {
        window.scrollTo(scrollX, scrollY);
        requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
      });
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [pathname]);

  return null;
}
