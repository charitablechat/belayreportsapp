import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

import { corsHeaders } from "../_shared/cors.ts";
interface EmailRequest {
  trainingId: string;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Rate limiting: 5 emails per user per hour
    const rateLimit = checkRateLimit(`email:training:${user.id}`, {
      maxRequests: 5,
      windowMs: 60 * 60 * 1000 // 1 hour
    });

    if (!rateLimit.allowed) {
      console.warn(`[Rate Limit] User ${user.id} exceeded email sending limit`);
      return createRateLimitResponse(rateLimit.resetAt, corsHeaders);
    }

    console.log(`[Rate Limit] User ${user.id} - ${rateLimit.remaining} emails remaining`);

    const { trainingId, recipientEmail, recipientName, message }: EmailRequest = await req.json();

    // Validate input
    if (!trainingId || !recipientEmail) {
      throw new Error("Training ID and recipient email are required");
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      throw new Error("Invalid email format");
    }

    // Get training data and verify access
    const { data: training, error: trainingError } = await supabase
      .from("trainings")
      .select("*, profiles:inspector_id(first_name, last_name)")
      .eq("id", trainingId)
      .single();

    if (trainingError || !training) {
      throw new Error("Training not found");
    }

    // Check if user has access (is the inspector or super admin)
    const { data: isSuperAdmin } = await supabase.rpc("is_admin_or_above");
    
    if (training.inspector_id !== user.id && !isSuperAdmin) {
      throw new Error("Unauthorized to access this training");
    }

    // Get the most recent PDF report
    const { data: report, error: reportError } = await supabase
      .from("training_reports")
      .select("pdf_url")
      .eq("training_id", trainingId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();

    if (reportError || !report) {
      throw new Error("No training report found. Please generate the PDF first.");
    }

    // Create a signed URL for the PDF (valid for 72 hours)
    const pdfPath = report.pdf_url.split("/").slice(-2).join("/");
    const { data: urlData, error: urlError } = await supabase
      .storage
      .from("inspection-reports")
      .createSignedUrl(pdfPath, 259200); // 72 hours in seconds

    if (urlError || !urlData) {
      throw new Error("Failed to create PDF download link");
    }

    // Get sender's name
    const senderName = training.profiles 
      ? `${training.profiles.first_name || ''} ${training.profiles.last_name || ''}`.trim() || 'Belay Reports'
      : 'Belay Reports';

    // Format dates
    const startDate = new Date(training.start_date).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const endDate = new Date(training.end_date).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    // Compose email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; }
          .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: 600; }
          .details { background: #f7f9fc; padding: 20px; border-radius: 6px; margin: 20px 0; }
          .details-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e0e0e0; }
          .details-row:last-child { border-bottom: none; }
          .label { font-weight: 600; color: #555; }
          .message { background: #fff9e6; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; font-style: italic; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">Training Report</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Belay Reports - Professional Training Services</p>
          </div>
          
          <div class="content">
            <p>Hello${recipientName ? ` ${recipientName}` : ''},</p>
            
            <p>${senderName} has shared a training report with you.</p>
            
            <div class="details">
              <div class="details-row">
                <span class="label">Organization:</span>
                <span>${training.organization}</span>
              </div>
              <div class="details-row">
                <span class="label">Training Dates:</span>
                <span>${startDate} - ${endDate}</span>
              </div>
              ${training.trainer_of_record ? `
              <div class="details-row">
                <span class="label">Trainer:</span>
                <span>${training.trainer_of_record}</span>
              </div>
              ` : ''}
            </div>
            
            ${message ? `
            <div class="message">
              <strong>Message from ${senderName}:</strong><br>
              ${message.replace(/\n/g, '<br>')}
            </div>
            ` : ''}
            
            <p style="text-align: center;">
              <a href="${urlData.signedUrl}" class="button">Download Training Report (PDF)</a>
            </p>
            
            <p style="font-size: 12px; color: #666;">
              <strong>Note:</strong> This download link will expire in 7 days. 
              If you need access after that, please contact ${senderName}.
            </p>
          </div>
          
          <div class="footer">
            <p><strong>Belay Reports</strong></p>
            <p>Professional Rope Course Inspection & Training Services</p>
            <p>ACCT Accredited Vendor</p>
            <p style="font-size: 11px; margin-top: 15px; color: #999;">
              This email was sent from an automated system. 
              If you believe you received this in error, please disregard.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend API
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "Belay Reports <onboarding@resend.dev>",
        to: [recipientEmail],
        subject: `Training Report - ${training.organization}`,
        html: emailHtml,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Resend API error:", errorText);
      throw new Error(`Failed to send email: ${errorText}`);
    }

    const emailResult = await emailResponse.json();
    console.log("Email sent successfully:", emailResult);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Training report sent successfully",
        emailId: emailResult?.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in send-training-pdf-email:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to send training report",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
