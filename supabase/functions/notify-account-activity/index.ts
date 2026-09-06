import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { corsHeaders } from "../_shared/cors.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM = "Belay Reports <noreply@mail.belayreports.com>";
const TZ = "America/Chicago";

type Mode = "new_account" | "daily_summary";

interface RequestBody {
  mode?: Mode;
  userId?: string;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const fmt = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: TZ,
      dateStyle: "medium",
      timeStyle: "short",
    }) + " CT";
  } catch {
    return String(iso);
  }
};

const providerOf = (user: any): string => {
  const providers: string[] = user?.app_metadata?.providers
    ?? (user?.app_metadata?.provider ? [user.app_metadata.provider] : []);
  if (providers.includes("google")) return "Google sign-in";
  if (providers.includes("email")) return "Email and password";
  return providers.join(", ") || "Unknown";
};

const shell = (title: string, inner: string) => `
<div style="font-family:Georgia,'Times New Roman',serif;color:#1b2430;max-width:640px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
  ${inner}
  <p style="font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:28px">
    Automatic notification from Belay Reports.
  </p>
</div>`;

const row = (label: string, value: string) => `
  <tr>
    <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-size:14px"><strong>${escapeHtml(value)}</strong></td>
  </tr>`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Webhook secret auth (same pattern as send-notification-email)
    const { data: secretRow, error: secretError } = await supabaseAdmin
      .from("webhook_config")
      .select("key_value")
      .eq("key_name", "ACCOUNT_NOTIFY_SECRET")
      .single();

    if (secretError || !secretRow?.key_value) {
      console.error("[notify-account-activity] Missing webhook secret:", secretError);
      return json({ success: false, error: "Server configuration error" }, 500);
    }

    if (req.headers.get("x-webhook-secret") !== secretRow.key_value) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const mode: Mode = body.mode === "daily_summary" ? "daily_summary" : "new_account";

    // Recipients
    const { data: recipientRows } = await supabaseAdmin
      .from("account_notify_recipients")
      .select("email")
      .eq("active", true);

    const recipients = (recipientRows ?? []).map((r: { email: string }) => r.email);
    if (recipients.length === 0) {
      console.log("[notify-account-activity] No active recipients configured; skipping.");
      return json({ success: true, skipped: "no_recipients" });
    }

    // Pull the account list once (admin API)
    const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersError) {
      console.error("[notify-account-activity] listUsers failed:", usersError);
      return json({ success: false, error: "Could not read accounts" }, 500);
    }
    const users = usersPage?.users ?? [];

    let subject = "";
    let html = "";

    if (mode === "new_account") {
      const user = users.find((u) => u.id === body.userId);
      if (!user) {
        console.warn("[notify-account-activity] Unknown userId:", body.userId);
        return json({ success: true, skipped: "unknown_user" });
      }

      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const name = [meta.first_name, meta.last_name].filter(Boolean).join(" ").trim()
        || (meta.full_name as string | undefined)
        || "(no name given)";

      subject = `New Belay Reports account: ${name}`;
      html = shell("A new account was created", `
        <table style="border-collapse:collapse">
          ${row("Name", name)}
          ${row("Email", user.email ?? "—")}
          ${row("Signed up with", providerOf(user))}
          ${row("Created", fmt(user.created_at))}
          ${row("Total accounts", String(users.length))}
        </table>
      `);
    } else {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const signedIn = users
        .filter((u) => u.last_sign_in_at && new Date(u.last_sign_in_at) >= since)
        .sort((a, b) =>
          new Date(b.last_sign_in_at!).getTime() - new Date(a.last_sign_in_at!).getTime()
        );

      const newIds = new Set(
        users.filter((u) => u.created_at && new Date(u.created_at) >= since).map((u) => u.id),
      );

      if (signedIn.length === 0 && newIds.size === 0) {
        await supabaseAdmin
          .from("account_notify_state")
          .update({ last_summary_sent_at: new Date().toISOString() })
          .eq("id", true);
        return json({ success: true, skipped: "no_activity" });
      }

      const rows = signedIn.map((u) => {
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
        const name = [meta.first_name, meta.last_name].filter(Boolean).join(" ").trim() || "—";
        const isNew = newIds.has(u.id);
        return `
          <tr>
            <td style="padding:6px 12px 6px 0;font-size:14px">${escapeHtml(name)}${isNew ? ' <span style="color:#166534;font-size:12px">(new)</span>' : ""}</td>
            <td style="padding:6px 12px 6px 0;font-size:14px">${escapeHtml(u.email ?? "—")}</td>
            <td style="padding:6px 0;font-size:14px;color:#6b7280">${escapeHtml(fmt(u.last_sign_in_at))}</td>
          </tr>`;
      }).join("");

      subject = `Belay Reports daily activity: ${signedIn.length} sign-in${signedIn.length === 1 ? "" : "s"}, ${newIds.size} new account${newIds.size === 1 ? "" : "s"}`;
      html = shell("Sign-ins in the last 24 hours", `
        <table style="border-collapse:collapse;width:100%">
          <tr>
            <th align="left" style="font-size:12px;color:#6b7280;padding-bottom:6px">Name</th>
            <th align="left" style="font-size:12px;color:#6b7280;padding-bottom:6px">Email</th>
            <th align="left" style="font-size:12px;color:#6b7280;padding-bottom:6px">Last sign-in</th>
          </tr>
          ${rows || '<tr><td colspan="3" style="font-size:14px">No sign-ins.</td></tr>'}
        </table>
        <p style="font-size:14px;margin-top:20px">Total accounts: <strong>${users.length}</strong></p>
      `);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? Deno.env.get("RESEND_API_KEY_1");
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      console.error("[notify-account-activity] Email credentials not configured");
      return json({ success: false, error: "Email not configured" }, 500);
    }

    const emailResponse = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({ from: FROM, to: recipients, subject, html }),
    });

    if (!emailResponse.ok) {
      const details = await emailResponse.text();
      console.error(`[notify-account-activity] Resend error [${emailResponse.status}]:`, details);
      return json(
        { success: false, error: "Provider request failed", status: emailResponse.status, details },
        emailResponse.status,
      );
    }

    if (mode === "daily_summary") {
      await supabaseAdmin
        .from("account_notify_state")
        .update({ last_summary_sent_at: new Date().toISOString() })
        .eq("id", true);
    }

    return json({ success: true, mode, recipients: recipients.length });
  } catch (error) {
    console.error("[notify-account-activity] Unhandled error:", error);
    return json({ success: false, error: (error as Error).message }, 500);
  }
});
