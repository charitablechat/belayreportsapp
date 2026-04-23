import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, getClientIP, createRateLimitResponse } from "../_shared/rate-limiter.ts";

// Input validation schema
import { corsHeaders } from "../_shared/cors.ts";
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
  if (typeof notificationType !== 'string' || !['inspection_completed', 'training_completed', 'daily_assessment_completed', 'sync_conflict'].includes(notificationType)) return false;
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
    // Create service role client for privileged operations
    const supabaseServiceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate webhook secret by reading from database (same source as triggers)
    const webhookSecret = req.headers.get('x-webhook-secret');
    
    const { data: secretRow, error: secretError } = await supabaseServiceClient
      .from('webhook_config')
      .select('key_value')
      .eq('key_name', 'WEBHOOK_SECRET')
      .single();

    if (secretError || !secretRow?.key_value) {
      console.error('Failed to read webhook secret from database:', secretError);
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!webhookSecret || webhookSecret !== secretRow.key_value) {
      console.error('Invalid or missing webhook secret');
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Invalid webhook secret' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Webhook secret validated - request from database trigger');

    // Rate limiting - 20 push notifications per minute per IP
    const clientIP = getClientIP(req);
    const rateLimitResult = checkRateLimit(`push-notification:${clientIP}`, {
      maxRequests: 20,
      windowMs: 60 * 1000,
    });
    
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for IP: ${clientIP}`);
      return createRateLimitResponse(rateLimitResult.resetAt, corsHeaders);
    }
    
    // Parse and validate payload
    const payload = await req.json();

    if (!validateNotificationPayload(payload)) {
      console.error('Invalid payload:', payload);
      return new Response(
        JSON.stringify({ error: 'Invalid request payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // supabaseServiceClient already created above for webhook validation

    const { organizationId, notificationType, title, body, data } = payload;

    // Step 1: Get admin user_ids for the organization
    const { data: adminRoles, error: fetchRolesError } = await supabaseServiceClient
      .from('user_roles')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role', 'admin');

    if (fetchRolesError) {
      console.error('Error fetching super admins:', fetchRolesError);
      throw fetchRolesError;
    }

    const adminUserIds = (adminRoles || []).map((r: any) => r.user_id);
    console.log(`Found ${adminUserIds.length} super admins for organization ${organizationId}`);

    if (adminUserIds.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No super admins found for organization' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Fetch push subscriptions and notification preferences in parallel
    const [subsResult, prefsResult] = await Promise.all([
      supabaseServiceClient
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', adminUserIds),
      supabaseServiceClient
        .from('notification_preferences')
        .select('user_id, inspection_completed, training_completed, sync_conflicts')
        .in('user_id', adminUserIds),
    ]);

    if (subsResult.error) {
      console.error('Error fetching push subscriptions:', subsResult.error);
      throw subsResult.error;
    }
    if (prefsResult.error) {
      console.error('Error fetching notification preferences:', prefsResult.error);
      throw prefsResult.error;
    }

    // Step 3: Build per-admin lookup maps
    const subsByUser = new Map<string, any[]>();
    for (const sub of (subsResult.data || [])) {
      const list = subsByUser.get(sub.user_id) || [];
      list.push(sub);
      subsByUser.set(sub.user_id, list);
    }

    const prefsByUser = new Map<string, any>();
    for (const pref of (prefsResult.data || [])) {
      prefsByUser.set(pref.user_id, pref);
    }

    // Build unified admin list matching original structure
    const superAdmins = adminUserIds.map((uid: string) => ({
      user_id: uid,
      push_subscriptions: subsByUser.get(uid) || [],
      notification_preferences: prefsByUser.get(uid) ? [prefsByUser.get(uid)] : [],
    }));

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
        (notificationType === 'training_completed' && prefs?.training_completed !== false) ||
        (notificationType === 'daily_assessment_completed' && prefs?.inspection_completed !== false) ||
        (notificationType === 'sync_conflict' && prefs?.sync_conflicts !== false);

      if (!shouldSend) {
        console.log(`Skipping notification for user ${admin.user_id} due to preferences`);
        continue;
      }

      const subscriptions = admin.push_subscriptions || [];
      
      for (const subscription of subscriptions) {
        try {
          // Import web-push dynamically
          const webpush = (await import('npm:web-push@3.6.6')).default;
          
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
