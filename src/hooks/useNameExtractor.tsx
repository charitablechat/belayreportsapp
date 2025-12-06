import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UseNameExtractorReturn {
  extractNames: (text: string) => Promise<string>;
  isExtracting: boolean;
  error: string | null;
}

export const useNameExtractor = (): UseNameExtractorReturn => {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractNames = useCallback(async (text: string): Promise<string> => {
    if (!text || text.trim() === '') {
      return '';
    }

    setIsExtracting(true);
    setError(null);

    try {
      const { data, error: functionError } = await supabase.functions.invoke('extract-names', {
        body: { text }
      });

      if (functionError) {
        console.error('Error calling extract-names:', functionError);
        setError('Failed to extract names');
        // Return original text as fallback
        return text;
      }

      if (data?.error) {
        console.error('Extract names error:', data.error);
        setError(data.error);
        // Return original text as fallback
        return text;
      }

      return data?.names || '';
    } catch (err) {
      console.error('Name extraction failed:', err);
      setError('Name extraction failed');
      // Return original text as fallback
      return text;
    } finally {
      setIsExtracting(false);
    }
  }, []);

  return { extractNames, isExtracting, error };
};
