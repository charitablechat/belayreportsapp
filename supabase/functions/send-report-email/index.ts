 import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
 import { Resend } from "https://esm.sh/resend@2.0.0";
 import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
 import DOMPurify from "npm:isomorphic-dompurify@2.16.0";
 import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";
 
 const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
 
 const corsHeaders = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers":
     "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
 };
 
 // Rate limit config: 10 emails per user per hour
 const RATE_LIMIT_CONFIG = {
   maxRequests: 10,
   windowMs: 60 * 60 * 1000, // 1 hour
 };
 
 interface SendReportEmailRequest {
   html: string;
   recipientEmail: string;
   recipientName?: string;
   message?: string;
   reportType: 'inspection' | 'training' | 'daily_assessment' | 'jcf';
   title: string;
   organization?: string;
   date?: string;
 }
 
 // Basic email validation
 function isValidEmail(email: string): boolean {
   const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
   return emailRegex.test(email);
 }
 
 // Get report type display name
 function getReportTypeDisplay(type: string): string {
   switch (type) {
     case 'inspection': return 'Inspection';
     case 'training': return 'Training';
     case 'daily_assessment': return 'Daily Assessment';
     case 'jcf': return 'Job Completion Form';
     default: return 'Report';
   }
 }
 
 // Build email HTML with professional wrapper
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
   
   // Format date for display
   const formattedDate = date ? new Date(date).toLocaleDateString('en-US', { 
     year: 'numeric', 
     month: 'long', 
     day: 'numeric' 
   }) : '';
 
   const messageSection = message ? `
     <div style="background-color: #f8f9fa; border-left: 4px solid #1a365d; padding: 16px; margin: 24px 0; font-family: Arial, sans-serif;">
       <p style="margin: 0 0 8px 0; font-weight: bold; color: #1a365d;">Message from ${senderName || 'Sender'}:</p>
       <p style="margin: 0; color: #374151; white-space: pre-wrap;">${message}</p>
     </div>
   ` : '';
 
   return `
 <!DOCTYPE html>
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
     <!-- Header -->
     <div style="background-color: #1a365d; color: white; padding: 24px; text-align: center;">
       <h1 style="margin: 0 0 8px 0; font-family: Arial, sans-serif; font-size: 24px; font-weight: bold;">
         ${reportTypeDisplay} Report
       </h1>
       <p style="margin: 0; font-family: Arial, sans-serif; font-size: 14px; opacity: 0.9;">
         ${[organization, formattedDate].filter(Boolean).join(' • ')}
       </p>
     </div>
     
     ${messageSection}
     
     <!-- Report Content (sanitized server-side to strip <script>, event handlers, iframes, etc.) -->
     <div style="padding: 0;">
       ${DOMPurify.sanitize(html, {
         FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "meta", "link", "base"],
         FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit", "onkeydown", "onkeyup", "onkeypress", "formaction", "srcdoc"],
         ALLOW_DATA_ATTR: false,
       })}
     </div>
     
     <!-- Footer -->
     <div style="background-color: #f8f9fa; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
       <p style="margin: 0 0 4px 0; font-family: Arial, sans-serif; font-size: 14px; color: #374151; font-weight: bold;">
         Belay Reports - Professional Inspection Services
       </p>
       <p style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #6b7280;">
         ACCT Accredited Vendor
       </p>
     </div>
   </div>
 </body>
 </html>
   `;
 }
 
 const handler = async (req: Request): Promise<Response> => {
   // Handle CORS preflight
   if (req.method === "OPTIONS") {
     return new Response(null, { headers: corsHeaders });
   }
 
   try {
     // Verify authentication
     const authHeader = req.headers.get("Authorization");
     if (!authHeader) {
       return new Response(
         JSON.stringify({ success: false, error: "Authorization required" }),
         { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Create Supabase client to get user info
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
 
     // Rate limiting by user ID
     const rateLimitKey = `email:report:${user.id}`;
     const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMIT_CONFIG);
     
     if (!rateLimitResult.allowed) {
       console.log(`[send-report-email] Rate limit exceeded for user ${user.id}`);
       return createRateLimitResponse(rateLimitResult.resetAt, corsHeaders);
     }
 
     // Parse request body
     const body: SendReportEmailRequest = await req.json();
     const { html, recipientEmail, recipientName, message, reportType, title, organization, date } = body;
 
     // Validate required fields
     if (!html || !recipientEmail || !reportType || !title) {
       return new Response(
         JSON.stringify({ success: false, error: "Missing required fields" }),
         { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Validate email format
     if (!isValidEmail(recipientEmail)) {
       return new Response(
         JSON.stringify({ success: false, error: "Invalid email address" }),
         { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Get sender name from profile
     const { data: profile } = await supabase
       .from('profiles')
       .select('first_name, last_name')
       .eq('id', user.id)
       .single();
     
     const senderName = profile 
       ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') 
       : user.email?.split('@')[0] || 'Belay Reports';
 
     // Build email with professional wrapper
     const emailHtml = buildEmailHtml({
       html,
       reportType,
       title,
       organization,
       date,
       message,
       senderName,
     });
 
     // Build email subject
     const reportTypeDisplay = getReportTypeDisplay(reportType);
     const subject = organization 
       ? `${reportTypeDisplay} Report - ${organization}`
       : `${reportTypeDisplay} Report`;
 
     // Send email via Resend
     const emailResponse = await resend.emails.send({
       from: "Belay Reports <reports@resend.dev>",
       to: [recipientEmail],
       subject,
       html: emailHtml,
     });
 
     console.log(`[send-report-email] Email sent successfully to ${recipientEmail}:`, emailResponse);
 
     return new Response(
       JSON.stringify({ 
         success: true, 
         message: "Email sent successfully",
         remaining: rateLimitResult.remaining,
       }),
       { 
         status: 200, 
         headers: { ...corsHeaders, "Content-Type": "application/json" } 
       }
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