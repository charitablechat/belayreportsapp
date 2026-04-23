import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";

import { corsHeaders } from "../_shared/cors.ts";
interface ContactEmailRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
  attachmentPath?: string;
  attachmentName?: string;
  attachmentType?: string;
  website?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Rate limiting
    const clientIP = getClientIP(req);
    const rateLimit = checkRateLimit(`contact:${clientIP}`, {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      console.warn(`[Rate Limit] IP ${clientIP} exceeded contact form limit`);
      return createRateLimitResponse(rateLimit.resetAt, corsHeaders);
    }

    console.log(`[Rate Limit] IP ${clientIP} - ${rateLimit.remaining} requests remaining`);

    const { name, email, subject, message, attachmentPath, attachmentName, attachmentType, website }: ContactEmailRequest = await req.json();

    // Honeypot check
    if (website && website.trim() !== '') {
      console.warn(`[Honeypot] Bot detected from IP ${clientIP}`);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (name.length > 100) {
      return new Response(JSON.stringify({ error: "Name too long (max 100 characters)" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const allowedSubjects = ['bug', 'feature', 'question', 'other'];
    if (!allowedSubjects.includes(subject)) {
      return new Response(JSON.stringify({ error: "Invalid subject type" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (message.length > 1000) {
      return new Response(JSON.stringify({ error: "Message too long (max 1000 characters)" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Download attachment via service role if path provided
    let attachmentBase64: string | undefined;
    if (attachmentPath) {
      // Rate limit attachments
      const attachmentRateLimit = checkRateLimit(`contact-attachment:${clientIP}`, {
        maxRequests: 1,
        windowMs: 60 * 60 * 1000,
      });
      if (!attachmentRateLimit.allowed) {
        return createRateLimitResponse(attachmentRateLimit.resetAt, corsHeaders);
      }

      // Validate path doesn't contain traversal
      if (attachmentPath.includes('..') || attachmentPath.startsWith('/')) {
        return new Response(JSON.stringify({ error: "Invalid attachment path" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      try {
        const supabaseAdmin = createClient(
          Deno.env.get("SUPABASE_URL") || "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
        );

        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
          .from("contact-attachments")
          .download(attachmentPath);

        if (downloadError) {
          console.warn("Failed to download attachment:", downloadError.message);
        } else if (fileData) {
          // Validate size (10MB)
          if (fileData.size > 10 * 1024 * 1024) {
            return new Response(JSON.stringify({ error: "Attachment too large (max 10MB)" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            });
          }

          const arrayBuffer = await fileData.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          attachmentBase64 = btoa(binary);
          console.log(`Attachment downloaded and encoded: ${attachmentName} (${uint8Array.length} bytes)`);
        }
      } catch (e) {
        console.warn("Could not download attachment:", e);
      }
    }

    const subjectMap: Record<string, string> = {
      bug: "Bug Report",
      feature: "Feature Request",
      question: "Question",
      other: "Other",
    };

    const makeWebhookUrl = Deno.env.get("MAKE_CONTACT_WEBHOOK_URL");
    if (!makeWebhookUrl) {
      throw new Error("MAKE_CONTACT_WEBHOOK_URL not configured");
    }

    const payload = {
      name,
      email,
      subject: subjectMap[subject] || subject,
      message,
      attachmentBase64,
      attachmentName,
      attachmentType,
      timestamp: new Date().toISOString(),
    };

    console.log("Sending payload to Make.com (attachment size:", attachmentBase64 ? `${attachmentBase64.length} chars` : "none", ")");

    const webhookResponse = await fetch(makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text();
      console.error("Make.com webhook error:", errorText);
      throw new Error(`Make.com webhook failed: ${webhookResponse.status}`);
    }

    console.log("Contact form sent to Make.com successfully");

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-contact-email function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
