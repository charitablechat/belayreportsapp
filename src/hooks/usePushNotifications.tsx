import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PushNotificationState {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  permission: NotificationPermission;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const usePushNotifications = (): PushNotificationState => {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);

  useEffect(() => {
    // Check if push notifications are supported
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    setIsSupported(supported);

    if (supported) {
      fetchVapidKey();
      checkSubscription();
      setPermission(Notification.permission);
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchVapidKey = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-vapid-public-key');
      
      if (error) throw error;
      
      setVapidPublicKey(data.publicKey);
      
      if (import.meta.env.DEV) {
        console.log('[Push Notifications] VAPID public key loaded');
      }
    } catch (error) {
      console.error('Error fetching VAPID public key:', error);
    }
  };

  const checkSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
      
      if (import.meta.env.DEV) {
        console.log('[Push Notifications] Current subscription:', subscription);
      }
    } catch (error) {
      console.error('Error checking push subscription:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const subscribe = async () => {
    if (!isSupported) {
      return;
    }

    if (!vapidPublicKey) {
      return;
    }

    setIsLoading(true);

    try {
      // Request notification permission
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        setIsLoading(false);
        return;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push notifications
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });

      if (import.meta.env.DEV) {
        console.log('[Push Notifications] New subscription:', subscription);
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Store subscription in database
      const subscriptionData = subscription.toJSON();
      const { error } = await supabase
        .from('push_subscriptions')
        .insert({
          user_id: user.id,
          endpoint: subscriptionData.endpoint!,
          p256dh: subscriptionData.keys!.p256dh,
          auth: subscriptionData.keys!.auth,
          user_agent: navigator.userAgent,
        });

      if (error) throw error;

      setIsSubscribed(true);

      if (import.meta.env.DEV) {
        console.log('[Push Notifications] Subscription saved to database');
      }
    } catch (error) {
      console.error('Error subscribing to push notifications:', error);
    } finally{
      setIsLoading(false);
    }
  };

  const unsubscribe = async () => {
    if (!isSupported) return;

    setIsLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();

        // Remove from database
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const subscriptionData = subscription.toJSON();
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('user_id', user.id)
            .eq('endpoint', subscriptionData.endpoint!);
        }

        setIsSubscribed(false);

        if (import.meta.env.DEV) {
          console.log('[Push Notifications] Unsubscribed successfully');
        }
      }
    } catch (error) {
      console.error('Error unsubscribing from push notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isSupported,
    isSubscribed,
    isLoading,
    permission,
    subscribe,
    unsubscribe,
  };
};
