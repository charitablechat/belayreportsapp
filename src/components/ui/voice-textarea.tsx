import { Textarea } from '@/components/ui/textarea';
import { MicrophoneButton } from '@/components/ui/microphone-button';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { cn } from '@/lib/utils';
import { ComponentProps } from 'react';

interface VoiceTextareaProps extends ComponentProps<typeof Textarea> {
  onValueChange?: (value: string) => void;
}

export const VoiceTextarea = ({ 
  value, 
  onChange, 
  onValueChange,
  className,
  ...props 
}: VoiceTextareaProps) => {
  const { isListening, isSupported, toggleListening } = useSpeechToText({
    onTranscript: (text) => {
      const newValue = (value || '') + text;
      
      if (onValueChange) {
        onValueChange(newValue);
      }
      
      if (onChange) {
        const syntheticEvent = {
          target: { value: newValue },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        onChange(syntheticEvent);
      }
    },
  });

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={onChange}
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
};
