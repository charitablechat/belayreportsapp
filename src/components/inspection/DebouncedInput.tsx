import { memo, useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";

interface DebouncedInputProps extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  /** Custom validation — return the sanitized value or null to reject */
  validate?: (raw: string) => string | null;
  delay?: number;
}

/**
 * Input that manages local state and debounces propagation to parent.
 * Eliminates re-render cascade on every keystroke in table rows.
 */
export const DebouncedInput = memo(function DebouncedInput({
  value,
  onChange,
  validate,
  delay = 300,
  onBlur,
  onFocus,
  onMouseUp,
  onTouchEnd,
  ...props
}: DebouncedInputProps) {
  const [local, setLocal] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  // Sync from parent when value changes externally
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (validate) {
      const result = validate(raw);
      if (result === null) return; // rejected
      setLocal(result);
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => latestOnChange.current(result), delay);
    } else {
      setLocal(raw);
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => latestOnChange.current(raw), delay);
    }
  }, [validate, delay]);

  // `setSelectionRange` / `selectionStart` throw `InvalidStateError` on
  // <input type="number"> (and email/file/etc). Guard before touching them.
  // See Sentry ef893d25fff04e82bea7fcf8ad4f66b9 (May 12, 2026).
  const supportsSelection = (input: HTMLInputElement): boolean => {
    const t = input.type;
    return t !== "number" && t !== "email" && t !== "file" && typeof input.setSelectionRange === "function";
  };

  const placeCursorAtEnd = useCallback((input: HTMLInputElement) => {
    if (!supportsSelection(input)) return;
    const setCaret = () => {
      if (!supportsSelection(input)) return;
      const len = input.value.length;
      input.setSelectionRange(len, len);
    };

    setCaret();
    requestAnimationFrame(setCaret);
    setTimeout(setCaret, 0);
    setTimeout(setCaret, 50);
  }, []);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    placeCursorAtEnd(e.currentTarget);
    onFocus?.(e);
  }, [onFocus, placeCursorAtEnd]);

  const handlePointerRelease = useCallback((input: HTMLInputElement) => {
    if (!supportsSelection(input)) return;
    if (
      input.value.length > 0 &&
      input.selectionStart === 0 &&
      input.selectionEnd === input.value.length
    ) {
      placeCursorAtEnd(input);
    }
  }, [placeCursorAtEnd]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    // Flush pending debounce immediately
    clearTimeout(timeoutRef.current);
    latestOnChange.current(local);
    onBlur?.(e);
  }, [local, onBlur]);

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <Input
      {...props}
      value={local}
      onChange={handleChange}
      onFocus={handleFocus}
      onMouseUp={(e) => {
        handlePointerRelease(e.currentTarget);
        onMouseUp?.(e);
      }}
      onTouchEnd={(e) => {
        handlePointerRelease(e.currentTarget);
        onTouchEnd?.(e);
      }}
      onBlur={handleBlur}
    />
  );
});
