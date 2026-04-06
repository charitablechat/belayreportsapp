import { memo, useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MicrophoneButton } from "@/components/ui/microphone-button";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { cn } from "@/lib/utils";

interface DebouncedVoiceInputProps extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  delay?: number;
}

/**
 * Voice-enabled input with local debouncing.
 * Combines DebouncedInput pattern with microphone button from VoiceInput.
 */
export const DebouncedVoiceInput = memo(function DebouncedVoiceInput({
  value,
  onChange,
  delay = 300,
  onBlur,
  className,
  ...props
}: DebouncedVoiceInputProps) {
  const [local, setLocal] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  const { isListening, isSupported, toggleListening } = useSpeechToText({
    onTranscript: (text) => {
      const newValue = local + text;
      setLocal(newValue);
      // Flush immediately on voice input
      clearTimeout(timeoutRef.current);
      latestOnChange.current(newValue);
    },
  });

  // Sync from parent when value changes externally
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocal(raw);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => latestOnChange.current(raw), delay);
  }, [delay]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    clearTimeout(timeoutRef.current);
    latestOnChange.current(local);
    onBlur?.(e);
  }, [local, onBlur]);

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <div className="relative">
      <Input
        value={local}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn('pr-10', className)}
        {...props}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
        <MicrophoneButton
          isListening={isListening}
          isSupported={isSupported}
          onClick={toggleListening}
        />
      </div>
    </div>
  );
});
