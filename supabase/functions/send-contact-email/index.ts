import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ContactEmailRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: string;
  website?: string; // Honeypot field - should always be empty
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Rate limiting: 3 contact form submissions per IP per hour
    const clientIP = getClientIP(req);
    const rateLimit = checkRateLimit(`contact:${clientIP}`, {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000 // 1 hour
    });

    if (!rateLimit.allowed) {
      console.warn(`[Rate Limit] IP ${clientIP} exceeded contact form limit`);
      return createRateLimitResponse(rateLimit.resetAt, corsHeaders);
    }

    console.log(`[Rate Limit] IP ${clientIP} - ${rateLimit.remaining} requests remaining`);

    const { name, email, subject, message, attachmentUrl, attachmentName, attachmentType, website }: ContactEmailRequest = await req.json();

    // Honeypot check - if the hidden field is filled, it's likely a bot
    if (website && website.trim() !== '') {
      console.warn(`[Honeypot] Bot detected from IP ${clientIP} - honeypot field filled`);
      // Return success to not tip off the bot, but don't send the email
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Validate attachment if provided
    if (attachmentUrl) {
      // Stricter rate limit for attachments: 1 per hour
      const attachmentRateLimit = checkRateLimit(`contact-attachment:${clientIP}`, {
        maxRequests: 1,
        windowMs: 60 * 60 * 1000,
      });
      if (!attachmentRateLimit.allowed) {
        return createRateLimitResponse(attachmentRateLimit.resetAt, corsHeaders);
      }

      // Verify attachment URL is from our storage bucket
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      if (!attachmentUrl.startsWith(supabaseUrl) || !attachmentUrl.includes("/contact-attachments/")) {
        return new Response(
          JSON.stringify({ error: "Invalid attachment source" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Validate file size via HEAD request (10MB limit)
      try {
        const headResponse = await fetch(attachmentUrl, { method: "HEAD" });
        if (headResponse.ok) {
          const contentLength = parseInt(headResponse.headers.get("content-length") || "0");
          if (contentLength > 10 * 1024 * 1024) {
            return new Response(
              JSON.stringify({ error: "Attachment too large (max 10MB)" }),
              { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
            );
          }
        }
      } catch (e) {
        console.warn("Could not verify attachment size:", e);
      }
    }

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Validate name length
    if (name.length > 100) {
      return new Response(
        JSON.stringify({ error: "Name too long (max 100 characters)" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Validate subject (must be one of allowed values)
    const allowedSubjects = ['bug', 'feature', 'question', 'other'];
    if (!allowedSubjects.includes(subject)) {
      return new Response(
        JSON.stringify({ error: "Invalid subject type" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Validate message length
    if (message.length > 1000) {
      return new Response(
        JSON.stringify({ error: "Message too long (max 1000 characters)" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const subjectMap: Record<string, string> = {
      bug: "Bug Report",
      feature: "Feature Request",
      question: "Question",
      other: "Other",
    };

    const subjectText = subjectMap[subject] || subject;

    // Send email using Resend API directly
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    // Send email to developer (using verified test email for Resend test mode)
    // NOTE: For production, verify your domain at resend.com/domains and update the 'from' address
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ACCT Inspector <onboarding@resend.dev>",
        to: ["kale@myaisummit.dev"], // Using verified email for test mode
        subject: `[ACCT Inspector] ${subjectText} from ${name}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})</p>
          <p><strong>Subject:</strong> ${escapeHtml(subjectText)}</p>
          <p><strong>Message:</strong></p>
          <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
          ${attachmentUrl ? `
            <h3>Attached File:</h3>
            <p><strong>File:</strong> ${escapeHtml(attachmentName || 'attachment')}</p>
            <p><a href="${escapeHtml(attachmentUrl)}" style="color: #0066cc; text-decoration: underline;">
              📎 Download/View Attachment
            </a></p>
            ${attachmentType?.startsWith('image/') ? `
              <img src="${escapeHtml(attachmentUrl)}" alt="Attachment" style="max-width: 600px; height: auto; margin-top: 10px; border: 1px solid #ddd; border-radius: 4px;" />
            ` : ''}
          ` : ''}
          <hr>
          <p style="color: #666; font-size: 12px;">
            Reply to this email to respond directly to ${escapeHtml(email)}
          </p>
        `,
        reply_to: email,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Resend API error:", errorText);
      throw new Error(`Failed to send email: ${errorText}`);
    }

    const emailResult = await emailResponse.json();
    console.log("Contact email sent successfully:", emailResult);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-contact-email function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
