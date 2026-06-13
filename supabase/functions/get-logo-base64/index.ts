import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";

// Rate limit: 30 requests per minute per IP (logos are cached, so this is generous)
import { corsHeaders } from "../_shared/cors.ts";
const RATE_LIMIT_CONFIG = {
  maxRequests: 30,
  windowMs: 60 * 1000, // 1 minute
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check rate limit
    const clientIP = getClientIP(req);
    const rateLimitResult = checkRateLimit(`get-logo-base64:${clientIP}`, RATE_LIMIT_CONFIG);
    
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for IP: ${clientIP}`);
      return createRateLimitResponse(rateLimitResult.resetAt, corsHeaders);
    }

    const url = new URL(req.url);
    const logoType = url.searchParams.get('type') || 'rope-works';
    
    console.log(`Fetching logo: ${logoType}`);
    
    // Get the Supabase URL from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL not configured');
    }
    
    // Map logo types to storage paths
    const logoPath = logoType === 'acct' 
      ? 'acct-logo-embedded.png'
      : 'belay-reports-logo-embedded.png';
    
    const storageUrl = `${supabaseUrl}/storage/v1/object/public/pdf-templates/${logoPath}`;
    
    console.log(`Fetching from: ${storageUrl}`);
    
    const response = await fetch(storageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch logo: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Convert to base64
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    
    const mimeType = 'image/png';
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    console.log(`Successfully converted logo to base64, length: ${base64.length}`);
    
    return new Response(JSON.stringify({ dataUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in get-logo-base64:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});