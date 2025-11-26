import { useState, useEffect } from 'react';
import ropeWorksLogo from '@/assets/rope-works-logo-final.png';
import acctLogo from '@/assets/acct-logo-final.png';

const Base64Converter = () => {
  const [ropeWorksBase64, setRopeWorksBase64] = useState<string>('');
  const [acctBase64, setAcctBase64] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const convertToBase64 = async () => {
      try {
        // Convert Rope Works logo
        const ropeWorksResponse = await fetch(ropeWorksLogo);
        const ropeWorksBlob = await ropeWorksResponse.blob();
        const ropeWorksReader = new FileReader();
        ropeWorksReader.onloadend = () => {
          setRopeWorksBase64(ropeWorksReader.result as string);
        };
        ropeWorksReader.readAsDataURL(ropeWorksBlob);

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

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Logo Base64 Converter</h1>
      
      {loading ? (
        <p>Converting images to base64...</p>
      ) : (
        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-2">Rope Works Logo</h2>
            <img src={ropeWorksBase64} alt="Rope Works" className="mb-4 max-w-md border" />
            <div className="bg-slate-100 p-4 rounded">
              <p className="text-sm font-mono break-all">{ropeWorksBase64}</p>
            </div>
            <p className="mt-2 text-sm text-slate-600">Length: {ropeWorksBase64.length} characters</p>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">ACCT Logo</h2>
            <img src={acctBase64} alt="ACCT" className="mb-4 max-w-md border" />
            <div className="bg-slate-100 p-4 rounded">
              <p className="text-sm font-mono break-all">{acctBase64}</p>
            </div>
            <p className="mt-2 text-sm text-slate-600">Length: {acctBase64.length} characters</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Base64Converter;
