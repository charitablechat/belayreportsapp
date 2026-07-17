import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { corsHeaders } from "../_shared/cors.ts";
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Require a valid JWT and admin-or-above role. Matches the pattern in
    // migrate-orphaned-photos so this bulk migration endpoint cannot be
    // invoked by unauthenticated callers.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token)
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: isAdmin } = await userClient.rpc('is_admin_or_above')
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)


    console.log('[Migrate Field History] Starting migration...')

    const stats = {
      inspections_processed: 0,
      trainings_processed: 0,
      daily_assessments_processed: 0,
      history_entries_created: 0,
      errors: [] as string[]
    }

    // Helper to upsert field history
    async function upsertFieldHistory(userId: string, fieldType: string, value: string) {
      if (!value || value.trim() === '') return false
      
      const trimmedValue = value.trim()
      
      const { error } = await supabase
        .from('user_field_history')
        .upsert({
          user_id: userId,
          field_type: fieldType,
          value: trimmedValue,
          usage_count: 1,
          last_used_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,field_type,value',
          ignoreDuplicates: true
        })
      
      if (error) {
        console.error(`[Migrate Field History] Error upserting ${fieldType}:`, error.message)
        return false
      }
      return true
    }

    // Process inspections
    console.log('[Migrate Field History] Processing inspections...')
    const { data: inspections, error: inspError } = await supabase
      .from('inspections')
      .select('inspector_id, organization, location, onsite_contact, previous_inspector')
    
    if (inspError) {
      stats.errors.push(`Inspections fetch error: ${inspError.message}`)
    } else if (inspections) {
      for (const insp of inspections) {
        if (insp.organization && await upsertFieldHistory(insp.inspector_id, 'organization', insp.organization)) {
          stats.history_entries_created++
        }
        if (insp.location && await upsertFieldHistory(insp.inspector_id, 'location', insp.location)) {
          stats.history_entries_created++
        }
        if (insp.onsite_contact && await upsertFieldHistory(insp.inspector_id, 'onsite_contact', insp.onsite_contact)) {
          stats.history_entries_created++
        }
        if (insp.previous_inspector && await upsertFieldHistory(insp.inspector_id, 'inspector_name', insp.previous_inspector)) {
          stats.history_entries_created++
        }
        stats.inspections_processed++
      }
    }
    console.log(`[Migrate Field History] Processed ${stats.inspections_processed} inspections`)

    // Process trainings
    console.log('[Migrate Field History] Processing trainings...')
    const { data: trainings, error: trainError } = await supabase
      .from('trainings')
      .select('inspector_id, organization, trainer_of_record')
    
    if (trainError) {
      stats.errors.push(`Trainings fetch error: ${trainError.message}`)
    } else if (trainings) {
      for (const training of trainings) {
        if (training.organization && await upsertFieldHistory(training.inspector_id, 'organization', training.organization)) {
          stats.history_entries_created++
        }
        if (training.trainer_of_record && await upsertFieldHistory(training.inspector_id, 'trainer_name', training.trainer_of_record)) {
          stats.history_entries_created++
        }
        stats.trainings_processed++
      }
    }
    console.log(`[Migrate Field History] Processed ${stats.trainings_processed} trainings`)

    // Process daily assessments
    console.log('[Migrate Field History] Processing daily assessments...')
    const { data: assessments, error: assessError } = await supabase
      .from('daily_assessments')
      .select('inspector_id, organization, site, trainer_of_record')
    
    if (assessError) {
      stats.errors.push(`Daily assessments fetch error: ${assessError.message}`)
    } else if (assessments) {
      for (const assessment of assessments) {
        if (assessment.organization && await upsertFieldHistory(assessment.inspector_id, 'organization', assessment.organization)) {
          stats.history_entries_created++
        }
        if (assessment.site && await upsertFieldHistory(assessment.inspector_id, 'site', assessment.site)) {
          stats.history_entries_created++
        }
        if (assessment.trainer_of_record && await upsertFieldHistory(assessment.inspector_id, 'trainer_name', assessment.trainer_of_record)) {
          stats.history_entries_created++
        }
        stats.daily_assessments_processed++
      }
    }
    console.log(`[Migrate Field History] Processed ${stats.daily_assessments_processed} daily assessments`)

    console.log('[Migrate Field History] Migration complete:', stats)

    return new Response(JSON.stringify({
      success: true,
      message: 'Field history migration completed',
      stats
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Migrate Field History] Error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
