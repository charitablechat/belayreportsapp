import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function imageUrlToBase64(url: string): Promise<string> {
  console.log('Fetching image from:', url);
  const response = await fetch(url);
  console.log('Response status:', response.status);
  console.log('Response content-type:', response.headers.get('content-type'));
  
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  // Convert to base64 in chunks to avoid stack overflow
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  const base64 = btoa(binary);
  const mimeType = response.headers.get('content-type') || 'image/png';
  return `data:${mimeType};base64,${base64}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Fetch from Supabase storage bucket (public)
    const storageBaseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co/storage/v1/object/public/pdf-templates';
    const ropeWorksUrl = `${storageBaseUrl}/rope-works-logo-embedded.png`;
    const acctUrl = `${storageBaseUrl}/acct-logo-embedded.png`;
    
    console.log('Attempting to fetch logos from storage URLs...');
    console.log('Rope Works URL:', ropeWorksUrl);
    console.log('ACCT URL:', acctUrl);
    
    const ropeWorksBase64 = await imageUrlToBase64(ropeWorksUrl);
    const acctBase64 = await imageUrlToBase64(acctUrl);
    
    console.log('Successfully converted logos');
    console.log('Rope Works base64 length:', ropeWorksBase64.length);
    console.log('ACCT base64 length:', acctBase64.length);
    
    return new Response(
      JSON.stringify({ 
        ropeWorksLogo: ropeWorksBase64,
        acctLogo: acctBase64,
        ropeWorksLength: ropeWorksBase64.length,
        acctLength: acctBase64.length,
        success: true
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error fetching logos:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        message: 'Please ensure rope-works-logo-embedded.png and acct-logo-embedded.png are uploaded to the pdf-templates storage bucket'
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
