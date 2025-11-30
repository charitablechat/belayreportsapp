import { useState, useEffect, useRef } from 'react';
import { triggerHaptic } from '@/lib/haptics';

interface UseSpeechToTextProps {
  onTranscript?: (text: string) => void;
  continuous?: boolean;
  lang?: string;
}

interface UseSpeechToTextReturn {
  isListening: boolean;
  transcript: string;
  error: string | null;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  resetTranscript: () => void;
}

// Helper function to detect similar transcripts and prevent duplicates
const isSimilarTranscript = (newText: string, existingSet: Set<string>): boolean => {
  const normalized = newText.toLowerCase().trim();
  for (const existing of existingSet) {
    const existingNorm = existing.toLowerCase().trim();
    // Check if one contains the other or they're very similar
    if (existingNorm.includes(normalized) || normalized.includes(existingNorm)) {
      return true;
    }
  }
  return false;
};

export const useSpeechToText = ({
  onTranscript,
  continuous = true,
  lang = 'en-US',
}: UseSpeechToTextProps = {}): UseSpeechToTextReturn => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);
  const isListeningRef = useRef(false);
  const lastProcessedResultIndex = useRef<number>(0);
  const processedTranscripts = useRef<Set<string>>(new Set());

  // Update ref when callback changes (prevents memory leak)
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  // Check if browser supports Speech Recognition
  const isSupported = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  useEffect(() => {
    if (!isSupported) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();

    const recognition = recognitionRef.current;
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      isListeningRef.current = true;
      setError(null);
      triggerHaptic('light');
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';

      // Only process new results (beyond what we've already processed)
      for (let i = Math.max(event.resultIndex, lastProcessedResultIndex.current); 
           i < event.results.length; i++) {
        
        const result = event.results[i];
        if (result.isFinal) {
          const transcriptPiece = result[0].transcript.trim();
          
          // Skip if we've already processed this exact transcript or similar one
          if (transcriptPiece && !isSimilarTranscript(transcriptPiece, processedTranscripts.current)) {
            finalTranscript += transcriptPiece + ' ';
            processedTranscripts.current.add(transcriptPiece);
          }
          
          // Update tracking
          lastProcessedResultIndex.current = i + 1;
        }
      }

      if (finalTranscript.trim()) {
        setTranscript(prev => prev + finalTranscript);
        onTranscriptRef.current?.(finalTranscript);
        triggerHaptic('success');

        // Prevent memory issues with long sessions - keep last 50 transcripts
        if (processedTranscripts.current.size > 100) {
          const entries = Array.from(processedTranscripts.current);
          processedTranscripts.current = new Set(entries.slice(-50));
        }
      }
    };

    recognition.onerror = (event: any) => {
      setError(event.error);
      setIsListening(false);
      isListeningRef.current = false;
      triggerHaptic('error');
      console.error('Speech recognition error:', event.error);
    };

    recognition.onend = () => {
      // Auto-restart in continuous mode if user hasn't stopped
      if (isListeningRef.current && continuous) {
        try {
          recognitionRef.current?.start();
        } catch (err) {
          console.error('Error restarting speech recognition:', err);
          setIsListening(false);
          isListeningRef.current = false;
        }
      } else {
        setIsListening(false);
        isListeningRef.current = false;
      }
    };

    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  }, [continuous, lang, isSupported]);

  const startListening = () => {
    if (!isSupported) {
      setError('Speech recognition is not supported in this browser');
      return;
    }

    // Reset tracking for new session
    lastProcessedResultIndex.current = 0;
    processedTranscripts.current.clear();

    try {
      recognitionRef.current?.start();
    } catch (err) {
      console.error('Error starting speech recognition:', err);
    }
  };

  const stopListening = () => {
    isListeningRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const resetTranscript = () => {
    setTranscript('');
  };

  return {
    isListening,
    transcript,
    error,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
    resetTranscript,
  };
};
