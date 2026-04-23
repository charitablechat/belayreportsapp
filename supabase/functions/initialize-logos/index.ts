import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting logo initialization...');

    // L4: derive base URL from env (project-ref rotation safety) and use the
    // correct Supabase storage URL shape (/storage/v1/object/public/...).
    const storageBase = `${supabaseUrl}/storage/v1/object/public/pdf-templates`;
    const publicAssetUrls = [
      `${storageBase}/rope-works-logo.png`,
      `${storageBase}/acct-accredited-vendor.png`,
    ];

    const results = [];

    // Upload rope-works logo
    try {
      const response = await fetch(publicAssetUrls[0]);
      if (response.ok) {
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        const { data, error } = await supabase.storage
          .from('pdf-templates')
          .upload('rope-works-logo-embedded.png', uint8Array, {
            contentType: 'image/png',
            upsert: true
          });
        
        if (error) {
          results.push({ logo: 'rope-works', status: 'error', message: error.message });
        } else {
          results.push({ logo: 'rope-works', status: 'success', path: data.path });
        }
      } else {
        results.push({ logo: 'rope-works', status: 'error', message: `HTTP ${response.status}` });
      }
    } catch (error) {
      results.push({ 
        logo: 'rope-works', 
        status: 'error', 
        message: error instanceof Error ? error.message : String(error)
      });
    }

    // Upload ACCT logo
    try {
      const response = await fetch(publicAssetUrls[1]);
      if (response.ok) {
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        const { data, error } = await supabase.storage
          .from('pdf-templates')
          .upload('acct-logo-embedded.png', uint8Array, {
            contentType: 'image/png',
            upsert: true
          });
        
        if (error) {
          results.push({ logo: 'acct', status: 'error', message: error.message });
        } else {
          results.push({ logo: 'acct', status: 'success', path: data.path });
        }
      } else {
        results.push({ logo: 'acct', status: 'error', message: `HTTP ${response.status}` });
      }
    } catch (error) {
      results.push({ 
        logo: 'acct', 
        status: 'error', 
        message: error instanceof Error ? error.message : String(error)
      });
    }

    console.log('Logo initialization complete:', results);

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Logo initialization complete',
        results 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error initializing logos:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
