import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_CONFIG = {
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
};

interface SendReportEmailRequest {
  html: string;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
  reportType: 'inspection' | 'training' | 'daily_assessment';
  title: string;
  organization?: string;
  date?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getReportTypeDisplay(type: string): string {
  switch (type) {
    case 'inspection': return 'Inspection';
    case 'training': return 'Training';
    case 'daily_assessment': return 'Daily Assessment';
    default: return 'Report';
  }
}

function buildEmailHtml(params: {
  html: string;
  reportType: string;
  title: string;
  organization?: string;
  date?: string;
  message?: string;
  senderName?: string;
}): string {
  const { html, reportType, title, organization, date, message, senderName } = params;
  const reportTypeDisplay = getReportTypeDisplay(reportType);
  const formattedDate = date ? new Date(date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  }) : '';

  const messageSection = message ? `
    <div style="background-color: #f8f9fa; border-left: 4px solid #1a365d; padding: 16px; margin: 24px 0; font-family: Arial, sans-serif;">
      <p style="margin: 0 0 8px 0; font-weight: bold; color: #1a365d;">Message from ${senderName || 'Sender'}:</p>
      <p style="margin: 0; color: #374151; white-space: pre-wrap;">${message}</p>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f3f4f6; }
    .email-wrapper { max-width: 800px; margin: 0 auto; background-color: #ffffff; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div style="background-color: #1a365d; color: white; padding: 24px; text-align: center;">
      <h1 style="margin: 0 0 8px 0; font-family: Arial, sans-serif; font-size: 24px; font-weight: bold;">
        ${reportTypeDisplay} Report
      </h1>
      <p style="margin: 0; font-family: Arial, sans-serif; font-size: 14px; opacity: 0.9;">
        ${[organization, formattedDate].filter(Boolean).join(' • ')}
      </p>
    </div>
    ${messageSection}
    <div style="padding: 0;">${html}</div>
    <div style="background-color: #f8f9fa; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0 0 4px 0; font-family: Arial, sans-serif; font-size: 14px; color: #374151; font-weight: bold;">
        Rope Works Inc. - Professional Inspection Services
      </p>
      <p style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #6b7280;">
        ACCT Accredited Vendor
      </p>
    </div>
  </div>
</body>
</html>`;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rateLimitKey = `email:report:${user.id}`;
    const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMIT_CONFIG);
    if (!rateLimitResult.allowed) {
      console.log(`[send-report-email] Rate limit exceeded for user ${user.id}`);
      return createRateLimitResponse(rateLimitResult.resetAt, corsHeaders);
    }

    const body: SendReportEmailRequest = await req.json();
    const { html, recipientEmail, recipientName, message, reportType, title, organization, date } = body;

    if (!html || !recipientEmail || !reportType || !title) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isValidEmail(recipientEmail)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid email address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .single();

    const senderName = profile
      ? [profile.first_name, profile.last_name].filter(Boolean).join(' ')
      : user.email?.split('@')[0] || 'Rope Works';

    const emailHtml = buildEmailHtml({ html, reportType, title, organization, date, message, senderName });

    // POST to Make.com webhook
    const webhookUrl = Deno.env.get("MAKE_WEBHOOK_URL");
    if (!webhookUrl) {
      console.error("[send-report-email] MAKE_WEBHOOK_URL secret is not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const webhookPayload = {
      recipientEmail,
      recipientName: recipientName || undefined,
      message: message || undefined,
      htmlContent: emailHtml,
      reportType,
      title,
      organization: organization || undefined,
      date: date || undefined,
      senderName,
    };

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error(`[send-report-email] Make.com webhook failed (${webhookResponse.status}):`, errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send email" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-report-email] Webhook sent successfully for ${recipientEmail}`);

    return new Response(
      JSON.stringify({ success: true, message: "Email sent successfully", remaining: rateLimitResult.remaining }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-report-email] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Failed to send email" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
