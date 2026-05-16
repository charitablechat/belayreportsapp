/**
 * Popover-anchor-guard
 * --------------------
 * Helper for autocomplete components that render an <Input> wrapped in
 * `PopoverAnchor` / `PopoverTrigger asChild`. Radix's outside-detection
 * treats pointerdowns on the input as "outside" the PopoverContent, which
 * causes the open dropdown to close the moment a user taps/clicks back
 * into the trigger Input (the open/close flicker users see on iPad and
 * desktop). It also makes parent-induced re-renders or background
 * autosave-induced focus restorations look like outside interactions.
 *
 * Usage:
 *   const anchorRef = useRef<HTMLDivElement>(null);
 *   <PopoverAnchor asChild>
 *     <div ref={anchorRef} ...>
 *       <Input ... />
 *     </div>
 *   </PopoverAnchor>
 *   <PopoverContent
 *     onPointerDownOutside={keepOpenIfAnchor(anchorRef)}
 *     onInteractOutside={keepOpenIfAnchor(anchorRef)}
 *     onFocusOutside={keepOpenIfAnchor(anchorRef)}
 *   >
 *
 * The popover then closes only on:
 *   - selection (CommandItem onSelect)
 *   - Escape
 *   - explicit clear (X button)
 *   - a real outside click/tap (not inside the trigger anchor)
 */
import type { RefObject } from "react";

type DismissEvent = {
  target: EventTarget | null;
  preventDefault: () => void;
};

export function keepOpenIfAnchor(anchorRef: RefObject<HTMLElement | null>) {
  return (event: DismissEvent) => {
    const target = event.target as Node | null;
    if (target && anchorRef.current && anchorRef.current.contains(target)) {
      event.preventDefault();
    }
  };
}
