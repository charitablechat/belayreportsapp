import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useRequireAdmin } from '@/hooks/useRequireAdmin';
import belayReportsLogoAsset from "@/assets/belay-reports-wide.gif.asset.json";
const belayReportsLogo = belayReportsLogoAsset.url;
import acctLogo from '@/assets/acct-logo-final.png';

const UploadLogos = () => {
  const { loading: adminLoading } = useRequireAdmin();
  const [uploading, setUploading] = useState(false);

  const uploadLogos = async () => {
    setUploading(true);
    try {
      // Fetch the logo files
      const belayReportsResponse = await fetch(belayReportsLogo);
      const belayReportsBlob = await belayReportsResponse.blob();
      
      const acctResponse = await fetch(acctLogo);
      const acctBlob = await acctResponse.blob();

      // Upload Belay Reports logo
      const { error: belayReportsError } = await supabase.storage
        .from('pdf-templates')
        .upload('belay-reports-logo.png', belayReportsBlob, {
          contentType: 'image/png',
          upsert: true
        });

      if (belayReportsError) throw belayReportsError;

      // Upload ACCT logo
      const { error: acctError } = await supabase.storage
        .from('pdf-templates')
        .upload('acct-accredited-vendor.png', acctBlob, {
          contentType: 'image/png',
          upsert: true
        });

      if (acctError) throw acctError;

    } catch (error) {
      console.error('Error uploading logos:', error);
    } finally {
      setUploading(false);
    }
  };

  if (adminLoading) return null;

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Upload Logos to Storage</h1>
      
      <div className="space-y-4">
        <div>
          <img src={belayReportsLogo} alt="Belay Reports Logo" className="max-w-md border mb-2" />
          <p className="text-sm text-slate-600">Belay Reports Logo</p>
        </div>

        <div>
          <img src={acctLogo} alt="ACCT Logo" className="max-w-md border mb-2" />
          <p className="text-sm text-slate-600">ACCT Accredited Vendor Logo</p>
        </div>

        <Button 
          onClick={uploadLogos} 
          disabled={uploading}
          className="mt-4"
        >
          {uploading ? 'Uploading...' : 'Upload to pdf-templates Bucket'}
        </Button>
      </div>
    </div>
  );
};

export default UploadLogos;
