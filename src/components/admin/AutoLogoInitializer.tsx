import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

export function AutoLogoInitializer() {
  const [status, setStatus] = useState<'idle' | 'checking' | 'uploading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    initializeLogos();
  }, []);

  const initializeLogos = async () => {
    setStatus('uploading');
    setMessage('Syncing logos to storage...');

    try {
      // Always upload logos to ensure latest versions are in storage
      const results = await Promise.allSettled([
        uploadLogoFromPublic('/pdf-templates/belay-reports-logo.png', 'belay-reports-logo-embedded.png'),
        uploadLogoFromPublic('/pdf-templates/acct-accredited-vendor.png', 'acct-logo-embedded.png')
      ]);

      const allSuccessful = results.every(r => r.status === 'fulfilled');
      
      if (allSuccessful) {
        setStatus('success');
        setMessage('Logos synced to storage');
      } else {
        const failedCount = results.filter(r => r.status === 'rejected').length;
        setStatus('error');
        setMessage(`${failedCount} logo(s) failed to upload`);
      }
    } catch (error) {
      console.error('Error initializing logos:', error);
      setStatus('error');
      setMessage('Failed to sync logos');
    }
  };

  const uploadLogoFromPublic = async (publicPath: string, storageName: string) => {
    // Fetch the image from public folder
    const response = await fetch(publicPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${publicPath}`);
    }

    const blob = await response.blob();
    
    // Upload to Supabase storage with upsert to overwrite existing
    const { error } = await supabase.storage
      .from('pdf-templates')
      .upload(storageName, blob, {
        contentType: 'image/png',
        upsert: true
      });

    if (error) {
      throw error;
    }
  };

  if (status === 'idle') {
    return null;
  }

  if (status === 'success') {
    return (
      <Alert className="mb-4 border-green-200 bg-green-50">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          {message}
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'uploading' || status === 'checking') {
    return (
      <Alert className="mb-4 border-blue-200 bg-blue-50">
        <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
        <AlertDescription className="text-blue-800">
          {message}
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'error') {
    return (
      <Alert className="mb-4 border-orange-200 bg-orange-50">
        <AlertCircle className="h-4 w-4 text-orange-600" />
        <AlertDescription className="text-orange-800">
          {message}. Use the upload form below to add logos manually.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
