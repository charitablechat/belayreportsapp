import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey);

    const email = "kale@belayreports.com";
    const password = "Ilovedawn07";

    // Find existing user
    let userId: string | null = null;
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) throw listErr;
    const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (found) {
      userId = found.id;
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
      });
      if (updErr) throw updErr;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr) throw createErr;
      userId = created.user!.id;
    }

    // Ensure profile row exists (FK target for inspections/trainings/etc.)
    await admin
      .from("profiles")
      .upsert(
        { id: userId, first_name: "Kale", is_active: true },
        { onConflict: "id", ignoreDuplicates: true },
      );

    // Grant super_admin role (org-less)
    const { data: existingRole } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .is("organization_id", null)
      .maybeSingle();

    if (!existingRole) {
      const { error: roleErr } = await admin
        .from("user_roles")
        .insert({ user_id: userId, role: "super_admin", organization_id: null });
      if (roleErr) throw roleErr;
    }

    return new Response(JSON.stringify({ ok: true, userId }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
