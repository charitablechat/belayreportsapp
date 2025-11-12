import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
interface NotificationPayload {
  organizationId: string;
  notificationType: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

function validateNotificationPayload(payload: any): payload is NotificationPayload {
  if (!payload || typeof payload !== 'object') return false;
  
  const { organizationId, notificationType, title, body } = payload;
  
  // Validate required fields
  if (typeof organizationId !== 'string' || organizationId.length === 0 || organizationId.length > 100) return false;
  if (typeof notificationType !== 'string' || !['inspection_completed', 'sync_conflict'].includes(notificationType)) return false;
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) return false;
  if (typeof body !== 'string' || body.length === 0 || body.length > 500) return false;
  
  // Validate optional data field
  if (payload.data !== undefined && (typeof payload.data !== 'object' || Array.isArray(payload.data))) return false;
  
  return true;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header for user authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's JWT for authorization check
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error('Authentication failed:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse and validate payload
    const payload = await req.json();
    console.log('Received notification request from user:', user.id);

    if (!validateNotificationPayload(payload)) {
      console.error('Invalid payload:', payload);
      return new Response(
        JSON.stringify({ error: 'Invalid request payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user is super_admin for the organization
    const { data: userRoles, error: rolesError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', payload.organizationId)
      .eq('role', 'super_admin')
      .single();

    if (rolesError || !userRoles) {
      console.error('User is not a super_admin for this organization:', user.id, payload.organizationId);
      return new Response(
        JSON.stringify({ error: 'Forbidden - Super admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Authorization verified for super_admin:', user.id);

    // Create service role client for privileged operations
    const supabaseServiceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { organizationId, notificationType, title, body, data } = payload;

    // Get all super_admins for the organization with their push subscriptions
    const { data: superAdmins, error: fetchRolesError } = await supabaseServiceClient
      .from('user_roles')
      .select(`
        user_id,
        push_subscriptions (
          id,
          endpoint,
          p256dh,
          auth
        ),
        notification_preferences (
          inspection_completed,
          sync_conflicts
        )
      `)
      .eq('organization_id', organizationId)
      .eq('role', 'super_admin');

    if (fetchRolesError) {
      console.error('Error fetching super admins:', fetchRolesError);
      throw fetchRolesError;
    }

    console.log(`Found ${superAdmins?.length || 0} super admins for organization ${organizationId}`);

    if (!superAdmins || superAdmins.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No super admins found for organization' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('VAPID keys not configured');
      throw new Error('VAPID keys not configured');
    }

    let successCount = 0;
    let failureCount = 0;

    // Send push notifications to all super admins
    for (const admin of superAdmins) {
      // Check notification preferences
      const prefs = admin.notification_preferences?.[0];
      const shouldSend = 
        (notificationType === 'inspection_completed' && prefs?.inspection_completed !== false) ||
        (notificationType === 'sync_conflict' && prefs?.sync_conflicts !== false);

      if (!shouldSend) {
        console.log(`Skipping notification for user ${admin.user_id} due to preferences`);
        continue;
      }

      const subscriptions = admin.push_subscriptions || [];
      
      for (const subscription of subscriptions) {
        try {
          // Import web-push dynamically
          const webpush = (await import('https://esm.sh/web-push@3.6.6')).default;
          
          webpush.setVapidDetails(
            'mailto:noreply@ropeaccounting.com',
            vapidPublicKey,
            vapidPrivateKey
          );

          const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          };

          const notificationPayload = JSON.stringify({
            title,
            body,
            data: data || {},
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192-maskable.png',
          });

          await webpush.sendNotification(pushSubscription, notificationPayload);
          
          console.log(`Push notification sent successfully to subscription ${subscription.id}`);
          successCount++;

          // Update last_used_at
          await supabaseServiceClient
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', subscription.id);

        } catch (error: any) {
          console.error(`Failed to send push notification to subscription ${subscription.id}:`, error);
          failureCount++;
          
          // If subscription is invalid (410 Gone), remove it
          if (error.statusCode === 410) {
            console.log(`Removing invalid subscription ${subscription.id}`);
            await supabaseServiceClient
              .from('push_subscriptions')
              .delete()
              .eq('id', subscription.id);
          }
        }
      }

      // Log notification
      await supabaseServiceClient
        .from('notifications_log')
        .insert({
          user_id: admin.user_id,
          notification_type: notificationType,
          title,
          body,
          data: data || {},
          status: 'sent',
        });
    }

    console.log(`Notification delivery complete: ${successCount} sent, ${failureCount} failed`);

    return new Response(
      JSON.stringify({ 
        message: 'Notifications processed',
        successCount,
        failureCount 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Error in send-push-notification function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
