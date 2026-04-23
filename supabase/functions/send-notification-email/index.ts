import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";

import { corsHeaders } from "../_shared/cors.ts";
interface NotificationEmailRequest {
  organizationId: string;
  notificationType: 'inspection_completed' | 'training_completed' | 'daily_assessment_completed' | 'sync_conflict';
  title: string;
  body: string;
  data?: {
    inspectionId?: string;
    trainingId?: string;
    conflictId?: string;
    organization?: string;
    location?: string;
    trainer?: string;
    inspector?: string;
    assessmentId?: string;
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase admin client early for webhook validation
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    // Validate webhook secret from database trigger
    const webhookSecret = req.headers.get('x-webhook-secret');
    
    const { data: secretRow, error: secretError } = await supabaseAdmin
      .from('webhook_config')
      .select('key_value')
      .eq('key_name', 'WEBHOOK_SECRET')
      .single();

    if (secretError || !secretRow?.key_value) {
      console.error('Failed to read webhook secret from database:', secretError);
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const expectedWebhookSecret = secretRow.key_value;
    
    if (!webhookSecret || webhookSecret !== expectedWebhookSecret) {
      console.error('Invalid or missing webhook secret');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized - Invalid webhook secret' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log('Webhook secret validated - request from database trigger');

    // Rate limiting - 10 emails per minute per IP
    const clientIP = getClientIP(req);
    const rateLimitResult = checkRateLimit(`notification-email:${clientIP}`, {
      maxRequests: 10,
      windowMs: 60 * 1000,
    });
    
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for IP: ${clientIP}`);
      return createRateLimitResponse(rateLimitResult.resetAt, corsHeaders);
    }

    const makeWebhookUrl = Deno.env.get("MAKE_WEBHOOK_URL");
    if (!makeWebhookUrl) {
      console.error("MAKE_WEBHOOK_URL is not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Make.com webhook not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: NotificationEmailRequest = await req.json();
    const { organizationId, notificationType, title, body, data } = payload;

    console.log(`Processing email notification for org ${organizationId}, type: ${notificationType}`);

    // Get all admins
    const { data: adminRoles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    if (rolesError) {
      console.error('Error fetching admin roles:', rolesError);
      throw rolesError;
    }

    if (!adminRoles || adminRoles.length === 0) {
      console.log('No admins found');
      return new Response(
        JSON.stringify({ success: true, message: "No admins to notify" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminIds = adminRoles.map(r => r.user_id);

    // Get notification preferences for admins who have email notifications enabled
    const { data: preferences, error: prefsError } = await supabaseAdmin
      .from('notification_preferences')
      .select('user_id, email_notifications_enabled, email_inspection_completed, email_training_completed, email_sync_conflicts')
      .in('user_id', adminIds)
      .eq('email_notifications_enabled', true);

    if (prefsError) {
      console.error('Error fetching notification preferences:', prefsError);
      throw prefsError;
    }

    if (!preferences || preferences.length === 0) {
      console.log('No admins with email notifications enabled');
      return new Response(
        JSON.stringify({ success: true, message: "No admins with email notifications enabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter based on notification type preference
    const prefKey = `email_${notificationType}` as keyof typeof preferences[0];
    const eligiblePrefs = preferences.filter(p => p[prefKey] === true);

    if (eligiblePrefs.length === 0) {
      console.log(`No admins with ${notificationType} email notifications enabled`);
      return new Response(
        JSON.stringify({ success: true, message: "No admins with this notification type enabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get auth users to fetch their emails
    const userEmailMap = new Map<string, string>();
    
    for (const pref of eligiblePrefs) {
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(pref.user_id);
      if (authError) {
        console.error(`Error fetching auth user ${pref.user_id}:`, authError);
      } else if (authUser?.user?.email) {
        userEmailMap.set(pref.user_id, authUser.user.email);
      }
    }

    const usersWithEmail = eligiblePrefs.filter(p => userEmailMap.has(p.user_id));
    
    if (usersWithEmail.length === 0) {
      console.log('No eligible users have an email address');
      return new Response(
        JSON.stringify({ success: true, message: "No eligible users with email addresses" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const eligibleUserIds = usersWithEmail.map(p => p.user_id);

    // Get profiles for names
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', eligibleUserIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
    }

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    // Generate email HTML
    const appUrl = Deno.env.get("SUPABASE_URL")?.replace('.supabase.co', '') || 'https://app.lovable.dev';
    
    const generateEmailHtml = (recipientName: string) => {
      let detailsHtml = '';
      let viewLink = '';
      
      if (notificationType === 'inspection_completed' && data?.inspectionId) {
        viewLink = `${appUrl}/inspection/${data.inspectionId}`;
        detailsHtml = `
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${data.inspector ? `<li style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Inspector:</strong> ${data.inspector}</li>` : ''}
            ${data.location ? `<li style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Location:</strong> ${data.location}</li>` : ''}
            ${data.organization ? `<li style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Organization:</strong> ${data.organization}</li>` : ''}
            <li style="padding: 8px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</li>
          </ul>
        `;
      } else if (notificationType === 'training_completed' && data?.trainingId) {
        viewLink = `${appUrl}/training/${data.trainingId}`;
        detailsHtml = `
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${data.trainer ? `<li style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Trainer:</strong> ${data.trainer}</li>` : ''}
            ${data.organization ? `<li style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Organization:</strong> ${data.organization}</li>` : ''}
            <li style="padding: 8px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</li>
          </ul>
        `;
      } else if (notificationType === 'daily_assessment_completed' && data?.assessmentId) {
        viewLink = `${appUrl}/daily-assessment/${data.assessmentId}`;
        detailsHtml = `
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${data.inspector ? `<li style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Inspector:</strong> ${data.inspector}</li>` : ''}
            ${data.location ? `<li style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Site:</strong> ${data.location}</li>` : ''}
            ${data.organization ? `<li style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Organization:</strong> ${data.organization}</li>` : ''}
            <li style="padding: 8px 0;"><strong>Date:</strong> ${new Date().toLocaleDateString()}</li>
          </ul>
        `;
      } else if (notificationType === 'sync_conflict') {
        viewLink = `${appUrl}/dashboard`;
        detailsHtml = `
          <p style="color: #d97706;">A sync conflict was detected and requires your attention.</p>
          ${data?.inspectionId ? `<p><strong>Inspection ID:</strong> ${data.inspectionId}</p>` : ''}
        `;
      }

      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">${title}</h1>
          </div>
          
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 16px; margin-bottom: 20px;">Hi ${recipientName || 'there'},</p>
            
            <p style="font-size: 16px; margin-bottom: 20px;">${body}</p>
            
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              ${detailsHtml}
            </div>
            
            ${viewLink ? `
              <a href="${viewLink}" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Report</a>
            ` : ''}
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              You can manage your notification preferences in your account settings.
            </p>
          </div>
        </body>
        </html>
      `;
    };

    // Build recipients list and generate HTML (use first recipient's name for the shared HTML)
    const recipients = usersWithEmail.map(pref => {
      const profile = profileMap.get(pref.user_id);
      const name = profile 
        ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() 
        : '';
      return {
        email: userEmailMap.get(pref.user_id)!,
        name,
      };
    });

    // Generate one HTML per recipient (personalized greeting)
    // For Make.com, we send all recipients + a generic HTML; Make.com iterates and sends
    // Using first recipient's name for the HTML since Make.com can personalize per-recipient if needed
    const genericHtml = generateEmailHtml(recipients[0]?.name || '');

    console.log(`Sending webhook to Make.com with ${recipients.length} recipients`);

    // POST to Make.com webhook with exponential backoff (3 attempts)
    const MAX_RETRIES = 3;
    let lastError = '';
    let makeResponse: Response | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        makeResponse = await fetch(makeWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipients,
            subject: title,
            html: genericHtml,
            notificationType,
            data: data || {},
          }),
        });

        if (makeResponse.ok) break;

        lastError = await makeResponse.text();
        console.warn(`Make.com attempt ${attempt}/${MAX_RETRIES} failed [${makeResponse.status}]: ${lastError}`);
      } catch (fetchErr) {
        lastError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.warn(`Make.com attempt ${attempt}/${MAX_RETRIES} network error: ${lastError}`);
      }

      if (attempt < MAX_RETRIES) {
        const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s
        console.log(`Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    if (!makeResponse?.ok) {
      console.error(`Make.com webhook failed after ${MAX_RETRIES} attempts: ${lastError}`);
      return new Response(
        JSON.stringify({ success: false, error: `Make.com webhook failed after ${MAX_RETRIES} attempts` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully sent notification to Make.com for ${recipients.length} recipients`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sent notification to Make.com for ${recipients.length} recipients`,
        recipientCount: recipients.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error in send-notification-email:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
