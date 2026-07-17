import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

import { corsHeaders } from "../_shared/cors.ts";
interface SummaryRecord {
  id: string;
  repairs_performed?: string;
  critical_actions?: string;
  future_considerations?: string;
}

function convertCircleBulletsToHtml(text: string | null | undefined): { converted: string; hasChanges: boolean } {
  if (!text || !text.includes('○')) {
    return { converted: text || '', hasChanges: false };
  }

  const lines = text.split('\n');
  const result: string[] = [];
  let inList = false;
  let hasChanges = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if line contains circle bullets
    if (trimmed.includes('○')) {
      hasChanges = true;
      
      // Split by ○ to handle multiple bullets on the same line
      const segments = trimmed.split('○').filter(s => s.trim());
      
      for (const segment of segments) {
        const content = segment.trim();
        
        if (!inList) {
          result.push('<ul>');
          inList = true;
        }
        
        result.push(`<li>${content}</li>`);
      }
    } else {
      // Not a bullet point
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      
      if (trimmed) {
        result.push(`<p>${trimmed}</p>`);
      }
    }
  }

  // Close list if still open
  if (inList) {
    result.push('</ul>');
  }

  return {
    converted: result.join(''),
    hasChanges
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Require a valid JWT and admin-or-above role — mirrors
    // migrate-orphaned-photos so this bulk rewrite cannot be triggered
    // anonymously.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: isAdmin } = await userClient.rpc('is_admin_or_above');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
        },
      }
    );


    console.log('Fetching all inspection summaries...');

    // Fetch all inspection summaries
    const { data: summaries, error: fetchError } = await supabaseClient
      .from('inspection_summary')
      .select('id, repairs_performed, critical_actions, future_considerations');

    if (fetchError) {
      throw fetchError;
    }

    console.log(`Found ${summaries?.length || 0} summaries to process`);

    let updatedCount = 0;
    const updateResults: Array<{ id: string; fields: string[] }> = [];

    for (const summary of (summaries || [])) {
      const updates: Partial<SummaryRecord> = {};
      const updatedFields: string[] = [];

      // Convert repairs_performed
      const repairs = convertCircleBulletsToHtml(summary.repairs_performed);
      if (repairs.hasChanges) {
        updates.repairs_performed = repairs.converted;
        updatedFields.push('repairs_performed');
      }

      // Convert critical_actions
      const critical = convertCircleBulletsToHtml(summary.critical_actions);
      if (critical.hasChanges) {
        updates.critical_actions = critical.converted;
        updatedFields.push('critical_actions');
      }

      // Convert future_considerations
      const future = convertCircleBulletsToHtml(summary.future_considerations);
      if (future.hasChanges) {
        updates.future_considerations = future.converted;
        updatedFields.push('future_considerations');
      }

      // Update if any changes were made
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabaseClient
          .from('inspection_summary')
          .update(updates)
          .eq('id', summary.id);

        if (updateError) {
          console.error(`Error updating summary ${summary.id}:`, updateError);
        } else {
          updatedCount++;
          updateResults.push({ id: summary.id, fields: updatedFields });
          console.log(`Updated summary ${summary.id}: ${updatedFields.join(', ')}`);
        }
      }
    }

    const response = {
      success: true,
      totalSummaries: summaries?.length || 0,
      updatedCount,
      updates: updateResults,
      message: `Successfully converted ${updatedCount} inspection summaries from circle bullets to checkmark lists`
    };

    console.log('Migration complete:', response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Migration error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
