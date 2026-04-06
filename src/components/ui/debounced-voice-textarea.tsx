import { memo, useState, useRef, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { MicrophoneButton } from "@/components/ui/microphone-button";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { cn } from "@/lib/utils";

interface DebouncedVoiceTextareaProps extends Omit<React.ComponentProps<typeof Textarea>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  delay?: number;
}

/**
 * Voice-enabled textarea with local debouncing.
 * Combines DebouncedTextarea pattern with microphone button from VoiceTextarea.
 */
export const DebouncedVoiceTextarea = memo(function DebouncedVoiceTextarea({
  value,
  onChange,
  delay = 300,
  onBlur,
  className,
  ...props
}: DebouncedVoiceTextareaProps) {
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

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    setLocal(raw);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => latestOnChange.current(raw), delay);
  }, [delay]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    clearTimeout(timeoutRef.current);
    latestOnChange.current(local);
    onBlur?.(e);
  }, [local, onBlur]);

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <div className="relative">
      <Textarea
        value={local}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn('pr-10', className)}
        {...props}
      />
      <div className="absolute right-2 top-2">
        <MicrophoneButton
          isListening={isListening}
          isSupported={isSupported}
          onClick={toggleListening}
        />
      </div>
    </div>
  );
});
