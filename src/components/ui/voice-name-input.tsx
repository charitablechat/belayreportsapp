import { Input } from '@/components/ui/input';
import { MicrophoneButton } from '@/components/ui/microphone-button';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { useNameExtractor } from '@/hooks/useNameExtractor';
import { cn } from '@/lib/utils';
import { ComponentProps, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface VoiceNameInputProps extends ComponentProps<typeof Input> {
  onValueChange?: (value: string) => void;
}

export const VoiceNameInput = ({ 
  value, 
  onChange, 
  onValueChange,
  className,
  ...props 
}: VoiceNameInputProps) => {
  const { extractNames, isExtracting } = useNameExtractor();
  const [pendingExtraction, setPendingExtraction] = useState(false);

  const { isListening, isSupported, toggleListening } = useSpeechToText({
    onTranscript: async (text) => {
      setPendingExtraction(true);
      
      try {
        // Extract only names from the transcribed text
        const names = await extractNames(text);
        
        if (names && names.trim()) {
          // Append extracted names to existing value
          const currentValue = (value || '') as string;
          const separator = currentValue.trim() ? ', ' : '';
          const newValue = currentValue + separator + names;
          
          if (onValueChange) {
            onValueChange(newValue);
          }
          
          if (onChange) {
            const syntheticEvent = {
              target: { value: newValue },
            } as React.ChangeEvent<HTMLInputElement>;
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
      <Input
        value={value}
        onChange={onChange}
        className={cn('pr-10', className)}
        {...props}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2">
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
