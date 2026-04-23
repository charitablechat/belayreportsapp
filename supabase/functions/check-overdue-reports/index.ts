import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

import { corsHeaders } from "../_shared/cors.ts";
const OVERDUE_THRESHOLD_DAYS = 5;

interface OverdueReport {
  reportType: 'inspection' | 'training' | 'daily_assessment';
  reportId: string;
  createdAt: string;
  daysOverdue: number;
  organization: string;
  owner: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create admin client first for webhook validation
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate webhook secret by reading from database (same source as triggers)
    const webhookSecret = req.headers.get('x-webhook-secret');
    
    const { data: secretRow, error: secretError } = await supabaseAdmin
      .from('webhook_config')
      .select('key_value')
      .eq('key_name', 'WEBHOOK_SECRET')
      .single();

    if (secretError || !secretRow?.key_value) {
      console.error('Failed to read webhook secret from database:', secretError);
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!webhookSecret || webhookSecret !== secretRow.key_value) {
      console.error('Invalid or missing webhook secret');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('check-overdue-reports: webhook validated, starting scan');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - OVERDUE_THRESHOLD_DAYS);
    const cutoffISO = cutoffDate.toISOString();

    // Query all 3 report tables for overdue drafts in parallel
    const [inspections, trainings, dailyAssessments] = await Promise.all([
      supabaseAdmin
        .from('inspections')
        .select('id, created_at, organization, location, inspector_id, organization_id')
        .eq('status', 'draft')
        .is('deleted_at', null)
        .lt('created_at', cutoffISO),
      supabaseAdmin
        .from('trainings')
        .select('id, created_at, organization, inspector_id, organization_id')
        .eq('status', 'draft')
        .is('deleted_at', null)
        .lt('created_at', cutoffISO),
      supabaseAdmin
        .from('daily_assessments')
        .select('id, created_at, organization, site, inspector_id, organization_id')
        .eq('status', 'draft')
        .is('deleted_at', null)
        .lt('created_at', cutoffISO),
    ]);

    if (inspections.error) console.error('Error fetching inspections:', inspections.error);
    if (trainings.error) console.error('Error fetching trainings:', trainings.error);
    if (dailyAssessments.error) console.error('Error fetching daily assessments:', dailyAssessments.error);

    // Collect all inspector IDs to batch-fetch names
    const allInspectorIds = new Set<string>();
    for (const r of [...(inspections.data || []), ...(trainings.data || []), ...(dailyAssessments.data || [])]) {
      if (r.inspector_id) allInspectorIds.add(r.inspector_id);
    }

    // Fetch inspector names
    const inspectorNameMap = new Map<string, string>();
    if (allInspectorIds.size > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', Array.from(allInspectorIds));

      for (const p of profiles || []) {
        const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
        inspectorNameMap.set(p.id, name || p.id);
      }
    }

    const now = Date.now();
    const overdueReports: OverdueReport[] = [];

    for (const r of inspections.data || []) {
      overdueReports.push({
        reportType: 'inspection',
        reportId: r.id,
        createdAt: r.created_at,
        daysOverdue: Math.floor((now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)),
        organization: r.organization || 'Unknown',
        owner: inspectorNameMap.get(r.inspector_id) || r.inspector_id,
      });
    }

    for (const r of trainings.data || []) {
      overdueReports.push({
        reportType: 'training',
        reportId: r.id,
        createdAt: r.created_at,
        daysOverdue: Math.floor((now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)),
        organization: r.organization || 'Unknown',
        owner: inspectorNameMap.get(r.inspector_id) || r.inspector_id,
      });
    }

    for (const r of dailyAssessments.data || []) {
      overdueReports.push({
        reportType: 'daily_assessment',
        reportId: r.id,
        createdAt: r.created_at,
        daysOverdue: Math.floor((now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)),
        organization: r.organization || 'Unknown',
        owner: inspectorNameMap.get(r.inspector_id) || r.inspector_id,
      });
    }

    console.log(`Found ${overdueReports.length} overdue reports`);

