import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MicrophoneButtonProps {
  isListening: boolean;
  isSupported: boolean;
  onClick: () => void;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export const MicrophoneButton = ({
  isListening,
  isSupported,
  onClick,
  size = 'icon',
  className,
}: MicrophoneButtonProps) => {
  if (!isSupported) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={onClick}
      className={cn(
        'relative',
        isListening && 'text-destructive',
        className
      )}
      title={isListening ? 'Stop recording' : 'Start voice input'}
    >
      {isListening ? (
        <>
          <MicOff className="h-4 w-4" />
          <span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-20" />
        </>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
};
