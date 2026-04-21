/**
 * Version telemetry — tracks which client version each user is running.
 */
import { supabase } from '@/integrations/supabase/client';
import { APP_VERSION } from './attestation';
import { checkVersion } from './version-check';
import { isPreviewOrIframeEnvironment } from './environment';

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
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
let lastTouch = 0;
const TOUCH_THROTTLE_MS = 30_000;

async function upsertTelemetry(serverVersion: string | null): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    // R4: append build hash to client_version so distinct deploys with the
    // same SemVer produce distinct telemetry rows. Comparator strips `+suffix`.
    const localBuild = ((import.meta.env.BUILD_COMMIT as string) || '').trim();
    const baseVersion = APP_VERSION || 'unknown';
    const versioned =
      localBuild && localBuild !== 'dev' ? `${baseVersion}+${localBuild}` : baseVersion;
    // Defensive trim: column is `text` and we don't want a runaway value.
    const clientVersion = versioned.slice(0, 64);
    const { error } = await supabase
      .from('version_telemetry')
      .upsert(
        {
          user_id: user.id,
          client_version: clientVersion,
          server_version: serverVersion ? serverVersion.slice(0, 64) : null,
          platform: detectPlatform(),
          user_agent: (navigator.userAgent || '').slice(0, 500),
          is_standalone: isStandalone(),
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform,client_version' }
      );
    return !error;
  } catch {
    return false;
  }
}

export async function reportVersionTelemetry(): Promise<void> {
  if (reported) return;
  if (isPreviewOrIframeEnvironment()) return;
  try {
    const { deployed } = await checkVersion();
    const ok = await upsertTelemetry(deployed);
    if (ok) reported = true;
  } catch {
    // best-effort
  }
}

/**
 * Re-touch last_seen on demand (e.g. when user manually checks for updates).
 * Throttled so rapid clicks don't spam the DB.
 */
export async function touchVersionTelemetry(): Promise<void> {
  if (isPreviewOrIframeEnvironment()) return;
  const now = Date.now();
  if (now - lastTouch < TOUCH_THROTTLE_MS) return;
  lastTouch = now;
  try {
    const { deployed } = await checkVersion();
    await upsertTelemetry(deployed);
  } catch {
    // best-effort
  }
}
