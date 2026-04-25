import * as React from "react";

import { cn } from "@/lib/utils";

// Per the HTMLInputElement spec, setSelectionRange only works on input
// types that have a text selection model: text, search, url, tel, password.
// Calling it on email/number/date/etc. throws InvalidStateError. Skip the
// caret-management work on those types so we don't spam the console with
// uncaught errors on every focus of the login form's email input.
const SELECTION_CAPABLE_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "password",
]);

const supportsSelection = (el: HTMLInputElement): boolean => {
  // `type` defaults to "text" when unset; selectionStart is the most reliable
  // runtime probe. If the property exists and is readable, selection is
  // supported on this element regardless of how the type attribute reads.
  if (SELECTION_CAPABLE_TYPES.has(el.type)) return true;
  try {
    return el.selectionStart !== null;
  } catch {
    return false;
  }
};

const placeCursorAtEnd = (el: HTMLInputElement) => {
  if (!supportsSelection(el)) return;
  const setCaret = () => {
    if (!supportsSelection(el)) return;
    const len = el.value.length;
    el.setSelectionRange(len, len);
  };
  setCaret();
  requestAnimationFrame(setCaret);
  setTimeout(setCaret, 0);
  setTimeout(setCaret, 50);
};

const collapseFullSelection = (el: HTMLInputElement) => {
  if (!supportsSelection(el)) return;
  if (
    el.value.length > 0 &&
    el.selectionStart === 0 &&
    el.selectionEnd === el.value.length
  ) {
    placeCursorAtEnd(el);
  }
};

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onMouseUp, onTouchEnd, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onFocus={(e) => {
          placeCursorAtEnd(e.currentTarget);
          onFocus?.(e);
        }}
        onMouseUp={(e) => {
          collapseFullSelection(e.currentTarget);
          onMouseUp?.(e);
        }}
        onTouchEnd={(e) => {
          collapseFullSelection(e.currentTarget);
          onTouchEnd?.(e);
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
