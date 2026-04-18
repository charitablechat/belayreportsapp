/**
 * Version telemetry — tracks which client version each user is running.
 *
 * Lets admins detect stuck clients (e.g. iOS users frozen on v4.x weeks
 * after v5.x ships) via the VersionDistributionPanel in the admin
 * dashboard. Best-effort: never throws to the caller.
 */
import { supabase } from '@/integrations/supabase/client';
import { APP_VERSION } from './attestation';
import { checkVersion } from './version-check';
import { isPreviewOrIframeEnvironment } from './environment';

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  // Order matters — iPad masquerades as Mac on iPadOS 13+
  if (/iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac/.test(ua)) return 'macos';
  if (/Linux/.test(ua)) return 'linux';
  return 'unknown';
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // @ts-ignore - non-standard on iOS
    if (navigator.standalone === true) return true;
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

let reported = false;

export async function reportVersionTelemetry(): Promise<void> {
  if (reported) return;
  if (isPreviewOrIframeEnvironment()) return;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { deployed } = await checkVersion();
    const platform = detectPlatform();
    const ua = (navigator.userAgent || '').slice(0, 500);

    const { error } = await supabase
      .from('version_telemetry')
      .upsert(
        {
          user_id: user.id,
          client_version: APP_VERSION,
          server_version: deployed,
          platform,
          user_agent: ua,
          is_standalone: isStandalone(),
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform,client_version' }
      );

    if (!error) reported = true;
  } catch {
    // Best-effort — never surface to the user
  }
}
