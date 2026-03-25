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
      onBlur={handleBlur}
    />
  );
});
