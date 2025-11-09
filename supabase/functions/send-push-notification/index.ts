import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  organizationId: string;
  notificationType: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: NotificationPayload = await req.json();
    console.log('Received notification request:', payload);

    const { organizationId, notificationType, title, body, data } = payload;

    // Get all super_admins for the organization with their push subscriptions
    const { data: superAdmins, error: rolesError } = await supabaseClient
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

    if (rolesError) {
      console.error('Error fetching super admins:', rolesError);
      throw rolesError;
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
          await supabaseClient
            .from('push_subscriptions')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', subscription.id);

        } catch (error: any) {
          console.error(`Failed to send push notification to subscription ${subscription.id}:`, error);
          failureCount++;
          
          // If subscription is invalid (410 Gone), remove it
          if (error.statusCode === 410) {
            console.log(`Removing invalid subscription ${subscription.id}`);
            await supabaseClient
              .from('push_subscriptions')
              .delete()
              .eq('id', subscription.id);
          }
        }
      }

      // Log notification
      await supabaseClient
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
