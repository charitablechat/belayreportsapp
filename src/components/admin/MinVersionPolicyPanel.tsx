/**
 * Admin panel for setting minimum required app version.
 * Shows live distribution from version_telemetry and warns about lockout impact.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Shield, AlertTriangle } from 'lucide-react';
import { isVersionNewer } from '@/lib/version-check';

export function MinVersionPolicyPanel() {
  const queryClient = useQueryClient();
  const [minVersion, setMinVersion] = useState('');
  const [recommendedVersion, setRecommendedVersion] = useState('');
  const [enforceHardReload, setEnforceHardReload] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch current policy
  const { data: policy } = useQuery({
    queryKey: ['app_version_policy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_version_policy')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Fetch telemetry distribution (active in last 7 days)
  const { data: telemetry } = useQuery({
    queryKey: ['version_telemetry_distribution'],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('version_telemetry')
        .select('client_version, last_seen')
        .gte('last_seen', sevenDaysAgo);
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (policy) {
      setMinVersion(policy.min_required_version || '');
      setRecommendedVersion(policy.recommended_version || '');
      setEnforceHardReload(policy.enforce_hard_reload || false);
      setMessage(policy.message || '');
    }
  }, [policy]);

  // Calculate lockout impact
  const lockoutStats = useMemo(() => {
    if (!minVersion || !telemetry) return { affected: 0, total: 0, percentage: 0 };
    const total = telemetry.length;
    let affected = 0;
    for (const row of telemetry) {
      if (!row.client_version) continue;
      if (isVersionNewer(row.client_version, minVersion, false)) {
        affected++;
      }
    }
    return {
      affected,
      total,
      percentage: total > 0 ? Math.round((affected / total) * 100) : 0,
    };
  }, [minVersion, telemetry]);

  const handleSaveClick = () => {
    if (enforceHardReload && lockoutStats.affected > 0) {
      setConfirmOpen(true);
    } else {
      void doSave();
    }
  };

  const doSave = async () => {
    setSaving(true);
    setConfirmOpen(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('app_version_policy')
        .upsert({
          id: 1,
          min_required_version: minVersion.trim() || null,
          recommended_version: recommendedVersion.trim() || null,
          enforce_hard_reload: enforceHardReload,
          message: message.trim() || null,
          updated_by: user?.id || null,
        });
      if (error) throw error;
      toast.success('Version policy updated');
      queryClient.invalidateQueries({ queryKey: ['app_version_policy'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('app_version_policy')
        .upsert({
          id: 1,
          min_required_version: null,
          recommended_version: null,
          enforce_hard_reload: false,
          message: null,
        });
      if (error) throw error;
      toast.success('Version policy cleared');
      setMinVersion('');
      setRecommendedVersion('');
      setEnforceHardReload(false);
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['app_version_policy'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to clear policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Minimum Version Policy
          </CardTitle>
          <CardDescription>
            Force users below a minimum version to refresh. Use with caution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="min-version">Minimum Required Version</Label>
              <Input
                id="min-version"
                placeholder="e.g. 4.8.0"
                value={minVersion}
                onChange={(e) => setMinVersion(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Clients on older versions will see refresh prompt. Leave empty to disable.
              </p>
            </div>
            <div>
              <Label htmlFor="rec-version">Recommended Version</Label>
              <Input
                id="rec-version"
                placeholder="e.g. 4.9.0"
                value={recommendedVersion}
                onChange={(e) => setRecommendedVersion(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Informational only — not enforced.
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="message">Custom Message (optional)</Label>
            <Textarea
              id="message"
              placeholder="This version is no longer supported. Please refresh to continue."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between border border-border rounded-md p-3">
            <div>
              <Label htmlFor="hard-mode" className="font-medium">Hard Enforcement</Label>
              <p className="text-xs text-muted-foreground">
                Block app entirely with a full-screen modal. Soft mode shows a banner only.
              </p>
            </div>
            <Switch
              id="hard-mode"
              checked={enforceHardReload}
              onCheckedChange={setEnforceHardReload}
            />
          </div>

          {minVersion && (
            <div className={`flex items-start gap-2 p-3 rounded-md border ${
              lockoutStats.percentage > 50
                ? 'bg-destructive/10 border-destructive/30 text-destructive'
                : lockoutStats.percentage > 0
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
                : 'bg-muted border-border text-muted-foreground'
            }`}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                <strong>{lockoutStats.affected}</strong> of {lockoutStats.total} active users (
                <strong>{lockoutStats.percentage}%</strong>) are below this version
                {enforceHardReload && lockoutStats.affected > 0 && ' and will be locked out until they refresh'}.
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSaveClick} disabled={saving}>
              {saving ? 'Saving...' : 'Save Policy'}
            </Button>
            {policy?.min_required_version && (
              <Button variant="outline" onClick={handleClear} disabled={saving}>
                Clear Policy
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Hard Enforcement</AlertDialogTitle>
            <AlertDialogDescription>
              This will block <strong>{lockoutStats.affected}</strong> active user
              {lockoutStats.affected !== 1 ? 's' : ''} ({lockoutStats.percentage}%) from using the app
              until they refresh. Their unsaved work will be synced first. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doSave} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Apply Hard Enforcement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
