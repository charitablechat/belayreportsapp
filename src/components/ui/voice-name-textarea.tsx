import { Textarea } from '@/components/ui/textarea';
import { MicrophoneButton } from '@/components/ui/microphone-button';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { useNameExtractor } from '@/hooks/useNameExtractor';
import { cn } from '@/lib/utils';
import { ComponentProps, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface VoiceNameTextareaProps extends ComponentProps<typeof Textarea> {
  onValueChange?: (value: string) => void;
}

export const VoiceNameTextarea = ({ 
  value, 
  onChange, 
  onValueChange,
  className,
  ...props 
}: VoiceNameTextareaProps) => {
  const { extractNames, isExtracting } = useNameExtractor();
  const [pendingExtraction, setPendingExtraction] = useState(false);

  const { isListening, isSupported, toggleListening } = useSpeechToText({
    onTranscript: async (text) => {
      setPendingExtraction(true);
      
      try {
        // Extract only names from the transcribed text
        const names = await extractNames(text);
        
        if (names && names.trim()) {
          // Parse comma-separated names and add each on a new line
          const nameList = names.split(',').map(n => n.trim()).filter(Boolean);
          const currentValue = (value || '') as string;
          
          // Add names on new lines
          let newValue = currentValue;
          for (const name of nameList) {
            if (newValue.trim()) {
              newValue = newValue.trimEnd() + '\n' + name;
            } else {
              newValue = name;
            }
          }
          
          if (onValueChange) {
            onValueChange(newValue);
          }
          
          if (onChange) {
            const syntheticEvent = {
              target: { value: newValue },
            } as React.ChangeEvent<HTMLTextAreaElement>;
            onChange(syntheticEvent);
          }
        }
      } finally {
        setPendingExtraction(false);
      }
    },
  });

  const showLoading = isExtracting || pendingExtraction;

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={onChange}
        className={cn('pr-10', className)}
        {...props}
      />
      <div className="absolute right-2 top-2">
        {showLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <MicrophoneButton
            isListening={isListening}
            isSupported={isSupported}
            onClick={toggleListening}
          />
        )}
      </div>
    </div>
  );
};