    if (overdueReports.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No overdue reports found', overdueCount: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all admin users
    const { data: superAdminRoles, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    if (rolesError) {
      console.error('Error fetching super admin roles:', rolesError);
      throw rolesError;
    }

    if (!superAdminRoles || superAdminRoles.length === 0) {
      console.log('No super admins found');
      return new Response(
        JSON.stringify({ message: 'No super admins to notify', overdueCount: overdueReports.length }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const superAdminIds = superAdminRoles.map(r => r.user_id);

    // Check notification preferences - filter for those with overdue alerts enabled
    const { data: preferences } = await supabaseAdmin
      .from('notification_preferences')
      .select('user_id, report_overdue, email_report_overdue, email_notifications_enabled')
      .in('user_id', superAdminIds);

    // Build sets of users who want push vs email
    const pushUsers = new Set<string>();
    const emailUsers = new Set<string>();

    for (const adminId of superAdminIds) {
      const pref = preferences?.find(p => p.user_id === adminId);
      // Default to true if no preference row exists
      if (!pref || pref.report_overdue !== false) {
        pushUsers.add(adminId);
      }
      if (pref?.email_notifications_enabled && pref?.email_report_overdue !== false) {
        emailUsers.add(adminId);
      }
    }

    const title = `${overdueReports.length} Overdue Report${overdueReports.length > 1 ? 's' : ''} Detected`;
    const bodyLines = overdueReports.slice(0, 5).map(r =>
      `• ${r.reportType.replace('_', ' ')} by ${r.owner} (${r.daysOverdue}d overdue)`
    );
    const body = bodyLines.join('\n') + (overdueReports.length > 5 ? `\n...and ${overdueReports.length - 5} more` : '');

    // ---- Push Notifications ----
    let pushSuccess = 0;
    let pushFail = 0;

    if (pushUsers.size > 0) {
      // Fetch push subscriptions for eligible users
      const { data: subscriptions } = await supabaseAdmin
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', Array.from(pushUsers));

      const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
      const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

      if (vapidPublicKey && vapidPrivateKey && subscriptions && subscriptions.length > 0) {
        const webpush = (await import('npm:web-push@3.6.6')).default;
        webpush.setVapidDetails('mailto:noreply@ropeaccounting.com', vapidPublicKey, vapidPrivateKey);

        for (const sub of subscriptions) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({
                title,
                body,
                data: { overdueCount: overdueReports.length, type: 'report_overdue' },
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192-maskable.png',
              })
            );
            pushSuccess++;

            await supabaseAdmin
              .from('push_subscriptions')
              .update({ last_used_at: new Date().toISOString() })
              .eq('id', sub.id);
          } catch (err: any) {
            pushFail++;
            if (err.statusCode === 410) {
              await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
            }
          }
        }
      }
    }

    // ---- Email Notifications ----
    let emailSuccess = 0;
    let emailFail = 0;

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey && emailUsers.size > 0) {
      const resend = new Resend(resendApiKey);

      // Fetch profiles and auth emails for email recipients
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', Array.from(emailUsers));

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      for (const userId of emailUsers) {
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
          const email = authUser?.user?.email;
          if (!email) continue;

          const profile = profileMap.get(userId);
          const recipientName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';

          const reportRows = overdueReports.map(r => `
            <tr>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${r.reportType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${r.owner}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${r.organization}</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: 600;">${r.daysOverdue} days</td>
            </tr>
          `).join('');

          const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 650px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #dc2626 0%, #f59e0b 100%); padding: 30px; border-radius: 12px 12px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 22px;">⚠️ ${title}</h1>
              </div>
              <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                <p style="font-size: 16px;">Hi ${recipientName || 'there'},</p>
                <p style="font-size: 16px;">The following reports have been in draft status for more than ${OVERDUE_THRESHOLD_DAYS} days and may need attention:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
                  <thead>
                    <tr style="background: #f9fafb;">
                      <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Type</th>
                      <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Owner</th>
                      <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Organization</th>
                      <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>${reportRows}</tbody>
                </table>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                <p style="color: #6b7280; font-size: 14px; margin: 0;">You can manage your notification preferences in your account settings.</p>
              </div>
            </body>
            </html>
          `;

          await resend.emails.send({
            from: 'Rope Works <notifications@resend.dev>',
            to: [email],
            subject: title,
            html: emailHtml,
          });

          emailSuccess++;
        } catch (err) {
          console.error(`Failed to send overdue email to ${userId}:`, err);
          emailFail++;
        }
      }
    }

    // Log notifications for each super admin
    for (const adminId of superAdminIds) {
      await supabaseAdmin.from('notifications_log').insert({
        user_id: adminId,
        notification_type: 'report_overdue',
        title,
        body,
        data: { overdueReports, totalOverdue: overdueReports.length },
        status: 'sent',
      });
    }

    console.log(`Overdue scan complete: ${overdueReports.length} reports, push ${pushSuccess}/${pushFail}, email ${emailSuccess}/${emailFail}`);

    return new Response(
      JSON.stringify({
        message: 'Overdue report scan complete',
        overdueCount: overdueReports.length,
        pushSent: pushSuccess,
        pushFailed: pushFail,
        emailSent: emailSuccess,
        emailFailed: emailFail,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in check-overdue-reports:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
