import * as React from "react";

import { cn } from "@/lib/utils";

const placeCursorAtEnd = (el: HTMLInputElement) => {
  const setCaret = () => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
  };
  setCaret();
  requestAnimationFrame(setCaret);
  setTimeout(setCaret, 0);
  setTimeout(setCaret, 50);
};

const collapseFullSelection = (el: HTMLInputElement) => {
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
