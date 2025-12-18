import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

interface NotificationEmailRequest {
  organizationId: string;
  notificationType: 'inspection_completed' | 'training_completed' | 'sync_conflict';
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
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate webhook secret from database trigger
    const webhookSecret = req.headers.get('x-webhook-secret');
    const expectedWebhookSecret = Deno.env.get('WEBHOOK_SECRET');
    
    if (!webhookSecret || !expectedWebhookSecret || webhookSecret !== expectedWebhookSecret) {
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

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resend = new Resend(resendApiKey);

    // Create Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    const payload: NotificationEmailRequest = await req.json();
    const { organizationId, notificationType, title, body, data } = payload;

    console.log(`Processing email notification for org ${organizationId}, type: ${notificationType}`);

    // Get all super admins for the organization
    const { data: superAdminRoles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'super_admin');

    if (rolesError) {
      console.error('Error fetching super admin roles:', rolesError);
      throw rolesError;
    }

    if (!superAdminRoles || superAdminRoles.length === 0) {
      console.log('No super admins found');
      return new Response(
        JSON.stringify({ success: true, message: "No super admins to notify" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const superAdminIds = superAdminRoles.map(r => r.user_id);

    // Get notification preferences for super admins who have email notifications enabled
    const { data: preferences, error: prefsError } = await supabaseAdmin
      .from('notification_preferences')
      .select('user_id, email_notifications_enabled, email_inspection_completed, email_training_completed, email_sync_conflicts, email_address')
      .in('user_id', superAdminIds)
      .eq('email_notifications_enabled', true);

    if (prefsError) {
      console.error('Error fetching notification preferences:', prefsError);
      throw prefsError;
    }

    if (!preferences || preferences.length === 0) {
      console.log('No super admins with email notifications enabled');
      return new Response(
        JSON.stringify({ success: true, message: "No super admins with email notifications enabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter based on notification type preference
    const prefKey = `email_${notificationType}` as keyof typeof preferences[0];
    const eligiblePrefs = preferences.filter(p => p[prefKey] === true);

    if (eligiblePrefs.length === 0) {
      console.log(`No super admins with ${notificationType} email notifications enabled`);
      return new Response(
        JSON.stringify({ success: true, message: "No super admins with this notification type enabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get auth users to fetch their signup emails as fallback
    const eligibleUserIds = eligiblePrefs.map(p => p.user_id);
    
    // Fetch auth emails for users without custom email addresses
    const userEmailMap = new Map<string, string>();
    
    for (const pref of eligiblePrefs) {
      if (pref.email_address) {
        // Use custom email if provided
        userEmailMap.set(pref.user_id, pref.email_address);
      } else {
        // Fetch auth email as fallback
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(pref.user_id);
        if (authError) {
          console.error(`Error fetching auth user ${pref.user_id}:`, authError);
        } else if (authUser?.user?.email) {
          userEmailMap.set(pref.user_id, authUser.user.email);
          console.log(`Using auth email for user ${pref.user_id}: ${authUser.user.email}`);
        }
      }
    }

    // Filter out users without any email
    const usersWithEmail = eligiblePrefs.filter(p => userEmailMap.has(p.user_id));
    
    if (usersWithEmail.length === 0) {
      console.log('No eligible users have an email address');
      return new Response(
        JSON.stringify({ success: true, message: "No eligible users with email addresses" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profiles for super admins
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', eligibleUserIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
    }

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    // Generate email HTML based on notification type
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

    // Send emails to all eligible super admins
    const results = await Promise.allSettled(
      usersWithEmail.map(async (pref) => {
        const profile = profileMap.get(pref.user_id);
        const recipientName = profile 
          ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() 
          : '';
        
        const emailHtml = generateEmailHtml(recipientName);
        const recipientEmail = userEmailMap.get(pref.user_id)!;
        
        console.log(`Sending email to ${recipientEmail}`);
        
        const emailResult = await resend.emails.send({
          from: "Rope Works <notifications@resend.dev>",
          to: [recipientEmail],
          subject: title,
          html: emailHtml,
        });
        
        return { userId: pref.user_id, email: recipientEmail, result: emailResult };
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.filter(r => r.status === 'rejected').length;

    console.log(`Sent ${successCount} emails, ${failedCount} failed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sent ${successCount} notification emails`,
        sentCount: successCount,
        failedCount: failedCount 
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
