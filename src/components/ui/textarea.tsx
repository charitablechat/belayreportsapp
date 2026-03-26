import * as React from "react";

import { cn } from "@/lib/utils";

const placeCursorAtEnd = (el: HTMLTextAreaElement) => {
  const setCaret = () => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  };
  setCaret();
  requestAnimationFrame(setCaret);
  setTimeout(setCaret, 0);
  setTimeout(setCaret, 50);
};

const collapseFullSelection = (el: HTMLTextAreaElement) => {
  if (
    el.value.length > 0 &&
    el.selectionStart === 0 &&
    el.selectionEnd === el.value.length
  ) {
    placeCursorAtEnd(el);
  }
};

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, onFocus, onMouseUp, onTouchEnd, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
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
});
Textarea.displayName = "Textarea";

export { Textarea };
