import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

export function AutoLogoInitializer() {
  const [status, setStatus] = useState<'idle' | 'checking' | 'uploading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    checkAndInitializeLogos();
  }, []);

  const checkAndInitializeLogos = async () => {
    setStatus('checking');
    
    try {
      // Check if logos already exist in storage
      const { data: existingFiles } = await supabase.storage
        .from('pdf-templates')
        .list('', {
          search: 'logo-embedded'
        });

      const hasRopeWorks = existingFiles?.some(f => f.name === 'rope-works-logo-embedded.png');
      const hasAcct = existingFiles?.some(f => f.name === 'acct-logo-embedded.png');

      if (hasRopeWorks && hasAcct) {
        setStatus('success');
        setMessage('Logos already configured');
        return;
      }

      // Upload logos from public folder
      setStatus('uploading');
      setMessage('Initializing logos from public folder...');

      const results = await Promise.allSettled([
        uploadLogoFromPublic('/pdf-templates/rope-works-logo.png', 'rope-works-logo-embedded.png'),
        uploadLogoFromPublic('/pdf-templates/acct-accredited-vendor.png', 'acct-logo-embedded.png')
      ]);

      const allSuccessful = results.every(r => r.status === 'fulfilled');
      
      if (allSuccessful) {
        setStatus('success');
        setMessage('Logos initialized successfully');
        toast.success('Report logos are now configured');
      } else {
        setStatus('error');
        setMessage('Some logos failed to upload - please upload manually');
      }
    } catch (error) {
      console.error('Error initializing logos:', error);
      setStatus('error');
      setMessage('Failed to initialize logos');
    }
  };

  const uploadLogoFromPublic = async (publicPath: string, storageName: string) => {
    // Fetch the image from public folder
    const response = await fetch(publicPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${publicPath}`);
    }

    const blob = await response.blob();
    
    // Upload to Supabase storage
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

  if (status === 'idle' || status === 'checking') {
    return null; // Silent initialization
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

  if (status === 'uploading') {
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
