import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { MicrophoneButton } from '@/components/ui/microphone-button';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { ComponentProps } from 'react';

interface VoiceRichTextEditorProps extends ComponentProps<typeof RichTextEditor> {}

export const VoiceRichTextEditor = ({ 
  content,
  onChange,
  ...props 
}: VoiceRichTextEditorProps) => {
  const { isListening, isSupported, toggleListening } = useSpeechToText({
    onTranscript: (text) => {
      // Append text to existing content
      const newContent = content + ' ' + text;
      onChange(newContent);
    },
  });

  return (
    <div className="relative">
      <RichTextEditor
        content={content}
        onChange={onChange}
        {...props}
      />
      <div className="absolute right-2 top-2 z-10">
        <MicrophoneButton
          isListening={isListening}
          isSupported={isSupported}
          onClick={toggleListening}
          size="sm"
        />
      </div>
    </div>
  );
};
