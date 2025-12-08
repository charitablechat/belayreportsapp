import { Input } from '@/components/ui/input';
import { MicrophoneButton } from '@/components/ui/microphone-button';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { cn } from '@/lib/utils';
import { ComponentProps } from 'react';

interface VoiceInputProps extends ComponentProps<typeof Input> {
  onValueChange?: (value: string) => void;
  onEnter?: () => void;
}

export const VoiceInput = ({ 
  value, 
  onChange, 
  onValueChange,
  onEnter,
  className,
  onKeyDown,
  ...props 
}: VoiceInputProps) => {
  const { isListening, isSupported, toggleListening } = useSpeechToText({
    onTranscript: (text) => {
      const newValue = (value || '') + text;
      
      if (onValueChange) {
        onValueChange(newValue);
      }
      
      if (onChange) {
        const syntheticEvent = {
          target: { value: newValue },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    },
  });

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={onChange}
        className={cn('pr-10', className)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
          onKeyDown?.(e);
        }}
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
};
