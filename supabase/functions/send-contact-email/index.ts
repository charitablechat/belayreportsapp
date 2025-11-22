import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

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
  imageUrl?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { name, email, subject, message, imageUrl }: ContactEmailRequest = await req.json();

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

    // Send email to developer
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ACCT Inspector <onboarding@resend.dev>",
        to: ["developer@example.com"], // Replace with actual developer email
        subject: `[ACCT Inspector] ${subjectText} from ${name}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>From:</strong> ${name} (${email})</p>
          <p><strong>Subject:</strong> ${subjectText}</p>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, "<br>")}</p>
          ${imageUrl ? `
            <h3>Attached Image:</h3>
            <p><a href="${imageUrl}">View full size image</a></p>
            <img src="${imageUrl}" alt="Attachment" style="max-width: 600px; height: auto; margin-top: 10px; border: 1px solid #ddd; border-radius: 4px;" />
          ` : ''}
          <hr>
          <p style="color: #666; font-size: 12px;">
            Reply to this email to respond directly to ${email}
          </p>
        `,
        reply_to: email,
      }),
    });

    if (!emailResponse.ok) {
      const error = await emailResponse.text();
      throw new Error(`Failed to send email: ${error}`);
    }

    console.log("Contact email sent successfully");

    // Send confirmation email to user
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ACCT Inspector <onboarding@resend.dev>",
        to: [email],
        subject: "We received your message!",
        html: `
          <h1>Thank you for contacting us, ${name}!</h1>
          <p>We have received your message regarding: <strong>${subjectText}</strong></p>
          <p>Our team will review your message and get back to you as soon as possible.</p>
          <p><strong>Your message:</strong></p>
          <p>${message.replace(/\n/g, "<br>")}</p>
          <hr>
          <p>Best regards,<br>The ACCT Inspector Team</p>
        `,
      }),
    });

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
