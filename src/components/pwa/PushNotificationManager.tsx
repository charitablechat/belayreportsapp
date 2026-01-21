import { useEffect, useState } from 'react';
import { Bell, BellOff, Mail, MailX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const PushNotificationManager = () => {
  const { isSupported, isSubscribed, isLoading, permission, subscribe, unsubscribe } = usePushNotifications();
  const [preferences, setPreferences] = useState({
    inspection_completed: true,
    training_completed: true,
  });
  const [emailPreferences, setEmailPreferences] = useState({
    email_notifications_enabled: false,
    email_inspection_completed: true,
    email_training_completed: true,
    email_address: '',
  });
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Store the auth email
      setAuthEmail(user.email || null);

      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setPreferences({
          inspection_completed: data.inspection_completed ?? true,
          training_completed: data.training_completed ?? true,
        });
        setEmailPreferences({
          email_notifications_enabled: data.email_notifications_enabled ?? false,
          email_inspection_completed: data.email_inspection_completed ?? true,
          email_training_completed: data.email_training_completed ?? true,
          email_address: data.email_address ?? '',
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

    } catch (error) {
      console.error('Error updating notification preferences:', error);
      loadPreferences();
    }
  };

  const updateEmailPreference = async (key: keyof typeof emailPreferences, value: boolean | string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setEmailPreferences(prev => ({ ...prev, [key]: value }));

      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          [key]: value,
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      if (key === 'email_notifications_enabled') {
        toast.success(value ? 'Email notifications enabled' : 'Email notifications disabled');
      }

    } catch (error) {
      console.error('Error updating email preferences:', error);
      loadPreferences();
    }
  };

  const saveEmailAddress = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailPreferences.email_address)) {
        toast.error('Please enter a valid email address');
        return;
      }

      setSavingEmail(true);

      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          email_address: emailPreferences.email_address,
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;
      toast.success('Email address saved');

    } catch (error) {
      console.error('Error saving email address:', error);
      toast.error('Failed to save email address');
    } finally {
      setSavingEmail(false);
    }
  };

  // Determine which email will be used
  const effectiveEmail = emailPreferences.email_address || authEmail;
  const isUsingAuthEmail = !emailPreferences.email_address && authEmail;

  return (
    <div className="space-y-4">
      {/* Push Notifications Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Receive push notifications about inspections and sync status
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isSupported ? (
            <p className="text-sm text-muted-foreground">
              Push notifications are not supported in your browser
            </p>
          ) : (
            <>
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
                  <h4 className="text-sm font-medium">Push Notification Preferences</h4>
                  
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
                    <Label htmlFor="training-completed" className="cursor-pointer">
                      Training Completed
                    </Label>
                    <Switch
                      id="training-completed"
                      checked={preferences.training_completed}
                      onCheckedChange={(checked) => updatePreference('training_completed', checked)}
                      disabled={loadingPrefs}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Email Notifications Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Email Notifications
          </CardTitle>
          <CardDescription>
            Receive email alerts when reports are completed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            {/* Show current email being used */}
            {effectiveEmail && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm">
                  <span className="text-muted-foreground">Notifications will be sent to: </span>
                  <span className="font-medium">{effectiveEmail}</span>
                  {isUsingAuthEmail && (
                    <span className="text-muted-foreground"> (your account email)</span>
                  )}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email-address">Custom Email Address (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Leave empty to use your account email ({authEmail || 'loading...'})
              </p>
              <div className="flex gap-2">
                <Input
                  id="email-address"
                  type="email"
                  placeholder="Enter a different email address"
                  value={emailPreferences.email_address}
                  onChange={(e) => setEmailPreferences(prev => ({ ...prev, email_address: e.target.value }))}
                  disabled={loadingPrefs}
                />
                <Button 
                  variant="outline" 
                  onClick={saveEmailAddress}
                  disabled={savingEmail || !emailPreferences.email_address}
                >
                  {savingEmail ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="space-y-0.5">
                <Label>Enable Email Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  {emailPreferences.email_notifications_enabled 
                    ? 'You will receive email notifications' 
                    : 'Get emailed about important updates'}
                </p>
              </div>
              <Button
                variant={emailPreferences.email_notifications_enabled ? 'outline' : 'default'}
                size="sm"
                onClick={() => updateEmailPreference('email_notifications_enabled', !emailPreferences.email_notifications_enabled)}
                disabled={loadingPrefs || !effectiveEmail}
              >
                {emailPreferences.email_notifications_enabled ? (
                  <>
                    <MailX className="w-4 h-4 mr-2" />
                    Disable
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4 mr-2" />
                    Enable
                  </>
                )}
              </Button>
            </div>
          </div>

          {emailPreferences.email_notifications_enabled && (
            <div className="space-y-4 pt-4 border-t">
              <h4 className="text-sm font-medium">Email Notification Preferences</h4>
              
              <div className="flex items-center justify-between">
                <Label htmlFor="email-inspection-completed" className="cursor-pointer">
                  Inspection Completed
                </Label>
                <Switch
                  id="email-inspection-completed"
                  checked={emailPreferences.email_inspection_completed}
                  onCheckedChange={(checked) => updateEmailPreference('email_inspection_completed', checked)}
                  disabled={loadingPrefs}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="email-training-completed" className="cursor-pointer">
                  Training Completed
                </Label>
                <Switch
                  id="email-training-completed"
                  checked={emailPreferences.email_training_completed}
                  onCheckedChange={(checked) => updateEmailPreference('email_training_completed', checked)}
                  disabled={loadingPrefs}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};