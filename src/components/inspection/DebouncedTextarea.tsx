import { memo, useState, useRef, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";

interface DebouncedTextareaProps extends Omit<React.ComponentProps<typeof Textarea>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  delay?: number;
}

/**
 * Textarea that manages local state and debounces propagation to parent.
 * Same pattern as DebouncedInput but for multi-line text fields.
 */
export const DebouncedTextarea = memo(function DebouncedTextarea({
  value,
  onChange,
  delay = 300,
  onBlur,
  ...props
}: DebouncedTextareaProps) {
  const [local, setLocal] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  // Sync from parent when value changes externally
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    setLocal(raw);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => latestOnChange.current(raw), delay);
  }, [delay]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    // Flush pending debounce immediately
    clearTimeout(timeoutRef.current);
    latestOnChange.current(local);
    onBlur?.(e);
  }, [local, onBlur]);

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <Textarea
      {...props}
      value={local}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
});
