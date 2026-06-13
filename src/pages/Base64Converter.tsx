import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useRequireAdmin } from '@/hooks/useRequireAdmin';
import belayReportsLogo from '@/assets/belay-reports-logo-final.png';
import acctLogo from '@/assets/acct-logo-final.png';

const Base64Converter = () => {
  const { isAdmin, loading: adminLoading } = useRequireAdmin();
  const [belayReportsBase64, setRopeWorksBase64] = useState<string>('');
  const [acctBase64, setAcctBase64] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const convertToBase64 = async () => {
      try {
        // Convert Belay Reports logo
        const belayReportsResponse = await fetch(belayReportsLogo);
        const belayReportsBlob = await belayReportsResponse.blob();
        const belayReportsReader = new FileReader();
        belayReportsReader.onloadend = () => {
          setRopeWorksBase64(belayReportsReader.result as string);
        };
        belayReportsReader.readAsDataURL(belayReportsBlob);

        // Convert ACCT logo
        const acctResponse = await fetch(acctLogo);
        const acctBlob = await acctResponse.blob();
        const acctReader = new FileReader();
        acctReader.onloadend = () => {
          setAcctBase64(acctReader.result as string);
          setLoading(false);
        };
        acctReader.readAsDataURL(acctBlob);
      } catch (error) {
        console.error('Error converting images:', error);
        setLoading(false);
      }
    };

    convertToBase64();
  }, []);

  const copyToClipboard = (text: string, logoName: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`${logoName} base64 copied to clipboard!`);
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
  };

  if (adminLoading) return null;
  if (!isAdmin) return null;

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Logo Base64 Converter</h1>
      
      {loading ? (
        <p>Converting images to base64...</p>
      ) : (
        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-2">Belay Reports Logo</h2>
            <img src={belayReportsBase64} alt="Belay Reports" className="mb-4 max-w-md border" />
            <div className="bg-slate-100 p-4 rounded relative">
              <p className="text-sm font-mono break-all pr-24">{belayReportsBase64}</p>
              <Button
                onClick={() => copyToClipboard(belayReportsBase64, 'Belay Reports Logo')}
                className="absolute top-2 right-2"
                size="sm"
              >
                Copy
              </Button>
            </div>
            <p className="mt-2 text-sm text-slate-600">Length: {belayReportsBase64.length} characters</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">ACCT Logo</h2>
            <img src={acctBase64} alt="ACCT" className="mb-4 max-w-md border" />
            <div className="bg-slate-100 p-4 rounded relative">
              <p className="text-sm font-mono break-all pr-24">{acctBase64}</p>
              <Button
                onClick={() => copyToClipboard(acctBase64, 'ACCT Logo')}
                className="absolute top-2 right-2"
                size="sm"
              >
                Copy
              </Button>
            </div>
            <p className="mt-2 text-sm text-slate-600">Length: {acctBase64.length} characters</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Base64Converter;
