import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const PushNotificationManager = () => {
  const { isSupported, isSubscribed, isLoading, permission, subscribe, unsubscribe } = usePushNotifications();
  const [preferences, setPreferences] = useState({
    inspection_completed: true,
    sync_conflicts: true,
  });
  const [loadingPrefs, setLoadingPrefs] = useState(true);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // Ignore "not found" error
        throw error;
      }

      if (data) {
        setPreferences({
          inspection_completed: data.inspection_completed ?? true,
          sync_conflicts: data.sync_conflicts ?? true,
        });
      }
    } catch (error) {
      console.error('Error loading notification preferences:', error);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const updatePreference = async (key: keyof typeof preferences, value: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setPreferences(prev => ({ ...prev, [key]: value }));

      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          [key]: value,
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      toast.success('Notification preferences updated');
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      toast.error('Failed to update preferences');
      // Revert the change
      loadPreferences();
    }
  };

  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellOff className="w-5 h-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Push notifications are not supported in your browser
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Push Notifications
        </CardTitle>
        <CardDescription>
          Receive notifications about inspections and sync status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Enable Push Notifications</Label>
            <p className="text-sm text-muted-foreground">
              {permission === 'denied' 
                ? 'Notification permission denied. Please enable in browser settings.'
                : isSubscribed 
                ? 'You will receive push notifications' 
                : 'Get notified about important updates'}
            </p>
          </div>
          <Button
            variant={isSubscribed ? 'outline' : 'default'}
            size="sm"
            onClick={isSubscribed ? unsubscribe : subscribe}
            disabled={isLoading || permission === 'denied'}
          >
            {isSubscribed ? (
              <>
                <BellOff className="w-4 h-4 mr-2" />
                Disable
              </>
            ) : (
              <>
                <Bell className="w-4 h-4 mr-2" />
                Enable
              </>
            )}
          </Button>
        </div>

        {isSubscribed && (
          <div className="space-y-4 pt-4 border-t">
            <h4 className="text-sm font-medium">Notification Preferences</h4>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="inspection-completed" className="cursor-pointer">
                Inspection Completed
              </Label>
              <Switch
                id="inspection-completed"
                checked={preferences.inspection_completed}
                onCheckedChange={(checked) => updatePreference('inspection_completed', checked)}
                disabled={loadingPrefs}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="sync-conflicts" className="cursor-pointer">
                Sync Conflicts
              </Label>
              <Switch
                id="sync-conflicts"
                checked={preferences.sync_conflicts}
                onCheckedChange={(checked) => updatePreference('sync_conflicts', checked)}
                disabled={loadingPrefs}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
