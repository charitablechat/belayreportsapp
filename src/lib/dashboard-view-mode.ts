/**
 * Persists the user's last-selected dashboard card view mode
 * (list / split / grid) across sessions and devices.
 *
 * Storage strategy:
 *   - localStorage for instant first-paint and offline use
 *   - profiles.dashboard_view_mode for cross-device sync (best-effort, debounced)
 */
import { supabase } from "@/integrations/supabase/client";
import { safeSetItem } from "@/lib/safe-local-storage";

export type DashboardViewMode = "list" | "split" | "grid";

const STORAGE_KEY = "dashboard.viewMode";
const DEFAULT: DashboardViewMode = "list";
const ALLOWED: ReadonlySet<DashboardViewMode> = new Set(["list", "split", "grid"]);

function coerce(v: unknown): DashboardViewMode | null {
  return typeof v === "string" && ALLOWED.has(v as DashboardViewMode)
    ? (v as DashboardViewMode)
    : null;
}

/** Synchronous read for component initial state. */
export function loadInitialViewMode(): DashboardViewMode {
  try {
    return coerce(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let remoteWriteTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persist locally (immediate) + remotely (debounced, best-effort).
 * Never throws.
 */
export function persistViewMode(mode: DashboardViewMode): void {
  if (!ALLOWED.has(mode)) return;
  safeSetItem(STORAGE_KEY, mode, { scope: "dashboard.viewMode" });

  if (remoteWriteTimer) clearTimeout(remoteWriteTimer);
  remoteWriteTimer = setTimeout(() => {
    remoteWriteTimer = null;
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id;
        if (!uid) return;
        await supabase
          .from("profiles")
          .update({ dashboard_view_mode: mode })
          .eq("id", uid);
      } catch (err) {
        // Best-effort — local cache still works.
        console.warn("[dashboard-view-mode] remote persist failed", err);
      }
    })();
  }, 400);
}

/**
 * Fetch the remote-stored value (one-shot). Returns null when unavailable
 * (offline, not signed in, column missing, etc).
 */
export async function fetchRemoteViewMode(): Promise<DashboardViewMode | null> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("dashboard_view_mode")
      .eq("id", uid)
      .maybeSingle();
    if (error) return null;
    return coerce((data as { dashboard_view_mode?: string } | null)?.dashboard_view_mode);
  } catch {
    return null;
  }
}
