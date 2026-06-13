import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Upload, CheckCircle2 } from 'lucide-react';
import { useRequireAdmin } from '@/hooks/useRequireAdmin';
import belayReportsLogo from '@/assets/belay-reports-logo-final.png';
import acctLogo from '@/assets/acct-logo-final.png';

export default function UploadLogosToStorage() {
  const { loading: adminLoading } = useRequireAdmin();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  const uploadLogos = async () => {
    setUploading(true);
    try {
      // Fetch the logo files
      const [belayReportsResponse, acctResponse] = await Promise.all([
        fetch(belayReportsLogo),
        fetch(acctLogo)
      ]);

      const [belayReportsBlob, acctBlob] = await Promise.all([
        belayReportsResponse.blob(),
        acctResponse.blob()
      ]);

      // Upload to Supabase Storage
      const [belayReportsUpload, acctUpload] = await Promise.all([
        supabase.storage
          .from('pdf-templates')
          .upload('belay-reports-logo-embedded.png', belayReportsBlob, {
            contentType: 'image/png',
            upsert: true
          }),
        supabase.storage
          .from('pdf-templates')
          .upload('acct-logo-embedded.png', acctBlob, {
            contentType: 'image/png',
            upsert: true
          })
      ]);

      if (belayReportsUpload.error) throw belayReportsUpload.error;
      if (acctUpload.error) throw acctUpload.error;

      toast.success('Logos uploaded successfully to storage!');
      setUploaded(true);
      
      // Now call the edge function to get the base64 strings
      const { data, error } = await supabase.functions.invoke('get-logo-base64');
      
      if (error) {
        console.error('Error getting base64:', error);
        toast.error('Logos uploaded but failed to generate base64');
        return;
      }

      console.log('Base64 data received:', {
        belayReportsLength: data.belayReportsLength,
        acctLength: data.acctLength
      });

      toast.success('Base64 strings generated! Check console for details');
      
      // Display the base64 strings
      console.log('=== BELAY REPORTS LOGO BASE64 ===');
      console.log(data.belayReportsLogo);
      console.log('\n=== ACCT LOGO BASE64 ===');
      console.log(data.acctLogo);
      
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload logos: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setUploading(false);
    }
  };

  if (adminLoading) return null;

  return (
    <div className="container mx-auto p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Upload Logos to Storage</h1>
        
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <p className="text-muted-foreground">
            This utility uploads the logo images to Supabase Storage so they can be used in PDF reports.
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <img src={belayReportsLogo} alt="Belay Reports" className="w-24 h-24 object-contain border rounded" />
              <div>
                <p className="font-semibold">Belay Reports Logo</p>
                <p className="text-sm text-muted-foreground">belay-reports-logo-embedded.png</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <img src={acctLogo} alt="ACCT" className="w-24 h-24 object-contain border rounded" />
              <div>
                <p className="font-semibold">ACCT Accredited Vendor Logo</p>
                <p className="text-sm text-muted-foreground">acct-logo-embedded.png</p>
              </div>
            </div>
          </div>

          <Button 
            onClick={uploadLogos} 
            disabled={uploading || uploaded}
            className="w-full"
            size="lg"
          >
            {uploaded ? (
              <>
                <CheckCircle2 className="mr-2 h-5 w-5" />
                Logos Uploaded Successfully
              </>
            ) : uploading ? (
              <>
                <Upload className="mr-2 h-5 w-5 animate-bounce" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-5 w-5" />
                Upload Logos to Storage
              </>
            )}
          </Button>

          {uploaded && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-4">
              <p className="text-sm text-green-800 dark:text-green-200">
                ✓ Logos have been uploaded to storage<br />
                ✓ Base64 strings have been generated<br />
                ✓ Check the browser console for the full base64 data<br />
                ✓ Edge functions will now load logos correctly
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
