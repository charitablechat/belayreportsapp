import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

import { corsHeaders } from "../_shared/cors.ts";
interface SummaryRecord {
  id: string;
  inspection_id: string;
  repairs_performed: string | null;
  critical_actions: string | null;
}

/**
 * Extracts unique list items from HTML content containing duplicate <li> tags
 */
function deduplicateHtmlList(html: string | null): string {
  if (!html) return '';
  
  // Extract all <li> content using regex
  const liRegex = /<li>(.*?)<\/li>/gs;
  const matches = [...html.matchAll(liRegex)];
  
  if (matches.length === 0) {
    // No list items found, return original content
    return html;
  }
  
  // Extract unique items (case-insensitive comparison, preserve original case)
  const uniqueItems = new Map<string, string>();
  
  for (const match of matches) {
    const content = match[1].trim();
    const lowerContent = content.toLowerCase();
    
    // Only add if not already present (case-insensitive check)
    if (!uniqueItems.has(lowerContent)) {
      uniqueItems.set(lowerContent, content);
    }
  }
  
  // Rebuild HTML with unique items
  if (uniqueItems.size === 0) {
    return '';
  }
  
  const uniqueListItems = Array.from(uniqueItems.values())
    .map(item => `<li>${item}</li>`)
    .join('\n');
  
  return `<ul>\n${uniqueListItems}\n</ul>`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Verify user is authenticated and is super admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if user is admin
    const { data: roles, error: rolesError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (rolesError || !roles) {
      throw new Error('Admin access required');
    }

    console.log(`Starting cleanup - User: ${user.id}`);

    // Fetch all inspection summaries
    const { data: summaries, error: fetchError } = await supabaseClient
      .from('inspection_summary')
      .select('id, inspection_id, repairs_performed, critical_actions');

    if (fetchError) {
      console.error('Error fetching summaries:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${summaries?.length || 0} summary records`);

    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const errors: Array<{ id: string; error: string }> = [];

    // Process each summary
    for (const summary of summaries || []) {
      try {
        const originalRepairs = summary.repairs_performed;
        const originalActions = summary.critical_actions;

        // Deduplicate content
        const cleanedRepairs = deduplicateHtmlList(originalRepairs);
        const cleanedActions = deduplicateHtmlList(originalActions);

        // Only update if content changed
        const repairsChanged = cleanedRepairs !== originalRepairs;
        const actionsChanged = cleanedActions !== originalActions;

        if (repairsChanged || actionsChanged) {
          const { error: updateError } = await supabaseClient
            .from('inspection_summary')
            .update({
              repairs_performed: cleanedRepairs,
              critical_actions: cleanedActions,
            })
            .eq('id', summary.id);

          if (updateError) {
            console.error(`Error updating summary ${summary.id}:`, updateError);
            errors.push({ id: summary.id, error: updateError.message });
            errorCount++;
          } else {
            console.log(`Updated summary ${summary.id}`);
            updatedCount++;
          }
        }

        processedCount++;
      } catch (error) {
        console.error(`Error processing summary ${summary.id}:`, error);
        errors.push({ 
          id: summary.id, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        errorCount++;
      }
    }

    const result = {
      success: true,
      totalRecords: summaries?.length || 0,
      processedCount,
      updatedCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `Cleanup complete: ${updatedCount} records updated, ${errorCount} errors`,
    };

    console.log('Cleanup result:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
