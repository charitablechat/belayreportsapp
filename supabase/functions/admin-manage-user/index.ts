import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';

import { corsHeaders } from "../_shared/cors.ts";
import { getSiteUrl } from "../_shared/site-url.ts";
interface CreateUserPayload {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  organizationId?: string;
  role?: 'admin' | 'inspector' | 'trainer';
}

interface UpdateUserPayload {
  userId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  role?: 'admin' | 'inspector' | 'trainer';
}

interface DeleteUserPayload {
  userId: string;
}

// ── M14: Server-side password floor — 8 chars + composition + common-password blocklist ──
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '123456789', '12345678',
  'qwerty', 'qwerty123', 'abc123', 'abcd1234', 'letmein', 'welcome',
  'welcome1', 'admin', 'admin123', 'iloveyou', 'monkey', 'football',
  'dragon', 'baseball', 'master', 'sunshine', 'princess', 'solo',
  'starwars', 'belayreports', 'belayreports123', 'ropeworks', 'ropeworks123', 'changeme', 'password!',
]);

function validatePasswordStrength(rawPassword: string | undefined | null): string | null {
  const pw = (rawPassword || '').trim();
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 'Password is too common — choose something unique';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) {
    return 'Password must contain at least one letter and one number';
  }
  return null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Create regular Supabase client for RLS checks
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Verify the requesting user is a super admin
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized: Not authenticated');
    }

    const { data: isSuperAdmin } = await supabase.rpc('is_admin_or_above');
    if (!isSuperAdmin) {
      throw new Error('Unauthorized: Admin access required');
    }

    const { action, ...payload } = await req.json();

    // ── C2: Role allowlist — block super_admin escalation ──
    const ALLOWED_ROLES = ['admin', 'inspector', 'trainer'] as const;
    if ((payload as any).role !== undefined && !ALLOWED_ROLES.includes((payload as any).role)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid role. Allowed: admin, inspector, trainer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Privilege-escalation gate: only super_admins may assign the 'admin'
    // (or 'super_admin') role via create/update. Plain admins can still
    // create/update inspector/trainer users.
    if (
      (action === 'create' || action === 'update') &&
      ((payload as any).role === 'admin' || (payload as any).role === 'super_admin')
    ) {
      const { data: callerIsSuperAdmin, error: superCheckErr } = await supabase.rpc('is_super_admin');
      if (superCheckErr || !callerIsSuperAdmin) {
        return new Response(
          JSON.stringify({ success: false, error: 'Forbidden: only super_admins can assign the admin role' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }


    console.log(`Admin action: ${action} by user ${user.id}`);

    // ── M12: Audit log helper — record every admin action via create_audit_log RPC ──
    async function logAdminAction(
      actionType: string,
      targetUserId: string,
      oldValues: Record<string, unknown> | null,
      newValues: Record<string, unknown> | null,
      metadata: Record<string, unknown> = {}
    ) {
      try {
        await supabaseAdmin.rpc('create_audit_log', {
          p_user_id: user.id,
          p_action_type: `admin.${actionType}`,
          p_table_name: 'auth.users',
          p_record_id: targetUserId,
          p_old_values: oldValues,
          p_new_values: newValues,
          p_metadata: { ...metadata, actor_email: user.email },
        });
      } catch (e) {
        console.warn('[admin-manage-user] audit log insert failed:', e);
      }
    }

    switch (action) {
      case 'create': {
        const { email, firstName, lastName, organizationId, role } = payload as CreateUserPayload;
        const password = (payload as CreateUserPayload).password?.trim();

        const pwError = validatePasswordStrength(password);
        if (pwError) {
          return new Response(
            JSON.stringify({ success: false, error: pwError }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create user in auth
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            first_name: firstName || '',
            last_name: lastName || '',
          },
        });

        if (createError) {
          console.error('Error creating user:', createError);
          throw createError;
        }

        console.log(`User created: ${newUser.user.id}`);

        // If organization provided, add membership
        if (organizationId) {
          const { error: memberError } = await supabaseAdmin
            .from('organization_members')
            .insert({
              user_id: newUser.user.id,
              organization_id: organizationId,
            });

          if (memberError) {
            console.error('Error adding organization member:', memberError);
          }
        }

        // If role provided, add to user_roles
        if (role) {
          const { error: roleError } = await supabaseAdmin
            .from('user_roles')
            .insert({
              user_id: newUser.user.id,
              organization_id: organizationId || null,
              role: role,
            });

          if (roleError) {
            console.error('Error adding user role:', roleError);
          }
        }

        // Send password reset email so the new user can set their own password.
        // The redirectTo URL is what the user lands on when they click the
        // reset link, so it must point at a real SPA host — never at the
        // raw Supabase project slug.
        try {
          const redirectTo = getSiteUrl();
          await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });
          console.log(`Password reset email sent to: ${email} (redirectTo=${redirectTo})`);
        } catch (emailError) {
          console.error('Failed to send password reset email:', emailError);
          // Don't fail the user creation if email fails
        }

        await logAdminAction(
          'create_user',
          newUser.user.id,
          null,
          { email, role: role ?? null, first_name: firstName ?? null, last_name: lastName ?? null },
          { organizationId: organizationId ?? null }
        );

        return new Response(
          JSON.stringify({ success: true, user: newUser.user }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        const { userId, email, firstName, lastName, role } = payload as UpdateUserPayload;
        const password = (payload as UpdateUserPayload).password?.trim() || '';

        if (password) {
          const pwError = validatePasswordStrength(password);
          if (pwError) {
            return new Response(
              JSON.stringify({ success: false, error: pwError }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }

        const updateData: any = {};
        if (email) updateData.email = email;
        if (password) updateData.password = password;
        if (firstName !== undefined || lastName !== undefined) {
          updateData.user_metadata = {
            first_name: firstName,
            last_name: lastName,
          };
        }

        const { data: updatedUser, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          userId,
          updateData
        );

        if (updateError) {
          console.error('Error updating user:', updateError);
          throw updateError;
        }

        console.log(`User updated: ${userId}`);

        // Update profile if names changed
        if (firstName !== undefined || lastName !== undefined) {
          const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update({
              first_name: firstName,
              last_name: lastName,
            })
            .eq('id', userId);

          if (profileError) {
            console.error('Error updating profile:', profileError);
          }
        }

        // ── H7: Conditional role rewrite — only mutate user_roles when role
        // explicitly changed; preserve per-organization role rows ──
        if (role !== undefined) {
          // Read current top-level role (organization_id IS NULL)
          const { data: currentRoleRow, error: currentRoleErr } = await supabaseAdmin
            .from('user_roles')
            .select('role')
            .eq('user_id', userId)
            .is('organization_id', null)
            .maybeSingle();

          if (currentRoleErr) {
            console.error('Error reading current top-level role:', currentRoleErr);
          }

          const currentRole = currentRoleRow?.role ?? null;

          if (currentRole === role) {
            console.log(`Role unchanged (${role}) for user ${userId}, skipping rewrite`);
          } else {
            // Scope delete to top-level rows only — preserve per-org roles
            const { error: deleteRolesError } = await supabaseAdmin
              .from('user_roles')
              .delete()
              .eq('user_id', userId)
              .is('organization_id', null);

            if (deleteRolesError) {
              console.error('Error removing old top-level role:', deleteRolesError);
            }

            const { error: roleError } = await supabaseAdmin
              .from('user_roles')
              .insert({
                user_id: userId,
                role: role,
                organization_id: null,
              });

            if (roleError) {
              console.error('Error setting new role:', roleError);
            }

            console.log(`Role updated from ${currentRole ?? 'none'} to ${role} for user: ${userId}`);
          }
        }

        await logAdminAction(
          'update_user',
          userId,
          null,
          {
            email: email ?? null,
            role: role ?? null,
            first_name: firstName ?? null,
            last_name: lastName ?? null,
            password_changed: !!password,
          },
          {}
        );

        return new Response(
          JSON.stringify({ success: true, user: updatedUser.user }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        const { userId } = payload as DeleteUserPayload;
        const hard = (payload as { hard?: boolean }).hard === true;

        // Prevent deleting self
        if (userId === user.id) {
          throw new Error('Cannot delete your own account');
        }

        // M10: Default path is reversible deactivation. Hard delete is opt-in
        // and requires true super-admin (not just admin-or-above).
        if (!hard) {
          const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            ban_duration: '876000h',
          });
          if (banError) {
            console.error('Error banning user during soft-delete:', banError);
            throw banError;
          }

          const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update({ is_active: false })
            .eq('id', userId);
          if (profileError) {
            console.error('Error deactivating profile during soft-delete:', profileError);
            throw profileError;
          }

          console.log(`User ${userId} deactivated by ${user.id} (soft delete)`);

          await logAdminAction(
            'deactivate_user',
            userId,
            { is_active: true },
            { is_active: false },
            { reason: 'soft_delete' }
          );

          return new Response(
            JSON.stringify({ success: true, deactivated: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Hard delete — require true super_admin
        const { data: isTrueSuperAdmin, error: superErr } = await supabase.rpc('is_super_admin');
        if (superErr || !isTrueSuperAdmin) {
          return new Response(
            JSON.stringify({ success: false, error: 'Hard delete requires super admin privileges' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (deleteError) {
          console.error('Error deleting user:', deleteError);
          throw deleteError;
        }

        console.log(`User ${userId} hard-deleted by ${user.id}`);

        await logAdminAction(
          'hard_delete_user',
          userId,
          null,
          null,
          { destructive: true }
        );

        return new Response(
          JSON.stringify({ success: true, hardDeleted: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'deactivate': {
        const { userId } = payload as { userId: string };

        if (userId === user.id) {
          throw new Error('Cannot deactivate your own account');
        }

        // Ban the user in auth (effectively permanent)
        const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        });

        if (banError) {
          console.error('Error banning user:', banError);
          throw banError;
        }

        // Set is_active = false in profiles
        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .update({ is_active: false })
          .eq('id', userId);

        if (profileError) {
          console.error('Error deactivating profile:', profileError);
          throw profileError;
        }

        console.log(`User deactivated: ${userId}`);

        await logAdminAction(
          'deactivate_user',
          userId,
          { is_active: true },
          { is_active: false },
          {}
        );

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'reactivate': {
        const { userId } = payload as { userId: string };

        // Unban the user
        const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          ban_duration: 'none',
        });

        if (unbanError) {
          console.error('Error unbanning user:', unbanError);
          throw unbanError;
        }

        // Set is_active = true in profiles
        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .update({ is_active: true })
          .eq('id', userId);

        if (profileError) {
          console.error('Error reactivating profile:', profileError);
          throw profileError;
        }

        console.log(`User reactivated: ${userId}`);

        await logAdminAction(
          'reactivate_user',
          userId,
          { is_active: false },
          { is_active: true },
          {}
        );

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list': {
        // Get all users from auth
        const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();

        if (listError) {
          console.error('Error listing users:', listError);
          throw listError;
        }

        // Get profiles and roles
        const { data: profiles } = await supabaseAdmin
          .from('profiles')
          .select('id, first_name, last_name, is_active');

        const { data: roles } = await supabaseAdmin
          .from('user_roles')
          .select('user_id, role, organization_id');

        const { data: memberships } = await supabaseAdmin
          .from('organization_members')
          .select('user_id, organization_id, organizations(name)');

        // Combine data
        const users = authUsers.users.map(authUser => {
          const profile = profiles?.find(p => p.id === authUser.id);
          const userRoles = roles?.filter(r => r.user_id === authUser.id) || [];
          const userMemberships = memberships?.filter(m => m.user_id === authUser.id) || [];
          const isSuperAdmin = userRoles.some(r => r.role === 'admin');

          return {
            id: authUser.id,
            email: authUser.email,
            firstName: profile?.first_name || '',
            lastName: profile?.last_name || '',
            createdAt: authUser.created_at,
            lastSignIn: authUser.last_sign_in_at,
            roles: userRoles,
            organizations: userMemberships.map(m => ({
              id: m.organization_id,
              name: (m.organizations as any)?.name || '',
            })),
            isSuperAdmin,
            isActive: profile?.is_active ?? true,
          };
        });

        return new Response(
          JSON.stringify({ success: true, users }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'grant_admin': {
        const { userId } = payload as { userId: string };

        // Only true super admins can mint new admins — matches the
        // "Only super admins can insert user roles" DB policy which the
        // service-role client would otherwise bypass.
        const { data: isTrueSuperAdmin, error: superErr } = await supabase.rpc('is_super_admin');
        if (superErr || !isTrueSuperAdmin) {
          return new Response(
            JSON.stringify({ success: false, error: 'Granting admin requires super admin privileges' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (userId === user.id) {
          throw new Error('Cannot grant admin to yourself');
        }


        const { data: existingRole } = await supabaseAdmin
          .from('user_roles')
          .select('id')
          .eq('user_id', userId)
          .eq('role', 'admin')
          .single();

        if (existingRole) {
          throw new Error('User is already an admin');
        }

        const { error: roleError } = await supabaseAdmin
          .from('user_roles')
          .insert({
            user_id: userId,
            role: 'admin',
            organization_id: null,
          });

        if (roleError) {
          console.error('Error granting admin:', roleError);
          throw roleError;
        }

        console.log(`Admin granted to user: ${userId}`);

        await logAdminAction(
          'grant_admin',
          userId,
          null,
          { role: 'admin' },
          {}
        );

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'revoke_admin': {
        const { userId } = payload as { userId: string };

        // Only true super admins can revoke admin — symmetric with grant_admin
        // and matches the DB policy restricting user_roles writes to super admins.
        const { data: isTrueSuperAdmin, error: superErr } = await supabase.rpc('is_super_admin');
        if (superErr || !isTrueSuperAdmin) {
          return new Response(
            JSON.stringify({ success: false, error: 'Revoking admin requires super admin privileges' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (userId === user.id) {
          throw new Error('Cannot revoke your own admin status');
        }


        const { error: deleteError } = await supabaseAdmin
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
          .eq('role', 'admin');

        if (deleteError) {
          console.error('Error revoking admin:', deleteError);
          throw deleteError;
        }

        console.log(`Admin revoked from user: ${userId}`);

        await logAdminAction(
          'revoke_admin',
          userId,
          { role: 'admin' },
          null,
          {}
        );

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('Error in admin-manage-user:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
