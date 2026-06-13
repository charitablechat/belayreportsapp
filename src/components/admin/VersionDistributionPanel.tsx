import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, AlertTriangle, Rocket } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useVersionStatus } from '@/hooks/useVersionStatus';
import { isVersionNewer } from '@/lib/version-check';

// Canonical user-facing domain. Used as a fallback only when the panel is
// loaded from a non-production host (e.g., Lovable preview/local dev).
const CANONICAL_VERSION_URL = 'https://rwreports.com/version.json';
const PRODUCTION_HOSTS = new Set([
  'rwreports.com',
  'www.rwreports.com',
  'belayreports.com',
]);

function resolvePublishedVersionUrl(): string {
  try {
    if (typeof window !== 'undefined' && PRODUCTION_HOSTS.has(window.location.hostname)) {
      return '/version.json'; // same-origin — no CORS, always freshest
    }
  } catch {
    // ignore
  }
  return CANONICAL_VERSION_URL;
}

function usePublishedVersion(enabled: boolean) {
  const [published, setPublished] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const url = resolvePublishedVersionUrl();
        const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.version === 'string') setPublished(data.version);
      } catch {
        // ignore — silent fallback
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);
  return published;
}

interface TelemetryRow {
  client_version: string;
  server_version: string | null;
  platform: string;
  is_standalone: boolean;
  last_seen: string;
  user_id: string;
}

export const VersionDistributionPanel = () => {
  const { installed, deployed, environment } = useVersionStatus({ forceOnMount: true });
  const isPreview = environment === 'preview';
  const publishedVersion = usePublishedVersion(isPreview);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-version-telemetry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('version_telemetry')
        .select('client_version, server_version, platform, is_standalone, last_seen, user_id')
        .order('last_seen', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as TelemetryRow[];
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Version Distribution</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading telemetry…</CardContent>
      </Card>
    );
  }

  const rows = data || [];

  // Group by version
  const byVersion = new Map<string, TelemetryRow[]>();
  rows.forEach((r) => {
    const arr = byVersion.get(r.client_version) || [];
    arr.push(r);
    byVersion.set(r.client_version, arr);
  });

  const versionStats = Array.from(byVersion.entries())
    .map(([version, items]) => ({
      version,
      count: items.length,
      platforms: items.reduce<Record<string, number>>((acc, i) => {
        acc[i.platform] = (acc[i.platform] || 0) + 1;
        return acc;
      }, {}),
      lastSeen: items[0]?.last_seen,
    }))
    .sort((a, b) => b.count - a.count);

  const total = rows.length;
  const latestServerVersion = rows.find((r) => r.server_version)?.server_version;
  const stuckClients = rows.filter(
    (r) => latestServerVersion && r.client_version !== latestServerVersion
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Version Distribution
        </CardTitle>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
          <span><strong className="text-foreground">{total}</strong> active devices</span>
          {latestServerVersion && (
            <span>Server version: <strong className="text-foreground">v{latestServerVersion}</strong></span>
          )}
          {stuckClients > 0 && (
            <span className="text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              <strong>{stuckClients}</strong> on outdated version
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {(() => {
          // Preview admin: compare preview's installed version against PUBLISHED site
          if (isPreview && publishedVersion && isVersionNewer(publishedVersion, installed, false)) {
            return (
              <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-sm">
                <Rocket className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  <div className="font-medium text-amber-600 dark:text-amber-400">
                    Republish recommended
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Preview is on <strong className="font-mono">v{installed}</strong> — Published site is on <strong className="font-mono">v{publishedVersion}</strong>. Click <strong>Publish</strong> in Lovable to roll out to all users.
                  </div>
                </div>
              </div>
            );
          }
          // Published admin (or local): standard installed-vs-deployed check
          if (!isPreview && deployed && isVersionNewer(installed, deployed, false)) {
            return (
              <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-sm">
                <Rocket className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  <div className="font-medium text-amber-600 dark:text-amber-400">
                    Republish recommended
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Latest committed: <strong className="font-mono">v{deployed}</strong> — Your installed: <strong className="font-mono">v{installed}</strong>. Click <strong>Publish</strong> in Lovable to roll out to all users.
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}
        {versionStats.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No telemetry data yet — clients will report on next visit.
          </div>
        ) : (
          versionStats.map((v) => {
            const pct = total > 0 ? Math.round((v.count / total) * 100) : 0;
            const isLatest = latestServerVersion && v.version === latestServerVersion;
            return (
              <div key={v.version} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">v{v.version}</span>
                    {isLatest && <Badge variant="default" className="text-[10px] h-5">CURRENT</Badge>}
                    {!isLatest && latestServerVersion && (
                      <Badge variant="destructive" className="text-[10px] h-5">OUTDATED</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {v.count} ({pct}%)
                  </span>
                </div>
                <div className="h-2 bg-muted rounded overflow-hidden">
                  <div
                    className={isLatest ? 'h-full bg-primary' : 'h-full bg-destructive/70'}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  {Object.entries(v.platforms).map(([p, c]) => (
                    <Badge key={p} variant="outline" className="text-[10px] h-4 px-1.5">
                      {p}: {c}
                    </Badge>
                  ))}
                  {v.lastSeen && (
                    <span className="ml-auto">
                      Last seen {formatDistanceToNow(new Date(v.lastSeen), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
};
