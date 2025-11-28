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
  
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const mimeType = blob.type || 'image/png';
  return `data:${mimeType};base64,${base64}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Try multiple possible URLs for the logos
    const possibleUrls = [
      // From the deployed preview (app's public folder)
      'https://lovable.dev/projects/18ac3c0c-3b99-4fe2-b1ed-a2c9e8c2cd73/pdf-templates/rope-works-logo-embedded.png',
      'https://lovable.dev/projects/18ac3c0c-3b99-4fe2-b1ed-a2c9e8c2cd73/pdf-templates/acct-logo-embedded.png',
    ];
    
    console.log('Attempting to fetch logos from public URLs...');
    
    try {
      const ropeWorksBase64 = await imageUrlToBase64(possibleUrls[0]);
      const acctBase64 = await imageUrlToBase64(possibleUrls[1]);
      
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
    } catch (fetchError) {
      console.error('Failed to fetch from public URLs:', fetchError);
      
      return new Response(
        JSON.stringify({ 
          error: 'Logos not found in expected locations',
          message: 'Please upload rope-works-logo-embedded.png and acct-logo-embedded.png to Supabase Storage bucket "pdf-templates"',
          details: fetchError instanceof Error ? fetchError.message : String(fetchError),
          suggestion: 'Navigate to /base64-converter in the app to manually generate the base64 strings'
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
