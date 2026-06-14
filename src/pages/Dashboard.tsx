import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GradientButton } from "@/components/ui/gradient-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogOut, FileText, GraduationCap, ArrowRight, Download, Settings, Trash2, MoreVertical, Bell, Cloud, User, Loader2, Check, RefreshCw, MessageCircle, Shield, CloudOff, ChevronDown, ChevronRight, Filter, X, Briefcase } from "lucide-react";
import { DashboardSearchBar } from "@/components/dashboard/DashboardSearchBar";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardQuickFilters } from "@/components/dashboard/DashboardQuickFilters";
import { DashboardControls } from "@/components/dashboard/DashboardControls";
import { ReportListView } from "@/components/dashboard/ReportListView";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DashboardReportsSection } from "@/components/dashboard/DashboardReportsSection";
import { UserAvatar } from "@/components/ui/user-avatar";
import { toast } from "@/components/ui/sonner";
import { format, differenceInDays } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReportCard } from "@/components/dashboard/ReportCard";
import { useProfileMap } from "@/hooks/useProfileMap";
import { ReportCardSkeleton } from "@/components/dashboard/ReportCardSkeleton";
/* TEMPORARY FEATURE: Known Issues */
import { KnownIssuesCard } from "@/components/dashboard/KnownIssuesCard";
import { DeveloperNotesCard } from "@/components/dashboard/DeveloperNotesCard";
import belayReportsLogoAsset from "@/assets/marble-logo.gif.asset.json";
const belayReportsLogo = belayReportsLogoAsset.url;
import acctLogo from "@/assets/acct-accredited-vendor.png";
import { getSessionBackground } from "@/lib/background-manager";
import { triggerHaptic } from "@/lib/haptics";

import { useSyncProgress } from "@/hooks/useSyncProgress";
import { NetworkStatusIndicator } from "@/components/pwa/NetworkStatusIndicator";
import { NetworkQualityIndicator } from "@/components/pwa/NetworkQualityIndicator";

import { ForceSyncButton } from "@/components/pwa/ForceSyncButton";
import { BackgroundSyncStatus } from "@/components/pwa/BackgroundSyncStatus";
import { IOSInstallPromptOnce } from "@/components/pwa/IOSInstallPromptOnce";
import { OfflineSimulator } from "@/components/dev/OfflineSimulator";
import { StatusIndicator } from "@/components/pwa/StatusIndicator";
import { SyncPulse } from "@/components/pwa/SyncPulse";
import { useConflicts } from "@/hooks/useConflicts";
import { usePWA } from "@/hooks/usePWA";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { getOfflineInspections, deleteOfflineInspection, queueOperation, queueTrainingOperation, queueAssessmentOperation, queueJCFOperation, saveInspectionOffline, getOfflineTrainings, saveTrainingOffline, deleteOfflineTraining, getOfflineDailyAssessments, saveDailyAssessmentOffline, deleteOfflineDailyAssessment, getOfflineInspection, getOfflineTraining, getOfflineDailyAssessment, getOfflineJCFs, getOfflineJCF, saveJCFOffline, deleteOfflineJCF, clearRelatedDataOffline, clearTrainingDataOffline, clearAssessmentDataOffline, type DbRow } from "@/lib/offline-storage";
import type { PostgrestError } from "@supabase/supabase-js";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { CachedUser } from "@/lib/cached-auth";
import { shouldPreserveLocalRecord } from "@/lib/local-data-guards";
import { reconcileServerDeletions } from "@/lib/reconcile-server-deletions";
import { isLovablePreview } from "@/lib/environment";
import { ContactDeveloperSheet } from "@/components/ContactDeveloperSheet";
import { onSyncComplete, isSyncInProgress, consumePendingDashboardRefresh, consumeDashboardStaleTimestamp } from "@/lib/sync-events";
import { E2E_INSPECTION_MARKER_COLUMNS, E2E_MARKER_PREFIX, filterOutE2EFixtures } from "@/lib/e2e-fixture-filter";
import { InspectionsEmptyState, TrainingsEmptyState, DailyAssessmentsEmptyState } from "@/components/EmptyState";
import { getUserWithCache, getSuperAdminStatusWithCache, invalidateSuperAdminCache, ensureValidSession, getOfflineUserId, getAdminCacheKey } from "@/lib/cached-auth";
/* Holiday Theme Components - DISABLED */
// import { OlympicRings } from "@/components/christmas/OlympicRings";
// UserProfileDropdown moved to AuthenticatedHeader (global)
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Stale-while-revalidate: read cached dashboard data
// Primary: sessionStorage (30-min TTL for fast reads)
// Fallback: localStorage (no TTL — last-known-good data survives session expiry)
const DASHBOARD_CACHE_TTL = 30 * 60 * 1000;
const LS_CACHE_PREFIX = 'dashboard-ls-';

function readDashboardCache(key: string): DbRow[] {
  try {
    // Try sessionStorage first (fast, session-scoped)
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < DASHBOARD_CACHE_TTL) return data;
    }
    // Fallback: localStorage (no TTL — last-known-good)
    const lsRaw = localStorage.getItem(LS_CACHE_PREFIX + key);
    if (lsRaw) {
      const { data } = JSON.parse(lsRaw);
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  return [];
}

function writeDashboardCache(key: string, data: DbRow[]) {
  try {
    const payload = JSON.stringify({ data, ts: Date.now() });
    sessionStorage.setItem(key, payload);
    // Also persist to localStorage as long-lived fallback
    localStorage.setItem(LS_CACHE_PREFIX + key, payload);
  } catch {}
}

// Value-equality bail-out for dashboard row arrays. Compares by id +
// updated_at so identical SWR refetches don't replace the array reference
// and trigger DashboardReportsSection to remount its rows. See
// .lovable/plan.md "Root cause 2" for context.
function sameRows(a: DbRow[], b: DbRow[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if ((a[i].updated_at ?? '') !== (b[i].updated_at ?? '')) return false;
  }
  return true;
}

// Functional setter that no-ops when the next array is row-equivalent to
// the current one. React bails out of the render when the setter returns
// the same reference.
function applyRowsIfChanged(
  setter: React.Dispatch<React.SetStateAction<DbRow[]>>,
  next: DbRow[],
) {
  setter(prev => (sameRows(prev, next) ? prev : next));
}

// Read offline IDB with a hard timeout. The result discriminates between
// "IDB actually finished and returned N rows" (kind: 'data') and "the
// timeout fired before IDB resolved" (kind: 'timeout'), so callers can
// tell whether an empty array means "IDB has zero rows" or "we never
// heard back from IDB". Without the discriminator the dashboard drift
// beacon would fire false positives every time IDB is slow.
type OfflineReadResult = { kind: 'data'; rows: DbRow[] } | { kind: 'timeout' };
function readOfflineWithTimeout(
  promise: Promise<DbRow[]>,
  timeoutMs: number,
): Promise<OfflineReadResult> {
  return Promise.race<OfflineReadResult>([
    promise.then(rows => ({ kind: 'data' as const, rows })),
    new Promise<OfflineReadResult>((resolve) =>
      setTimeout(() => resolve({ kind: 'timeout' as const }), timeoutMs),
    ),
  ]);
}

// Drift beacon: surface when offline IDB row count disagrees with the
// server row count for a dashboard table. The flicker fix suppresses the
// stale offline pre-paint on subsequent refreshes so users don't visibly
// see the 54↔58 toggle, but that means the underlying save/reconcile
// bug that lets IDB drift away from the server is no longer self-evident
// from the UI. Forward each non-zero drift as a `warning`-level Sentry
// event with a stable fingerprint so we can quantify it in production
// without each occurrence generating an alert. Throttled to once per
// 5 min per table to avoid Sentry spam during a real outage.
const DRIFT_REPORT_THROTTLE_MS = 5 * 60 * 1000;
const lastDriftReportAt = new Map<string, number>();
function maybeReportDashboardDrift(
  table: 'inspections' | 'trainings' | 'daily_assessments' | 'jcf_reports',
  offlineCount: number,
  networkCount: number,
  offlineReadCompleted: boolean,
): void {
  // Skip when the offline IDB read timed out — we don't actually know what
  // IDB has in that case, only that we didn't get an answer within 4s.
  // Reporting `offlineCount=0` here would pollute the metric with a flood
  // of false positives on slow iOS devices.
  if (!offlineReadCompleted) return;
  if (offlineCount === networkCount) return;
  // Only report when the OFFLINE store has FEWER rows than the server
  // (the case that produced Luke's flicker). Local > server is a
  // different signal — usually means a row was queued locally and not
  // yet synced — and is already covered by the unsynced bucket UI.
  if (offlineCount >= networkCount) return;
  const now = Date.now();
  const last = lastDriftReportAt.get(table) ?? 0;
  if (now - last < DRIFT_REPORT_THROTTLE_MS) return;
  lastDriftReportAt.set(table, now);
  // Lazy-import so the Sentry chunk stays out of the dashboard hot path
  // when no drift is present. Never blocks rendering.
  void import('@/lib/log-error')
    .then(({ logError }) => {
      logError(new Error('dashboard offline/server row count drift'), {
        scope: 'Dashboard.refreshReports',
        level: 'warning',
        fingerprint: ['dashboard-drift', table, '{{default}}'],
        extra: {
          table,
          offlineCount,
          networkCount,
          delta: networkCount - offlineCount,
        },
      });
    })
    .catch(() => {});
}

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [inspections, setInspections] = useState<DbRow[]>(() => readDashboardCache('dashboard-cache-inspections'));
  const [trainings, setTrainings] = useState<DbRow[]>(() => readDashboardCache('dashboard-cache-trainings'));
  const [dailyAssessments, setDailyAssessments] = useState<DbRow[]>(() => readDashboardCache('dashboard-cache-daily'));
  const [jcfs, setJcfs] = useState<DbRow[]>(() => readDashboardCache('dashboard-cache-jcfs'));
  const [loading, setLoading] = useState(true);
  // Track whether we've received at least one definitive result per category
  // Per-dataset validation: tracks whether each dataset has received a definitive result
  const [inspectionsValidated, setInspectionsValidated] = useState(false);
  const [trainingsValidated, setTrainingsValidated] = useState(false);
  const [dailyValidated, setDailyValidated] = useState(false);
  const [jcfsValidated, setJcfsValidated] = useState(false);
  const dataValidated = inspectionsValidated && trainingsValidated && dailyValidated && jcfsValidated;

  // Build a unified inspector_id → profile map so cards can resolve names
  // even when locally-saved IDB rows lost the `inspector` / `trainer` join.
  const profilesById = useProfileMap(
    useMemo(
      () => [...inspections, ...trainings, ...dailyAssessments, ...jcfs],
      [inspections, trainings, dailyAssessments, jcfs],
    ),
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<DbRow | null>(null);
  const [reportToDelete, setReportToDelete] = useState<DbRow | null>(null);
  const [activeReportTab, setActiveReportTab] = useState("inspections");
  const [reportSection, setReportSection] = useState<"recent" | "all">("recent");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentUser, setCurrentUser] = useState<CachedUser | null>(null);
  const [userProfile, setUserProfile] = useState<DbRow | null>(null);
  const [inspectorFilter, setInspectorFilter] = useState<string>("all");

  // Deduplication & throttle refs for refreshReports
  const refreshInFlightRef = React.useRef(false);
  const pendingRefreshRef = React.useRef(false);
  const lastRefreshTsRef = React.useRef(0);
  const REFRESH_THROTTLE_MS = 3000;
  const [showStaleDataBanner, setShowStaleDataBanner] = useState(false);
  const networkFailCountRef = React.useRef(0);

  // Suppress stale-while-revalidate offline pre-paint on subsequent
  // refreshes. The SWR pattern paints offlineData first, then networkData;
  // when IDB drifts from server (e.g., records owned by other users that
  // never ingested into local IDB), every refresh visibly toggles between
  // the two row counts and the user sees a flicker. Once the first render
  // has happened, the in-memory React state already holds rows from a
  // previous cycle, so the offline pre-paint is pure regression — the
  // network round-trip arrives within a few hundred ms and is the source
  // of truth. Initial cold-mount still benefits from the pre-paint when
  // the offline IDB has data and the network is slow.
  //
  // CRITICAL: initialise from cache state, not unconditionally `false`.
  // React state above (lines 219–221) is seeded from session/localStorage,
  // which survives unmount/remount within the session. The component-scoped
  // refs were resetting to `false` on every remount (e.g. when the user
  // alt-tabs back and Chrome remounts the dashboard tab), letting the
  // stale offline pre-paint clobber the already-cached network state and
  // producing the visible flicker Belay caught on video after PR #185.
  // Mirror the cache check used by the state initialisers so the refs
  // agree with what React state already holds.
  const hasPaintedInspectionsRef = React.useRef(
    readDashboardCache('dashboard-cache-inspections').length > 0,
  );
  const hasPaintedTrainingsRef = React.useRef(
    readDashboardCache('dashboard-cache-trainings').length > 0,
  );
  const hasPaintedDailyAssessmentsRef = React.useRef(
    readDashboardCache('dashboard-cache-daily').length > 0,
  );
  const hasPaintedJCFsRef = React.useRef(
    readDashboardCache('dashboard-cache-jcfs').length > 0,
  );

  // Build unique inspector list from report data
  const uniqueInspectors = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of inspections) {
      const insp = i.inspector;
      if (insp?.first_name || insp?.last_name) {
        map.set(i.inspector_id, `${insp.first_name || ''} ${insp.last_name || ''}`.trim());
      }
    }
    for (const t of trainings) {
      const tr = t.trainer;
      if (tr?.first_name || tr?.last_name) {
        map.set(t.inspector_id, `${tr.first_name || ''} ${tr.last_name || ''}`.trim());
      }
    }
    for (const d of dailyAssessments) {
      const insp = d.inspector;
      if (insp?.first_name || insp?.last_name) {
        map.set(d.inspector_id, `${insp.first_name || ''} ${insp.last_name || ''}`.trim());
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inspections, trainings, dailyAssessments]);

  // Silent auto-resolution of conflicts via last-write-wins
  useConflicts();
  const { photosByInspection, isSyncing, unsyncedCount, forceSync } = usePWA();
  const { progress } = useSyncProgress();
  
  // Pull to refresh for mobile - only reloads data, sync is automatic
  const { isPulling, pullDistance, shouldTriggerRefresh, isActive } = usePullToRefresh({
    onRefresh: async () => {
      triggerHaptic('medium');
      await refreshReports(true);
    },
    isRefreshing: isSyncing,
  });
  
  const queryClient = useQueryClient();
  
  // Check if user is super admin - uses cached auth with robust fallback
  const { data: isSuperAdmin, isLoading: isSuperAdminLoading } = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      const offlineId = getOfflineUserId();
      const namespacedKey = offlineId ? getAdminCacheKey(offlineId) : null;
      const cachedValue = namespacedKey ? localStorage.getItem(namespacedKey) : null;

      if (!navigator.onLine) {
        return cachedValue === 'true';
      }

      const user = await getUserWithCache();
      if (!user) {
        // P0 FIX: Do NOT write "false" to cache on transient auth failure.
        console.warn('[Dashboard] getUserWithCache returned null — preserving cached admin status');
        return cachedValue === 'true';
      }

      try {
        const { data, error } = await supabase.rpc('is_admin_or_above');

        if (error) {
          console.warn('[Dashboard] Error checking admin status:', error);
          return cachedValue === 'true';
        }

        const isAdmin = !!data;

        localStorage.setItem(getAdminCacheKey(user.id), isAdmin.toString());

        return isAdmin;
      } catch (err) {
        console.warn('[Dashboard] Exception checking admin status:', err);
        return cachedValue === 'true';
      }
    },
    staleTime: 2 * 60 * 1000,
    retry: 2,
    retryDelay: 1000,
    placeholderData: () => {
      const offlineId = getOfflineUserId();
      if (!offlineId) return false;
      const cached = localStorage.getItem(getAdminCacheKey(offlineId));
      return cached === 'true';
    },
  });

  // Fetch invoiced report metadata (admin only) — single source of truth via React Query
  type InvoicedMeta = { invoiced_at: string; invoiced_by: string | null };
  const invoicedQuery = useQuery({
    queryKey: ["invoiced-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoiced_reports")
        .select("report_id, invoiced_at, invoiced_by");
      if (error) {
        console.warn('[Dashboard] Error fetching invoiced reports:', error);
        return new Map<string, InvoicedMeta>();
      }
      const map = new Map<string, InvoicedMeta>();
      (data || []).forEach((r: { report_id: string; invoiced_at: string; invoiced_by: string | null }) => {
        map.set(r.report_id, { invoiced_at: r.invoiced_at, invoiced_by: r.invoiced_by });
      });
      return map;
    },
    enabled: !!isSuperAdmin,
    staleTime: 30_000,
  });

  const invoicedMetaById = invoicedQuery.data ?? new Map<string, InvoicedMeta>();
  const invoicedReportIds = React.useMemo(
    () => new Set(invoicedMetaById.keys()),
    [invoicedMetaById]
  );

  const handleToggleInvoiced = React.useCallback(async (report: DbRow, type: 'inspection' | 'training' | 'daily') => {
    const isCurrentlyInvoiced = invoicedReportIds.has(report.id);
    
    if (isCurrentlyInvoiced) {
      const { error } = await supabase
        .from("invoiced_reports")
        .delete()
        .eq("report_id", report.id)
        .eq("report_type", type);
      if (error) {
        toast.error("Failed to remove invoice status");
        return;
      }
      // Optimistic update via React Query cache
      queryClient.setQueryData<Map<string, InvoicedMeta>>(["invoiced-reports"], (old) => {
        const next = new Map(old);
        next.delete(report.id);
        return next;
      });
      toast.success("Invoice status removed");
    } else {
      const user = await getUserWithCache();
      const { error } = await supabase
        .from("invoiced_reports")
        .insert({ report_id: report.id, report_type: type, invoiced_by: user?.id });
      if (error) {
        toast.error("Failed to mark as invoiced");
        return;
      }
      queryClient.setQueryData<Map<string, InvoicedMeta>>(["invoiced-reports"], (old) => {
        const next = new Map(old);
        next.set(report.id, { invoiced_at: new Date().toISOString(), invoiced_by: user?.id ?? null });
        return next;
      });
      toast.success("Report marked as invoiced");
    }
    triggerHaptic('light');
    queryClient.invalidateQueries({ queryKey: ["invoiced-reports"] });
  }, [invoicedReportIds, queryClient]);


  // NOTE: deps intentionally kept as [] — the load* functions inside only use
  // their arguments and stable useState setters, so the closure is safe.
  // If you add direct state reads here, move to useRef or add to deps.
  const refreshReports = React.useCallback(async (force = false, skipSessionValidation = false) => {
    if (refreshInFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    if (!force && Date.now() - lastRefreshTsRef.current < REFRESH_THROTTLE_MS) return;
    refreshInFlightRef.current = true;
    lastRefreshTsRef.current = Date.now();

    let effectiveOnline: boolean;
    let sessionValid: boolean;

    if (skipSessionValidation) {
      // Fast path: user just came from a report form — cached auth is fresh
      effectiveOnline = true;
      sessionValid = true;
    } else {
      // Bug 7 fix: navigator.onLine can briefly be false during iOS page transitions.
      // If offline at start, wait 1s and recheck before giving up on network.
      effectiveOnline = navigator.onLine;
      if (!effectiveOnline) {
        await new Promise(r => setTimeout(r, 1000));
        effectiveOnline = navigator.onLine;
      }

      // Capture session validity — gate network queries on this
      // Use 8s timeout (mobile auth round-trips can take 3-5s)
      sessionValid = false;
      if (effectiveOnline) {
        try {
          const sessionUser = await Promise.race([
            ensureValidSession(),
            new Promise<null>(resolve => setTimeout(() => resolve(null), 8000))
          ]);
          sessionValid = !!sessionUser;
        } catch (e) {
          console.warn('[Dashboard] Session validation failed:', e);
        }

        // Retry once after 2s if first attempt failed while online
        if (!sessionValid) {
          try {
            await new Promise(r => setTimeout(r, 2000));
            const retryUser = await Promise.race([
              ensureValidSession(),
              new Promise<null>(resolve => setTimeout(() => resolve(null), 5000))
            ]);
            sessionValid = !!retryUser;
            if (sessionValid && import.meta.env.DEV) {
              console.log('[Dashboard] Session recovered on retry');
            }
          } catch {
            // Still failed — proceed with offline data
          }
        }
      }
    }

    const user = await getUserWithCache();
    const userId = user?.id || getOfflineUserId();
    // Only check super admin if session is valid (avoids RLS failures)
    const superAdminStatus = user && sessionValid ? await getSuperAdminStatusWithCache() : false;

    try {
      const results = await Promise.all([
        loadInspections(userId, superAdminStatus, sessionValid),
        loadTrainingReports(userId, superAdminStatus, sessionValid),
        loadDailyAssessments(userId, superAdminStatus, sessionValid),
        loadJCFs(userId, superAdminStatus, sessionValid),
      ]);

      // Fix 1: Always flip per-dataset validation true once the load function
      // returns. Previously this only happened on `definitive: true`, which
      // left the StatsBar pulsing forever when network timed out AND IDB was
      // empty. We'd rather show real numbers from cache (or a real 0) than
      // skeletons indefinitely.
      setInspectionsValidated(true);
      setTrainingsValidated(true);
      setDailyValidated(true);
      setJcfsValidated(true);
      void results; // (kept for future telemetry if needed)

      // Track network failures for stale-data banner
      const anyNetworkSuccess = results.some(r => r.networkSuccess);
      if (effectiveOnline && !anyNetworkSuccess) {
        networkFailCountRef.current++;
        if (networkFailCountRef.current >= 2) {
          setShowStaleDataBanner(true);
        }
      } else if (anyNetworkSuccess) {
        networkFailCountRef.current = 0;
        setShowStaleDataBanner(false);
      }
    } catch (err) {
      // Even on outright failure, flip validation true so the StatsBar shows
      // cached numbers rather than skeletons forever.
      console.warn('[Dashboard] refreshReports threw — showing cached counts:', err);
      setInspectionsValidated(true);
      setTrainingsValidated(true);
      setDailyValidated(true);
      setJcfsValidated(true);
    } finally {
      refreshInFlightRef.current = false;
      // If a refresh was queued while we were busy, trigger it now
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        refreshReports(true);
      }
    }
  }, []);

  // Coalescer for refresh triggers (focus, visibility, sync-complete,
  // pageshow, online, dashboard-stale, realtime fallback). Without this
  // the seven event sources can stack three refreshes inside a second,
  // each restarting the full inspections/trainings/assessments pipeline
  // and re-replacing the React arrays — the visible "flicker" on
  // /dashboard. See .lovable/plan.md "Root cause 1".
  const refreshScheduledRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRefresh = useCallback(() => {
    if (refreshScheduledRef.current) return; // already queued
    if (refreshInFlightRef.current) {
      // Let the in-flight pendingRefresh trailer handle it
      pendingRefreshRef.current = true;
      return;
    }
    refreshScheduledRef.current = setTimeout(() => {
      refreshScheduledRef.current = null;
      refreshReports(true);
    }, 250);
  }, [refreshReports]);

  useEffect(() => {
    setLoading(true);
    // Fix 2: only show skeletons if we truly have nothing cached. If cache
    // hydrated non-empty arrays, treat them as "validated" immediately so
    // the StatsBar shows numbers right away while the network refresh runs.
    setInspectionsValidated(inspections.length > 0);
    setTrainingsValidated(trainings.length > 0);
    setDailyValidated(dailyAssessments.length > 0);

    const LOAD_TIMEOUT = 20000;
    let loadCompleted = false;
    const safetyTimeout = setTimeout(() => {
      if (!loadCompleted) {
        console.warn('[Dashboard] Loading safety timeout');
        setLoading(false);
      }
    }, LOAD_TIMEOUT);

    // Detect stale marker early — if present, use fast path (skip session validation)
    const hasStaleMarker = consumeDashboardStaleTimestamp() || consumePendingDashboardRefresh();

    refreshReports(true, hasStaleMarker).then(() => {
      loadCompleted = true;
      clearTimeout(safetyTimeout);
      setLoading(false);
      // If we used the fast path, do a background session-validated refresh
      if (hasStaleMarker) {
        setTimeout(() => refreshReports(true), 500);
      }
    });

    // Fetch current user
    const fetchUser = async () => {
      const user = await getUserWithCache();
      setCurrentUser(user);
      if (user && navigator.onLine) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        setUserProfile(profile);
      }
    };
    fetchUser();

    // Auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user) setCurrentUser(session.user);
        if (event === 'SIGNED_OUT' && navigator.onLine) navigate("/", { replace: true });
      }
    );

    // Online/offline
    const handleOnline = () => {
      setIsOnline(true);
      invalidateSuperAdminCache();
      queryClient.invalidateQueries({ queryKey: ["is-super-admin"] });
      requestRefresh();
    };
    const handleOffline = () => setIsOnline(false);

    // Sync completion
    const unsubscribeSyncComplete = onSyncComplete(() => {
      if (import.meta.env.DEV) console.log('[Dashboard] Sync complete - refreshing');
      invalidateSuperAdminCache();
      queryClient.invalidateQueries({ queryKey: ["is-super-admin"] });
      requestRefresh();
    });

    // Visibility change (tab switch, app resume)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestRefresh();
    };

    // Window focus (SPA back-navigation)
    const handleWindowFocus = () => requestRefresh();

    // iPad/Safari bfcache restore
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        if (import.meta.env.DEV) console.log('[Dashboard] bfcache restore - refreshing');
        requestRefresh();
      }
    };

    // Stale marker is now consumed above before refreshReports call

    // Hydrate restored records immediately from sessionStorage marker
    const hydrateRestoredRecord = async () => {
      try {
        const raw = sessionStorage.getItem('restored-report-marker');
        if (!raw) return;
        const marker = JSON.parse(raw);
        // Only consume if recent (within 5 minutes)
        if (Date.now() - marker.ts > 300000) {
          sessionStorage.removeItem('restored-report-marker');
          return;
        }
        sessionStorage.removeItem('restored-report-marker');

        const { table, recordId, row } = marker;
        console.log('[Dashboard] Hydrating restored record:', { table, recordId });

        // Try targeted fetch for full data with profile join
        let freshRow = row;
        if (navigator.onLine) {
          try {
            if (table === 'inspections') {
              const { data } = await supabase
                .from('inspections')
                .select(`id, inspector_id, organization, location, inspection_date, status, created_at, updated_at, synced_at, last_opened_at, acct_number, started_at, latest_report_generated_at, report_version, deleted_at, organization_id, previous_inspector, previous_inspection_date, inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name, avatar_url)`)
                .eq('id', recordId)
                .is('deleted_at', null)
                .maybeSingle();
              if (data) freshRow = data;
            } else if (table === 'trainings') {
              const { data } = await supabase
                .from('trainings')
                .select(`id, inspector_id, organization, trainer_of_record, start_date, end_date, status, created_at, updated_at, synced_at, latest_report_generated_at, report_version, deleted_at, trainer:profiles!trainings_inspector_id_profiles_fkey(first_name, last_name, avatar_url)`)
                .eq('id', recordId)
                .is('deleted_at', null)
                .maybeSingle();
              if (data) freshRow = data;
            } else if (table === 'daily_assessments') {
              const { data } = await supabase
                .from('daily_assessments')
                .select(`id, inspector_id, organization, site, trainer_of_record, assessment_date, status, created_at, updated_at, synced_at, latest_report_generated_at, report_version, deleted_at, inspector:profiles!daily_assessments_inspector_id_profiles_fkey(first_name, last_name, avatar_url)`)
                .eq('id', recordId)
                .is('deleted_at', null)
                .maybeSingle();
              if (data) freshRow = data;
            }
          } catch (e) {
            console.warn('[Dashboard] Targeted restore fetch failed, using marker row:', e);
          }
        }

        if (!freshRow) return;

        // Merge into React state
        if (table === 'inspections') {
          setInspections(prev => {
            if (prev.some(r => r.id === recordId)) return prev;
            return [freshRow, ...prev];
          });
        } else if (table === 'trainings') {
          setTrainings(prev => {
            if (prev.some(r => r.id === recordId)) return prev;
            return [freshRow, ...prev];
          });
        } else if (table === 'daily_assessments') {
          setDailyAssessments(prev => {
            if (prev.some(r => r.id === recordId)) return prev;
            return [freshRow, ...prev];
          });
        }
      } catch (e) {
        console.warn('[Dashboard] Failed to hydrate restored record:', e);
      }
    };
    hydrateRestoredRecord();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const handleDashboardStale = () => requestRefresh();
    window.addEventListener('dashboard-stale', handleDashboardStale);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('dashboard-stale', handleDashboardStale);
      subscription.unsubscribe();
      unsubscribeSyncComplete();
      if (refreshScheduledRef.current) {
        clearTimeout(refreshScheduledRef.current);
        refreshScheduledRef.current = null;
      }
    };
  }, []);

  // PR-D: Realtime subscription, scoped by user role.
  //
  // Pre-PR-D the channel listened to every row event on inspections/trainings/
  // daily_assessments with no user filter. Every device received every other
  // tenant's writes — useless bandwidth on the wire and more importantly an
  // unnecessary leak vector if a misconfigured RLS policy ever broadcast a
  // row to clients that shouldn't see it. (RLS does protect the initial fetch,
  // but Realtime broadcasts are a separate channel; relying on RLS alone for
  // tenant isolation is brittle.)
  //
  // For non-admin users: filter `inspector_id=eq.${currentUser.id}` so the
  //   server only sends them their own row events. This matches how the same
  //   page's REST fetches scope themselves (see refreshReports inspection /
  //   training / daily-assessment branches).
  // For admin / super-admin: keep listening unfiltered — admins legitimately
  //   manage all tenants' reports and the dashboard counts depend on it.
  //
  // Effect deps: re-subscribe whenever the user signs in/out or their admin
  // role flag flips, so a freshly-promoted admin doesn't keep their narrow
  // filter and a freshly-demoted user doesn't keep their broad subscription.
  useEffect(() => {
    // Wait until we know the user's id and admin status before subscribing.
    // `isSuperAdmin` is `undefined` while React Query is loading; treat that
    // as "not yet known" and skip subscription.
    const userId = currentUser?.id;
    if (!userId || typeof isSuperAdmin !== 'boolean') return;

    const mergeRow = (prev: DbRow[], row: DbRow) => {
      const exists = prev.some((r) => r.id === row.id);
      if (exists) {
        return prev.map((r) =>
          r.id === row.id
            ? { ...r, ...row, updated_at: row.updated_at, synced_at: row.updated_at }
            : r
        );
      }
      return [row, ...prev];
    };
    const removeRow = (prev: DbRow[], id: string) => prev.filter((r) => r.id !== id);

    // For non-admins, restrict each table subscription to rows they own.
    const filter = isSuperAdmin ? undefined : `inspector_id=eq.${userId}`;
    const baseConfig = (table: string) =>
      filter
        ? { event: '*' as const, schema: 'public', table, filter }
        : { event: '*' as const, schema: 'public', table };

    const dashboardChannel = supabase
      .channel(`dashboard-realtime:${userId}:${isSuperAdmin ? 'admin' : 'self'}`)
      .on('postgres_changes', baseConfig('inspections'), (payload: RealtimePostgresChangesPayload<DbRow>) => {
        setInspectionsValidated(prev => prev ? prev : true);
        if (payload.eventType === 'DELETE') {
          const id = payload.old?.id;
          if (id) setInspections((prev) => removeRow(prev, id));
          return;
        }
        const row = payload.new;
        if (!row?.id) return;
        if (row.deleted_at) {
          setInspections((prev) => removeRow(prev, row.id));
          return;
        }
        setInspections((prev) => mergeRow(prev, row));
      })
      .on('postgres_changes', baseConfig('trainings'), (payload: RealtimePostgresChangesPayload<DbRow>) => {
        setTrainingsValidated(prev => prev ? prev : true);
        if (payload.eventType === 'DELETE') {
          const id = payload.old?.id;
          if (id) setTrainings((prev) => removeRow(prev, id));
          return;
        }
        const row = payload.new;
        if (!row?.id) return;
        if (row.deleted_at) {
          setTrainings((prev) => removeRow(prev, row.id));
          return;
        }
        setTrainings((prev) => mergeRow(prev, row));
      })
      .on('postgres_changes', baseConfig('daily_assessments'), (payload: RealtimePostgresChangesPayload<DbRow>) => {
        setDailyValidated(prev => prev ? prev : true);
        if (payload.eventType === 'DELETE') {
          const id = payload.old?.id;
          if (id) setDailyAssessments((prev) => removeRow(prev, id));
          return;
        }
        const row = payload.new;
        if (!row?.id) return;
        if (row.deleted_at) {
          setDailyAssessments((prev) => removeRow(prev, row.id));
          return;
        }
        setDailyAssessments((prev) => mergeRow(prev, row));
      })
      .on('postgres_changes', baseConfig('jcf_reports'), (payload: RealtimePostgresChangesPayload<DbRow>) => {
        setJcfsValidated(prev => prev ? prev : true);
        if (payload.eventType === 'DELETE') {
          const id = payload.old?.id;
          if (id) setJcfs((prev) => removeRow(prev, id));
          return;
        }
        const row = payload.new;
        if (!row?.id) return;
        if (row.deleted_at) {
          setJcfs((prev) => removeRow(prev, row.id));
          return;
        }
        setJcfs((prev) => mergeRow(prev, row));
      })
      // Realtime health check. If the channel errors or times out we log it
      // and trigger a one-shot refetch so the dashboard counts don't silently
      // drift from server reality. Pre-PR-D this was the only fallback when
      // Supabase Realtime chunked or failed; PR-D's user filter doesn't change
      // the recovery semantics, just the subscription scope.
      .subscribe((status) => {
        if (import.meta.env.DEV) {
          console.log('[Dashboard] realtime status:', status, 'filter:', filter ?? 'none');
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[Dashboard] realtime channel degraded:', status, '— scheduling fallback refetch');
          setTimeout(() => requestRefresh(), 1500);
        }
      });

    return () => {
      supabase.removeChannel(dashboardChannel);
    };
  }, [currentUser?.id, isSuperAdmin]);

  // Helper function to add timeout to network queries
  const withNetworkTimeout = async <T,>(
    promise: Promise<T>,
    timeoutMs: number = 15000,
    fallback: T | null = null
  ): Promise<T | null> => {
    return Promise.race([
      promise,
      new Promise<T | null>((resolve) => setTimeout(() => {
        console.warn('[Dashboard] Network query timed out after', timeoutMs, 'ms');
        resolve(fallback);
      }, timeoutMs))
    ]);
  };

  /**
   * M13: Paginated fetch for dashboard lists.
   *
   * Supabase/PostgREST caps any single response at ~1000 rows. A hardcoded
   * `.limit(500)` truncated super-admin views, and the truncated set was then
   * written into the dashboard cache — making older records vanish offline
   * (and look like orphans to the cleanup pass).
   *
   * Caller passes a `buildPage(from, to)` factory that returns a *fresh*
   * PostgREST query for the requested range. We page until a short page is
   * returned (or the safety cap is hit), then concatenate.
   */
  const fetchAllPaginated = async <T,>(
    label: string,
    buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
    pageSize: number = 500,
    maxRows: number = 10000,
  ): Promise<T[]> => {
    const all: T[] = [];
    let from = 0;
    // Safety cap protects against pathological loops / runaway data sets.
    while (all.length < maxRows) {
      const to = from + pageSize - 1;
      const { data, error } = await buildPage(from, to);
      if (error) {
        console.error(`[Dashboard] Paginated fetch error (${label}, range ${from}-${to}):`, error);
        throw error;
      }
      if (!data || data.length === 0) break;
      all.push(...data);
      // Short page = last page. Avoids one extra round-trip when the total
      // count is an exact multiple of pageSize, which is rare and harmless.
      if (data.length < pageSize) break;
      from += pageSize;
    }
    if (all.length >= maxRows && import.meta.env.DEV) {
      console.warn(`[Dashboard] Paginated fetch (${label}) hit safety cap of ${maxRows} rows`);
    }
    return all;
  };


  const loadInspections = async (cachedUserId?: string, cachedIsSuperAdmin?: boolean, sessionValid: boolean = true): Promise<{ networkSuccess: boolean; definitive: boolean }> => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // Get super admin status if not passed (for backward compatibility)
      const isSuperAdmin = cachedIsSuperAdmin ?? await getSuperAdminStatusWithCache();
      
      // PARALLEL LOADING: Start both IndexedDB and Supabase fetches simultaneously
      // This ensures mobile users see data quickly even if IndexedDB times out
      const offlinePromise = getOfflineInspections(userId, isSuperAdmin).catch(() => []);
      
      let supabasePromise: Promise<DbRow[] | null> = Promise.resolve([]);
      if (navigator.onLine && sessionValid) {
        // Wrap in Promise.resolve to get a proper Promise with .catch()
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          // M13: Paginate so super-admins with >500 reports get the full set;
          // truncated results were silently caching as the offline source-of-truth.
          fetchAllPaginated<DbRow>(
            'inspections',
            (from, to) =>
              supabase
                .from("inspections")
                .select(`
                  id, inspector_id, organization, location, inspection_date,
                  status, created_at, updated_at, synced_at, last_opened_at,
                  acct_number, started_at, latest_report_generated_at, report_version,
                  deleted_at, organization_id, previous_inspector, previous_inspection_date,
                  inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name, avatar_url)
                `)
                .is('deleted_at', null)
                // Hide e2e-suite fixture residue from the dashboard. Marker
                // rows leak when a Playwright spec fails before its
                // post-flight cleanup; admins should never see them.
                .not('location', 'ilike', `${E2E_MARKER_PREFIX}%`)
                .not('organization', 'ilike', `${E2E_MARKER_PREFIX}%`)
                .order("last_opened_at", { ascending: false, nullsFirst: false })
                .order("created_at", { ascending: false })
                .range(from, to)
          ).catch(err => {
            console.error('[Dashboard] Supabase fetch error:', err);
            return null;
          }),
          15000,
          null
        );
      }

      // IndexedDB timeout (4s) — increased from 2s to avoid empty results on slow iOS devices
      const offlineResult = await readOfflineWithTimeout(offlinePromise, 4000);
      const offlineReadCompleted = offlineResult.kind === 'data';

      // Show offline/cached data immediately (stale-while-revalidate).
      // Defensive client-side filter on top of the server-side `.not.ilike`
      // — IDB-sourced rows haven't been through the server filter and may
      // include leaked e2e fixture rows from a prior pre-filter session.
      const offlineDataRaw = offlineResult.kind === 'data' ? offlineResult.rows : [];
      const offlineData = filterOutE2EFixtures(offlineDataRaw, E2E_INSPECTION_MARKER_COLUMNS);
      if (offlineData.length > 0 && !hasPaintedInspectionsRef.current) {
        applyRowsIfChanged(setInspections, offlineData);
        writeDashboardCache('dashboard-cache-inspections', offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Stale-while-revalidate inspections from cache:', offlineData.length);
        }
      }

      // Always try to get fresh data from network (runs in parallel)
      if (navigator.onLine && sessionValid) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          // Drift beacon: surface when IDB and server disagree on row count
          // so we can quantify how often the offline pre-paint suppression
          // is masking a real save/reconcile bug. Throttled to once per
          // 5 min per table to avoid Sentry spam. Skipped when the offline
          // read timed out so we don't pollute the metric with false zeros.
          maybeReportDashboardDrift('inspections', offlineData.length, networkData.length, offlineReadCompleted);
          applyRowsIfChanged(setInspections, networkData);
          hasPaintedInspectionsRef.current = true;
          writeDashboardCache('dashboard-cache-inspections', networkData);

          // Reconcile: quarantine local rows the server no longer returns,
          // so the cached count cannot drift above the authoritative count.
          reconcileServerDeletions({
            table: 'inspections',
            localRows: offlineData,
            serverRows: networkData,
            userId,
            isSuperAdmin,
          }).catch(err => console.warn('[Dashboard] inspections reconcile failed:', err));
          // Background save to offline storage (fire-and-forget)
          // Stamp synced_at so localIsNewer guard knows this is server-sourced data
          const now = new Date().toISOString();
          Promise.all(networkData.map(async (inspection) => {
            const localRecord = await getOfflineInspection(inspection.id);
            if (shouldPreserveLocalRecord(localRecord, inspection)) {
              // Exception: if server synced_at >= local updated_at, the data WAS synced -- allow overwrite
              const serverSyncedAt = inspection.synced_at ? new Date(inspection.synced_at).getTime() : 0;
              const localUpdatedAt = localRecord?.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
              if (serverSyncedAt < localUpdatedAt) {
                console.log('[Dashboard] Preserving unsynced local inspection:', inspection.id);
                return;
              }
              console.log('[Dashboard] Server synced_at >= local updated_at, allowing overwrite:', inspection.id);
            }
            // V1: Preserve local synced_at if it exists -- bumping it falsely marks unsynced child rows as fresh
            const preservedSyncedAt = localRecord?.synced_at || inspection.synced_at || now;
            // F3: Never let an older local updated_at shadow a fresher server one
            const localUpd = localRecord?.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
            const serverUpd = inspection.updated_at ? new Date(inspection.updated_at).getTime() : 0;
            const preservedUpdatedAt = localUpd > serverUpd ? localRecord.updated_at : inspection.updated_at;
            return saveInspectionOffline(
              { ...inspection, updated_at: preservedUpdatedAt, synced_at: preservedSyncedAt },
              { markDirty: false, explicitUserSave: false, dispatchSyncEvent: false },
            );
          }))
            .then(async () => {
              // ORPHAN CLEANUP — deferred to avoid blocking render
              const runOrphanCleanup = async () => { try {
                // Rate limit: only run orphan cleanup once per hour
                const ORPHAN_CLEANUP_COOLDOWN = 3600000; // 1 hour
                const lastCleanupKey = 'lastOrphanCleanup_inspections';
                const lastCleanup = parseInt(localStorage.getItem(lastCleanupKey) || '0');
                if (Date.now() - lastCleanup < ORPHAN_CLEANUP_COOLDOWN) {
                  if (import.meta.env.DEV) console.log('[Dashboard] Inspection orphan cleanup on cooldown -- skipping');
                } else {
                // H1: Fetch EXHAUSTIVE id list from server (no .limit) so the
                // 500-row display cap doesn't cause records past page 1 to be
                // treated as orphans and silently deleted from IDB.
                let serverIds: Set<string>;
                try {
                  const idQuery = supabase
                    .from('inspections')
                    .select('id')
                    .is('deleted_at', null)
                    // Mirror the display-time e2e fixture filter — keeps
                    // serverIds consistent so any marker rows lingering in
                    // local IDB are correctly flagged as orphans and reaped.
                    .not('location', 'ilike', `${E2E_MARKER_PREFIX}%`)
                    .not('organization', 'ilike', `${E2E_MARKER_PREFIX}%`);
                  if (!isSuperAdmin) idQuery.eq('inspector_id', userId);
                  const { data: idRows, error: idErr } = await idQuery;
                  if (idErr) throw idErr;
                  serverIds = new Set((idRows || []).map((r: { id: string }) => r.id));
                } catch (e) {
                  console.warn('[Dashboard] Inspection orphan id-fetch failed -- skipping cleanup', e);
                  return;
                }
                const localInspections = await getOfflineInspections(userId);
                const nonTempLocals = localInspections.filter(l => !l.id.startsWith('temp-'));

                // SAFETY: empty server set with non-empty local — likely RLS/network glitch
                if (serverIds.size === 0 && nonTempLocals.length > 0) {
                  console.warn('[Dashboard] Server returned 0 inspection ids but local has records -- skipping orphan cleanup');
                } else if (serverIds.size < nonTempLocals.length * 0.5 && nonTempLocals.length > 5) {
                  console.warn('[Dashboard] Server returned far fewer inspections than local -- skipping orphan cleanup', {
                    server: serverIds.size,
                    local: nonTempLocals.length,
                  });
                } else if (isSyncInProgress()) {
                  console.log('[Dashboard] Sync in progress -- skipping inspection orphan cleanup');
                } else {
                  for (const local of localInspections) {
                    if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
                      const updatedAt = local.updated_at ? new Date(local.updated_at).getTime() : 0;
                      const createdAt = local.created_at ? new Date(local.created_at).getTime() : 0;
                      const recencyTs = Math.max(updatedAt, createdAt);
                      const isRecentlyModified = (Date.now() - recencyTs) < 60000;
                      const isRecentlyCreated = (Date.now() - createdAt) < 300000; // 5 minutes
                      if (isRecentlyModified || isRecentlyCreated) {
                        console.log('[Dashboard] Skipping orphan cleanup for recent inspection:', local.id);
                        continue;
                      }
                      // LAST RESORT: Log deleted orphan for recovery
                      try {
                        const orphanLog = JSON.parse(localStorage.getItem('deletedOrphans') || '[]');
                        orphanLog.push({ ...local, deletedAt: new Date().toISOString(), type: 'inspection' });
                        if (orphanLog.length > 20) orphanLog.shift();
                        localStorage.setItem('deletedOrphans', JSON.stringify(orphanLog));
                      } catch {}
                      if (import.meta.env.DEV) console.log('[Dashboard] Removing orphaned local inspection:', local.id);
                      await deleteOfflineInspection(local.id);
                      // Clean up orphaned child data
                      const bypassOpt = { bypassTempGuard: true };
                      await Promise.all([
                        clearRelatedDataOffline('systems', local.id, bypassOpt),
                        clearRelatedDataOffline('ziplines', local.id, bypassOpt),
                        clearRelatedDataOffline('equipment', local.id, bypassOpt),
                        clearRelatedDataOffline('standards', local.id, bypassOpt),
                        clearRelatedDataOffline('summary', local.id, bypassOpt),
                      ]).catch(() => {});
                    }
                  }
                  localStorage.setItem(lastCleanupKey, String(Date.now()));
                }
                }
              } catch (cleanupErr) {
                console.warn('[Dashboard] Orphan cleanup failed:', cleanupErr);
              } };
              // Yield to UI thread before running cleanup
              if ('requestIdleCallback' in window) {
                (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(() => runOrphanCleanup());
              } else {
                setTimeout(runOrphanCleanup, 0);
              }
            })
            .catch(err => console.error('[Dashboard] Error batch saving inspections:', err));
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded from Supabase:', networkData.length);
          }
          return { networkSuccess: true, definitive: true };
        } else if (networkData !== null && sessionValid) {
          // Server confirmed zero reports — this is a definitive empty result
          applyRowsIfChanged(setInspections, []);
          // The empty network result IS authoritative, so subsequent
          // refreshes should skip the offline pre-paint even though the
          // happy-path setter above wasn't reached.
          hasPaintedInspectionsRef.current = true;
          writeDashboardCache('dashboard-cache-inspections', []);
          return { networkSuccess: true, definitive: true };
        } else if (networkData === null && offlineData.length > 0) {
          // Network failed -- fall back to offline data (definitive from offline)
          applyRowsIfChanged(setInspections, offlineData);
          return { networkSuccess: false, definitive: true };
        }
        // networkData === null and no offline data — not definitive
        return { networkSuccess: false, definitive: offlineData.length > 0 };
      }
      // Offline-only: definitive if we got offline data or cache had data
      return { networkSuccess: false, definitive: true };
    } catch (error) {
      console.error("Error loading inspections:", error);
      return { networkSuccess: false, definitive: false };
    }
  };

  const loadTrainingReports = async (cachedUserId?: string, cachedIsSuperAdmin?: boolean, sessionValid: boolean = true): Promise<{ networkSuccess: boolean; definitive: boolean }> => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // Get super admin status if not passed (for backward compatibility)
      const isSuperAdmin = cachedIsSuperAdmin ?? await getSuperAdminStatusWithCache();
      
      // PARALLEL LOADING: Start both fetches simultaneously
      const offlinePromise = getOfflineTrainings(userId, isSuperAdmin).catch(() => []);
      
      let supabasePromise: Promise<DbRow[] | null> = Promise.resolve([]);
      if (navigator.onLine && sessionValid) {
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          // M13: Paginate to capture full result set for super-admin views.
          fetchAllPaginated<DbRow>(
            'trainings',
            (from, to) =>
              supabase
                .from("trainings")
                .select(`
                  id, inspector_id, organization, trainer_of_record, start_date,
                  end_date, status, created_at, updated_at, synced_at,
                  latest_report_generated_at, report_version, deleted_at,
                  trainer:profiles!trainings_inspector_id_profiles_fkey(first_name, last_name, avatar_url)
                `)
                .is('deleted_at', null)
                .order("created_at", { ascending: false })
                .range(from, to)
          ).catch(err => {
            console.error('[Dashboard] Supabase trainings fetch error:', err);
            return null;
          }),
          15000,
          null
        );
      }

      // IndexedDB timeout (4s) — increased from 2s to avoid empty results on slow iOS devices
      const offlineResult = await readOfflineWithTimeout(offlinePromise, 4000);
      const offlineReadCompleted = offlineResult.kind === 'data';
      const offlineData = offlineResult.kind === 'data' ? offlineResult.rows : [];
      if (offlineData.length > 0 && !hasPaintedTrainingsRef.current) {
        applyRowsIfChanged(setTrainings, offlineData);
        writeDashboardCache('dashboard-cache-trainings', offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Stale-while-revalidate trainings from cache:', offlineData.length);
        }
      }

      // Always try to get fresh data from network
      if (navigator.onLine && sessionValid) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          maybeReportDashboardDrift('trainings', offlineData.length, networkData.length, offlineReadCompleted);
          applyRowsIfChanged(setTrainings, networkData);
          hasPaintedTrainingsRef.current = true;
          writeDashboardCache('dashboard-cache-trainings', networkData);

          reconcileServerDeletions({
            table: 'trainings',
            localRows: offlineData,
            serverRows: networkData,
            userId,
            isSuperAdmin,
          }).catch(err => console.warn('[Dashboard] trainings reconcile failed:', err));
          const nowT = new Date().toISOString();
          Promise.all(networkData.map(async (training) => {
            const localRecord = await getOfflineTraining(training.id);
            if (shouldPreserveLocalRecord(localRecord, training)) {
              const serverSyncedAt = training.synced_at ? new Date(training.synced_at).getTime() : 0;
              const localUpdatedAt = localRecord?.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
              if (serverSyncedAt < localUpdatedAt) {
                console.log('[Dashboard] Preserving unsynced local training:', training.id);
                return;
              }
              console.log('[Dashboard] Server synced_at >= local updated_at, allowing overwrite:', training.id);
            }
            // V1: Preserve local synced_at if it exists -- bumping it falsely marks unsynced child rows as fresh
            const preservedSyncedAtT = localRecord?.synced_at || training.synced_at || nowT;
            // F3: Never let an older local updated_at shadow a fresher server one
            const localUpdT = localRecord?.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
            const serverUpdT = training.updated_at ? new Date(training.updated_at).getTime() : 0;
            const preservedUpdatedAtT = localUpdT > serverUpdT ? localRecord.updated_at : training.updated_at;
            return saveTrainingOffline(
              { ...training, updated_at: preservedUpdatedAtT, synced_at: preservedSyncedAtT },
              { markDirty: false, explicitUserSave: false, dispatchSyncEvent: false },
            );
          }))
            .then(async () => {
              // ORPHAN CLEANUP with threshold guard + rate limiting (Vector 4)
              try {
                const ORPHAN_CLEANUP_COOLDOWN = 3600000;
                const lastCleanupKey = 'lastOrphanCleanup_trainings';
                const lastCleanup = parseInt(localStorage.getItem(lastCleanupKey) || '0');
                if (Date.now() - lastCleanup < ORPHAN_CLEANUP_COOLDOWN) {
                  if (import.meta.env.DEV) console.log('[Dashboard] Training orphan cleanup on cooldown -- skipping');
                } else {
                // H1: Exhaustive server id-fetch (no .limit) — the display query
                // is capped at 500 and must not be the orphan source-of-truth.
                let serverIds: Set<string>;
                try {
                  const idQuery = supabase.from('trainings').select('id').is('deleted_at', null);
                  if (!isSuperAdmin) idQuery.eq('inspector_id', userId);
                  const { data: idRows, error: idErr } = await idQuery;
                  if (idErr) throw idErr;
                  serverIds = new Set((idRows || []).map((r: { id: string }) => r.id));
                } catch (e) {
                  console.warn('[Dashboard] Training orphan id-fetch failed -- skipping cleanup', e);
                  return;
                }
                const localTrainings = await getOfflineTrainings(userId);
                const nonTempLocals = localTrainings.filter(l => !l.id.startsWith('temp-'));

                if (serverIds.size === 0 && nonTempLocals.length > 0) {
                  console.warn('[Dashboard] Server returned 0 training ids but local has records -- skipping orphan cleanup');
                } else if (serverIds.size < nonTempLocals.length * 0.5 && nonTempLocals.length > 5) {
                  console.warn('[Dashboard] Server returned far fewer trainings than local -- skipping orphan cleanup', {
                    server: serverIds.size,
                    local: nonTempLocals.length,
                  });
                } else if (isSyncInProgress()) {
                  console.log('[Dashboard] Sync in progress -- skipping training orphan cleanup');
                } else {
                  for (const local of localTrainings) {
                    if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
                      const updatedAt = local.updated_at ? new Date(local.updated_at).getTime() : 0;
                      const createdAt = local.created_at ? new Date(local.created_at).getTime() : 0;
                      const recencyTs = Math.max(updatedAt, createdAt);
                      const isRecentlyModified = (Date.now() - recencyTs) < 60000;
                      const isRecentlyCreated = (Date.now() - createdAt) < 300000;
                      if (isRecentlyModified || isRecentlyCreated) {
                        console.log('[Dashboard] Skipping orphan cleanup for recent training:', local.id);
                        continue;
                      }
                      try {
                        const orphanLog = JSON.parse(localStorage.getItem('deletedOrphans') || '[]');
                        orphanLog.push({ ...local, deletedAt: new Date().toISOString(), type: 'training' });
                        if (orphanLog.length > 20) orphanLog.shift();
                        localStorage.setItem('deletedOrphans', JSON.stringify(orphanLog));
                      } catch {}
                      if (import.meta.env.DEV) console.log('[Dashboard] Removing orphaned local training:', local.id);
                      await deleteOfflineTraining(local.id);
                      // Clean up orphaned child data
                      const bypassOpt = { bypassTempGuard: true };
                      await Promise.all([
                        clearTrainingDataOffline('delivery_approaches', local.id, bypassOpt),
                        clearTrainingDataOffline('operating_systems', local.id, bypassOpt),
                        clearTrainingDataOffline('immediate_attention', local.id, bypassOpt),
                        clearTrainingDataOffline('verifiable_items', local.id, bypassOpt),
                        clearTrainingDataOffline('systems_in_place', local.id, bypassOpt),
                        clearTrainingDataOffline('summary', local.id, bypassOpt),
                      ]).catch(() => {});
                    }
                  }
                  localStorage.setItem(lastCleanupKey, String(Date.now()));
                }
                }
              } catch (cleanupErr) {
                console.warn('[Dashboard] Training orphan cleanup failed:', cleanupErr);
              }
            })
            .catch(err => console.error('[Dashboard] Error batch saving trainings:', err));
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded training reports from Supabase:', networkData.length);
          }
          return { networkSuccess: true, definitive: true };
        } else if (networkData !== null && sessionValid) {
          applyRowsIfChanged(setTrainings, []);
          hasPaintedTrainingsRef.current = true;
          writeDashboardCache('dashboard-cache-trainings', []);
          return { networkSuccess: true, definitive: true };
        } else if (networkData === null && offlineData.length > 0) {
          applyRowsIfChanged(setTrainings, offlineData);
          return { networkSuccess: false, definitive: true };
        }
        return { networkSuccess: false, definitive: offlineData.length > 0 };
      }
      return { networkSuccess: false, definitive: true };
    } catch (error) {
      console.error("Error loading training reports:", error);
      return { networkSuccess: false, definitive: false };
    }
  };

  const loadDailyAssessments = async (cachedUserId?: string, cachedIsSuperAdmin?: boolean, sessionValid: boolean = true): Promise<{ networkSuccess: boolean; definitive: boolean }> => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // Get super admin status if not passed (for backward compatibility)
      const isSuperAdmin = cachedIsSuperAdmin ?? await getSuperAdminStatusWithCache();
      
      // PARALLEL LOADING: Start both fetches simultaneously
      const offlinePromise = getOfflineDailyAssessments(userId, isSuperAdmin).catch(() => []);
      
      let supabasePromise: Promise<DbRow[] | null> = Promise.resolve([]);
      if (navigator.onLine && sessionValid) {
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          // M13: Paginate to capture full result set for super-admin views.
          fetchAllPaginated<DbRow>(
            'daily_assessments',
            (from, to) =>
              supabase
                .from("daily_assessments")
                .select(`
                  id, inspector_id, organization, site, trainer_of_record,
                  assessment_date, status, created_at, updated_at, synced_at,
                  latest_report_generated_at, report_version, deleted_at,
                  inspector:profiles!daily_assessments_inspector_id_profiles_fkey(first_name, last_name, avatar_url)
                `)
                .is('deleted_at', null)
                .order("assessment_date", { ascending: false })
                .range(from, to)
          ).catch(err => {
            console.error('[Dashboard] Supabase assessments fetch error:', err);
            return null;
          }),
          15000,
          null
        );
      }

      // IndexedDB timeout (4s) — increased from 2s to avoid empty results on slow iOS devices
      const offlineResult = await readOfflineWithTimeout(offlinePromise, 4000);
      const offlineReadCompleted = offlineResult.kind === 'data';
      const offlineData = offlineResult.kind === 'data' ? offlineResult.rows : [];
      if (offlineData.length > 0 && !hasPaintedDailyAssessmentsRef.current) {
        applyRowsIfChanged(setDailyAssessments, offlineData);
        writeDashboardCache('dashboard-cache-daily', offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Stale-while-revalidate assessments from cache:', offlineData.length);
        }
      }

      // Always try to get fresh data from network
      if (navigator.onLine && sessionValid) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          maybeReportDashboardDrift('daily_assessments', offlineData.length, networkData.length, offlineReadCompleted);
          applyRowsIfChanged(setDailyAssessments, networkData);
          hasPaintedDailyAssessmentsRef.current = true;
          writeDashboardCache('dashboard-cache-daily', networkData);

          reconcileServerDeletions({
            table: 'daily_assessments',
            localRows: offlineData,
            serverRows: networkData,
            userId,
            isSuperAdmin,
          }).catch(err => console.warn('[Dashboard] assessments reconcile failed:', err));
          const nowA = new Date().toISOString();
          Promise.all(networkData.map(async (assessment) => {
            const localRecord = await getOfflineDailyAssessment(assessment.id);
            if (shouldPreserveLocalRecord(localRecord, assessment)) {
              const serverSyncedAt = assessment.synced_at ? new Date(assessment.synced_at).getTime() : 0;
              const localUpdatedAt = localRecord?.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
              if (serverSyncedAt < localUpdatedAt) {
                console.log('[Dashboard] Preserving unsynced local daily assessment:', assessment.id);
                return;
              }
              console.log('[Dashboard] Server synced_at >= local updated_at, allowing overwrite:', assessment.id);
            }
            // V1: Preserve local synced_at if it exists -- bumping it falsely marks unsynced child rows as fresh
            const preservedSyncedAtA = localRecord?.synced_at || assessment.synced_at || nowA;
            // F3: Never let an older local updated_at shadow a fresher server one
            const localUpdA = localRecord?.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
            const serverUpdA = assessment.updated_at ? new Date(assessment.updated_at).getTime() : 0;
            const preservedUpdatedAtA = localUpdA > serverUpdA ? localRecord.updated_at : assessment.updated_at;
            return saveDailyAssessmentOffline(
              { ...assessment, updated_at: preservedUpdatedAtA, synced_at: preservedSyncedAtA },
              { markDirty: false, explicitUserSave: false, dispatchSyncEvent: false },
            );
          }))
            .then(async () => {
              // ORPHAN CLEANUP with threshold guard + rate limiting (Vector 4)
              try {
                const ORPHAN_CLEANUP_COOLDOWN = 3600000;
                const lastCleanupKey = 'lastOrphanCleanup_assessments';
                const lastCleanup = parseInt(localStorage.getItem(lastCleanupKey) || '0');
                if (Date.now() - lastCleanup < ORPHAN_CLEANUP_COOLDOWN) {
                  if (import.meta.env.DEV) console.log('[Dashboard] Assessment orphan cleanup on cooldown -- skipping');
                } else {
                // H1: Exhaustive server id-fetch (no .limit) — the display query
                // is capped at 500 and must not be the orphan source-of-truth.
                let serverIds: Set<string>;
                try {
                  const idQuery = supabase.from('daily_assessments').select('id').is('deleted_at', null);
                  if (!isSuperAdmin) idQuery.eq('inspector_id', userId);
                  const { data: idRows, error: idErr } = await idQuery;
                  if (idErr) throw idErr;
                  serverIds = new Set((idRows || []).map((r: { id: string }) => r.id));
                } catch (e) {
                  console.warn('[Dashboard] Assessment orphan id-fetch failed -- skipping cleanup', e);
                  return;
                }
                const localAssessments = await getOfflineDailyAssessments(userId);
                const nonTempLocals = localAssessments.filter(l => !l.id.startsWith('temp-'));

                if (serverIds.size === 0 && nonTempLocals.length > 0) {
                  console.warn('[Dashboard] Server returned 0 assessment ids but local has records -- skipping orphan cleanup');
                } else if (serverIds.size < nonTempLocals.length * 0.5 && nonTempLocals.length > 5) {
                  console.warn('[Dashboard] Server returned far fewer assessments than local -- skipping orphan cleanup', {
                    server: serverIds.size,
                    local: nonTempLocals.length,
                  });
                } else if (isSyncInProgress()) {
                  console.log('[Dashboard] Sync in progress -- skipping assessment orphan cleanup');
                } else {
                  for (const local of localAssessments) {
                    if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
                      const updatedAt = local.updated_at ? new Date(local.updated_at).getTime() : 0;
                      const createdAt = local.created_at ? new Date(local.created_at).getTime() : 0;
                      const recencyTs = Math.max(updatedAt, createdAt);
                      const isRecentlyModified = (Date.now() - recencyTs) < 60000;
                      const isRecentlyCreated = (Date.now() - createdAt) < 300000;
                      if (isRecentlyModified || isRecentlyCreated) {
                        console.log('[Dashboard] Skipping orphan cleanup for recent assessment:', local.id);
                        continue;
                      }
                      try {
                        const orphanLog = JSON.parse(localStorage.getItem('deletedOrphans') || '[]');
                        orphanLog.push({ ...local, deletedAt: new Date().toISOString(), type: 'daily_assessment' });
                        if (orphanLog.length > 20) orphanLog.shift();
                        localStorage.setItem('deletedOrphans', JSON.stringify(orphanLog));
                      } catch {}
                      if (import.meta.env.DEV) console.log('[Dashboard] Removing orphaned local assessment:', local.id);
                      await deleteOfflineDailyAssessment(local.id);
                      // Clean up orphaned child data
                      const bypassOpt = { bypassTempGuard: true };
                      await Promise.all([
                        clearAssessmentDataOffline('beginning_of_day', local.id, bypassOpt),
                        clearAssessmentDataOffline('end_of_day', local.id, bypassOpt),
                        clearAssessmentDataOffline('operating_systems', local.id, bypassOpt),
                        clearAssessmentDataOffline('equipment_checks', local.id, bypassOpt),
                        clearAssessmentDataOffline('structure_checks', local.id, bypassOpt),
                        clearAssessmentDataOffline('environment_checks', local.id, bypassOpt),
                      ]).catch(() => {});
                    }
                  }
                  localStorage.setItem(lastCleanupKey, String(Date.now()));
                }
                }
              } catch (cleanupErr) {
                console.warn('[Dashboard] Assessment orphan cleanup failed:', cleanupErr);
              }
            })
            .catch(err => console.error('[Dashboard] Error batch saving assessments:', err));
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded daily assessments from Supabase:', networkData.length);
          }
          return { networkSuccess: true, definitive: true };
        } else if (networkData !== null && sessionValid) {
          applyRowsIfChanged(setDailyAssessments, []);
          hasPaintedDailyAssessmentsRef.current = true;
          writeDashboardCache('dashboard-cache-daily', []);
          return { networkSuccess: true, definitive: true };
        } else if (networkData === null && offlineData.length > 0) {
          applyRowsIfChanged(setDailyAssessments, offlineData);
          return { networkSuccess: false, definitive: true };
        }
        return { networkSuccess: false, definitive: offlineData.length > 0 };
      }
      return { networkSuccess: false, definitive: true };
    } catch (error) {
      console.error("Error loading daily assessments:", error);
      return { networkSuccess: false, definitive: false };
    }
  };

  const loadJCFs = async (cachedUserId?: string, cachedIsSuperAdmin?: boolean, sessionValid: boolean = true): Promise<{ networkSuccess: boolean; definitive: boolean }> => {
    try {
      const userId = cachedUserId || (await getUserWithCache())?.id;
      const isSuperAdmin = cachedIsSuperAdmin ?? await getSuperAdminStatusWithCache();

      const offlinePromise = getOfflineJCFs(userId, isSuperAdmin).catch(() => []);

      let supabasePromise: Promise<DbRow[] | null> = Promise.resolve([]);
      if (navigator.onLine && sessionValid) {
        supabasePromise = withNetworkTimeout(
          fetchAllPaginated<DbRow>(
            'jcf_reports',
            (from, to) =>
              supabase
                .from("jcf_reports")
                .select(`
                  id, inspector_id, organization, location, date_of_work,
                  status, created_at, updated_at, synced_at,
                  latest_report_generated_at, report_version, deleted_at,
                  inspector:profiles!jcf_reports_inspector_id_profiles_fkey(first_name, last_name, avatar_url)
                `)
                .is('deleted_at', null)
                .order("date_of_work", { ascending: false })
                .range(from, to)
          ).catch(err => {
            console.error('[Dashboard] Supabase JCFs fetch error:', err);
            return null;
          }),
          15000,
          null
        );
      }

      const offlineResult = await readOfflineWithTimeout(offlinePromise, 4000);
      const offlineReadCompleted = offlineResult.kind === 'data';
      const offlineData = offlineResult.kind === 'data' ? offlineResult.rows : [];
      if (offlineData.length > 0 && !hasPaintedJCFsRef.current) {
        applyRowsIfChanged(setJcfs, offlineData);
        writeDashboardCache('dashboard-cache-jcfs', offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Stale-while-revalidate JCFs from cache:', offlineData.length);
        }
      }

      if (navigator.onLine && sessionValid) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          maybeReportDashboardDrift('jcf_reports', offlineData.length, networkData.length, offlineReadCompleted);
          applyRowsIfChanged(setJcfs, networkData);
          hasPaintedJCFsRef.current = true;
          writeDashboardCache('dashboard-cache-jcfs', networkData);

          reconcileServerDeletions({
            table: 'jcf_reports',
            localRows: offlineData,
            serverRows: networkData,
            userId,
            isSuperAdmin,
          }).catch(err => console.warn('[Dashboard] JCFs reconcile failed:', err));

          const nowJ = new Date().toISOString();
          Promise.all(networkData.map(async (jcf) => {
            const localRecord = await getOfflineJCF(jcf.id);
            if (shouldPreserveLocalRecord(localRecord, jcf)) {
              const serverSyncedAt = jcf.synced_at ? new Date(jcf.synced_at).getTime() : 0;
              const localUpdatedAt = localRecord?.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
              if (serverSyncedAt < localUpdatedAt) {
                console.log('[Dashboard] Preserving unsynced local JCF:', jcf.id);
                return;
              }
              console.log('[Dashboard] Server synced_at >= local updated_at, allowing overwrite:', jcf.id);
            }
            const preservedSyncedAtJ = localRecord?.synced_at || jcf.synced_at || nowJ;
            const localUpdJ = localRecord?.updated_at ? new Date(localRecord.updated_at).getTime() : 0;
            const serverUpdJ = jcf.updated_at ? new Date(jcf.updated_at).getTime() : 0;
            const preservedUpdatedAtJ = localUpdJ > serverUpdJ ? localRecord.updated_at : jcf.updated_at;
            return saveJCFOffline(
              { ...jcf, updated_at: preservedUpdatedAtJ, synced_at: preservedSyncedAtJ },
              { markDirty: false, explicitUserSave: false, dispatchSyncEvent: false },
            );
          }))
            .then(async () => {
              try {
                const ORPHAN_CLEANUP_COOLDOWN = 3600000;
                const lastCleanupKey = 'lastOrphanCleanup_jcfs';
                const lastCleanup = parseInt(localStorage.getItem(lastCleanupKey) || '0');
                if (Date.now() - lastCleanup < ORPHAN_CLEANUP_COOLDOWN) {
                  if (import.meta.env.DEV) console.log('[Dashboard] JCF orphan cleanup on cooldown -- skipping');
                } else {
                  let serverIds: Set<string>;
                  try {
                    const idQuery = supabase.from('jcf_reports').select('id').is('deleted_at', null);
                    if (!isSuperAdmin) idQuery.eq('inspector_id', userId);
                    const { data: idRows, error: idErr } = await idQuery;
                    if (idErr) throw idErr;
                    serverIds = new Set((idRows || []).map((r: { id: string }) => r.id));
                  } catch (e) {
                    console.warn('[Dashboard] JCF orphan id-fetch failed -- skipping cleanup', e);
                    return;
                  }
                  const localJcfs = await getOfflineJCFs(userId);
                  const nonTempLocals = localJcfs.filter(l => !l.id.startsWith('temp-'));

                  if (serverIds.size === 0 && nonTempLocals.length > 0) {
                    console.warn('[Dashboard] Server returned 0 JCF ids but local has records -- skipping orphan cleanup');
                  } else if (serverIds.size < nonTempLocals.length * 0.5 && nonTempLocals.length > 5) {
                    console.warn('[Dashboard] Server returned far fewer JCFs than local -- skipping orphan cleanup', {
                      server: serverIds.size,
                      local: nonTempLocals.length,
                    });
                  } else if (isSyncInProgress()) {
                    console.log('[Dashboard] Sync in progress -- skipping JCF orphan cleanup');
                  } else {
                    for (const local of localJcfs) {
                      if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
                        const updatedAt = local.updated_at ? new Date(local.updated_at).getTime() : 0;
                        const createdAt = local.created_at ? new Date(local.created_at).getTime() : 0;
                        const recencyTs = Math.max(updatedAt, createdAt);
                        const isRecentlyModified = (Date.now() - recencyTs) < 60000;
                        const isRecentlyCreated = (Date.now() - createdAt) < 300000;
                        if (isRecentlyModified || isRecentlyCreated) {
                          console.log('[Dashboard] Skipping orphan cleanup for recent JCF:', local.id);
                          continue;
                        }
                        try {
                          const orphanLog = JSON.parse(localStorage.getItem('deletedOrphans') || '[]');
                          orphanLog.push({ ...local, deletedAt: new Date().toISOString(), type: 'jcf_report' });
                          if (orphanLog.length > 20) orphanLog.shift();
                          localStorage.setItem('deletedOrphans', JSON.stringify(orphanLog));
                        } catch {}
                        if (import.meta.env.DEV) console.log('[Dashboard] Removing orphaned local JCF:', local.id);
                        await deleteOfflineJCF(local.id);
                      }
                    }
                    localStorage.setItem(lastCleanupKey, String(Date.now()));
                  }
                }
              } catch (cleanupErr) {
                console.warn('[Dashboard] JCF orphan cleanup failed:', cleanupErr);
              }
            })
            .catch(err => console.error('[Dashboard] Error batch saving JCFs:', err));

          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded JCFs from Supabase:', networkData.length);
          }
          return { networkSuccess: true, definitive: true };
        } else if (networkData !== null && sessionValid) {
          applyRowsIfChanged(setJcfs, []);
          hasPaintedJCFsRef.current = true;
          writeDashboardCache('dashboard-cache-jcfs', []);
          return { networkSuccess: true, definitive: true };
        } else if (networkData === null && offlineData.length > 0) {
          applyRowsIfChanged(setJcfs, offlineData);
          return { networkSuccess: false, definitive: true };
        }
        return { networkSuccess: false, definitive: offlineData.length > 0 };
      }
      return { networkSuccess: false, definitive: true };
    } catch (error) {
      console.error("Error loading JCFs:", error);
      return { networkSuccess: false, definitive: false };
    }
  };

  // Sign-out is now handled globally by AuthenticatedHeader

  const handleDeleteClick = (e: React.MouseEvent, inspection: DbRow) => {
    e.stopPropagation();
    triggerHaptic('light'); // Light haptic when opening delete dialog
    setInspectionToDelete(inspection);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    const itemToDelete = inspectionToDelete || reportToDelete;
    if (!itemToDelete) return;

    triggerHaptic('warning'); // Warning haptic for destructive action

    const isInspection = !!inspectionToDelete;

    // Get current user ID for soft delete
    const userId = currentUser?.id;
    if (!userId) {
      toast.error("Unable to identify user for deletion");
      return;
    }

    // Import soft delete utility
    const { addDays } = await import('date-fns');
    const now = new Date();
    const retentionUntil = addDays(now, 60);
    
    const softDeleteData = {
      deleted_at: now.toISOString(),
      deleted_by: userId,
      retention_until: retentionUntil.toISOString(),
    };

    try {
      if (isInspection) {
        // Soft delete from offline storage
        await deleteOfflineInspection(inspectionToDelete.id);

        if (navigator.onLine) {
          // Use SECURITY DEFINER RPC so soft-delete works for all owners
          // regardless of post-update RLS visibility.
          const { data, error } = await supabase.rpc('soft_delete_record', {
            p_table_name: 'inspections',
            p_record_id: inspectionToDelete.id,
            p_deleted_by: userId,
            p_retention_days: 60,
          });

          if (error) throw error;
          if (data === false) throw new Error('Inspection not found or already deleted.');
          
          triggerHaptic('success');
          toast.success("Inspection moved to trash. It will be permanently deleted in 60 days.");
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Inspection soft-deleted:', inspectionToDelete.id);
          }
        } else {
          // Queue for later soft-deletion
          await queueOperation('update', inspectionToDelete.id, { ...inspectionToDelete, ...softDeleteData });
          triggerHaptic('success');
          toast.success("Inspection will be deleted when you're back online.");
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Inspection soft-deletion queued:', inspectionToDelete.id);
          }
        }

        // Update UI
        setInspections(prev => prev.filter(i => i.id !== inspectionToDelete.id));
      } else if (reportToDelete) {
        // Determine if it's a training or daily assessment
        const isTraining = 'start_date' in reportToDelete;
        const isJCF = 'date_of_work' in reportToDelete;
        const isDailyAssessment = 'assessment_date' in reportToDelete && !('start_date' in reportToDelete) && !isJCF;

        if (isJCF) {
          await deleteOfflineJCF(reportToDelete.id);

          if (navigator.onLine) {
            const { data, error } = await supabase.rpc('soft_delete_record', {
              p_table_name: 'jcf_reports',
              p_record_id: reportToDelete.id,
              p_deleted_by: userId,
              p_retention_days: 60,
            });

            if (error) throw error;
            if (data === false) throw new Error('JCF not found or already deleted.');

            triggerHaptic('success');
            toast.success("Job Completion Form moved to trash. It will be permanently deleted in 60 days.");

            if (import.meta.env.DEV) {
              console.log('[Dashboard] JCF soft-deleted:', reportToDelete.id);
            }
          } else {
            await queueJCFOperation('update', reportToDelete.id, { ...reportToDelete, ...softDeleteData });
            triggerHaptic('success');
            toast.success("JCF will be deleted when you're back online.");
          }

          setJcfs(prev => prev.filter(j => j.id !== reportToDelete.id));
        } else if (isDailyAssessment) {
          // Soft delete daily assessment
          const { deleteOfflineDailyAssessment } = await import('@/lib/offline-storage');
          await deleteOfflineDailyAssessment(reportToDelete.id);

          if (navigator.onLine) {
            const { data, error } = await supabase.rpc('soft_delete_record', {
              p_table_name: 'daily_assessments',
              p_record_id: reportToDelete.id,
              p_deleted_by: userId,
              p_retention_days: 60,
            });

            if (error) throw error;
            if (data === false) throw new Error('Daily assessment not found or already deleted.');
            
            triggerHaptic('success');
            toast.success("Daily assessment moved to trash. It will be permanently deleted in 60 days.");
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Daily assessment soft-deleted:', reportToDelete.id);
            }
          } else {
            // Queue for later soft-deletion when back online
            await queueAssessmentOperation('update', reportToDelete.id, { ...reportToDelete, ...softDeleteData });
            triggerHaptic('success');
            toast.success("Assessment will be deleted when you're back online.");
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Daily assessment soft-deletion queued:', reportToDelete.id);
            }
          }

          // Update UI
          setDailyAssessments(prev => prev.filter(a => a.id !== reportToDelete.id));
        } else if (isTraining) {
          // Soft delete training report - remove from offline storage first
          await deleteOfflineTraining(reportToDelete.id);
          
          if (navigator.onLine) {
            const { data, error } = await supabase.rpc('soft_delete_record', {
              p_table_name: 'trainings',
              p_record_id: reportToDelete.id,
              p_deleted_by: userId,
              p_retention_days: 60,
            });

            if (error) throw error;
            if (data === false) throw new Error('Training not found or already deleted.');
            
            triggerHaptic('success');
            toast.success("Training moved to trash. It will be permanently deleted in 60 days.");
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Training soft-deleted:', reportToDelete.id);
            }
          } else {
            // Queue for later soft-deletion when back online
            await queueTrainingOperation('update', reportToDelete.id, { ...reportToDelete, ...softDeleteData });
            triggerHaptic('success');
            toast.success("Training will be deleted when you're back online.");
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Training soft-deletion queued:', reportToDelete.id);
            }
          }

          // Update UI
          setTrainings(prev => prev.filter(t => t.id !== reportToDelete.id));
        }
      }

      setDeleteDialogOpen(false);
      setInspectionToDelete(null);
      setReportToDelete(null);
    } catch (error) {
      const itemId = itemToDelete?.id || 'unknown';
      const step = isInspection ? 'inspection' : ('start_date' in (reportToDelete || {}) ? 'training' : 'daily_assessment');
      const errMessage = error instanceof Error ? error.message : String(error);
      const errCode = (error as { code?: string } | null)?.code;
      console.error(`[Dashboard] Soft-delete failed:`, { step, id: itemId, error: errMessage, code: errCode });

      const detail = errMessage.includes('row-level security')
        ? 'Permission denied. Please sign in again and retry.'
        : (errMessage || 'Unknown error');
      toast.error(`Failed to delete report: ${detail}`);
      triggerHaptic('error');
    }
  };

  const getStatusBadge = (inspection: DbRow) => {
    const unsyncedPhotosCount = photosByInspection[inspection.id] || 0;
    const isCurrentlySyncing = isSyncing && progress.currentItem === inspection.id;
    
    return (
      <div className="flex gap-1 items-center flex-nowrap transition-opacity duration-500">
        {/* Syncing: static badge, no spin/pulse */}
        {isCurrentlySyncing && (
          <Badge variant="default" className="gap-1 bg-primary/70 text-primary-foreground text-xs px-2 py-0 border-l-2 border-primary">
            <RefreshCw className="w-3 h-3" />
            <span className="hidden sm:inline">Syncing</span>
          </Badge>
        )}
        
        
        {/* Unsynced photos count */}
        {unsyncedPhotosCount > 0 && (
          <Badge variant="secondary" className="gap-1 text-xs px-2 py-0">
            <Cloud className="w-3 h-3" />
            {unsyncedPhotosCount}
          </Badge>
        )}
      </div>
    );
  };

  return (
    <div className="relative min-h-screen">
      
      
      
      {/* Pull to Refresh Indicator - Mobile Only */}
      {isActive && (
        <div 
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center md:hidden"
          style={{
            height: `${Math.min(pullDistance, 80)}px`,
            opacity: pullDistance / 80,
            transition: isPulling ? 'none' : 'all 0.3s ease-out',
          }}
        >
          <div className="bg-background/95 backdrop-blur-sm rounded-full p-3 shadow-lg border border-border">
            <RefreshCw 
              className={`w-6 h-6 text-primary ${shouldTriggerRefresh ? 'animate-spin' : ''}`}
              style={{
                transform: `rotate(${pullDistance * 2}deg)`,
                transition: shouldTriggerRefresh ? 'none' : 'transform 0.1s ease-out',
              }}
            />
          </div>
          {shouldTriggerRefresh && (
            <span className="ml-2 text-sm font-medium text-foreground">
              Release to sync
            </span>
          )}
        </div>
      )}

      {/* Stale Data Banner — shown when network queries repeatedly fail */}
      {showStaleDataBanner && (
        <div className="mx-auto max-w-6xl px-4 mt-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
            <CloudOff className="h-4 w-4 shrink-0" />
            <span>Unable to reach server — showing cached data. Pull to refresh or check your connection.</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 w-6 p-0"
              onClick={() => setShowStaleDataBanner(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
      
      {/* Background image */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <img
          src={getSessionBackground()}
          alt=""
          className="w-full h-full object-cover object-center"
        />
        
        {/* Gradient fade: ensures text/cards remain readable over full-page background */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/50 via-background/60 to-background/80" />
        
        {/* Reduced motion fallback */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/80 via-sky-900/70 to-blue-900/80 hidden motion-reduce:block" />
      </div>
      <div className="relative z-10 min-h-screen">
        <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5">
        <div className="container mx-auto px-1 md:px-4 py-3 md:py-4">
          {/* Top row - Logos, status indicators, and user dropdown */}
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-2 md:gap-3">
              <img src={belayReportsLogo} alt="Belay Reports" className="h-12 md:h-[4.5rem] w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/dashboard')} />
              <img src={acctLogo} alt="ACCT Accredited Vendor" className="h-8 md:h-12 w-auto object-contain" />
            </div>
            
            <div className="flex items-center gap-2 mr-14">
              {/* Minimal dot-based sync indicator */}
              <SyncPulse />
              
              {/* Pending uploads chip - visible when items are queued. Click to sync now. */}
              {unsyncedCount > 0 && !isSyncing && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => forceSync()}
                      disabled={isSyncing || !isOnline}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono text-xs text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={`${unsyncedCount} item${unsyncedCount === 1 ? '' : 's'} pending sync. Tap to sync now.`}
                    >
                      <Cloud className="w-3 h-3" />
                      {unsyncedCount} pending
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {unsyncedCount} item{unsyncedCount === 1 ? '' : 's'} queued. {isOnline ? "Will sync automatically — tap to sync now." : "Will sync when you're back online."}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              
              <div className="hidden lg:flex">
                <NetworkQualityIndicator />
              </div>

              
              
              {isSuperAdmin && (
                <Badge variant="default" className="bg-warning/90 text-warning-foreground border border-warning/50 backdrop-blur-[12px] shadow-lg shadow-warning/20 animate-pulse hidden sm:flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Super Admin
                </Badge>
              )}
            </div>
            
            {/* UserProfileDropdown is now in the global AuthenticatedHeader */}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-1 md:px-4 py-8">
        <IOSInstallPromptOnce />
        <BackgroundSyncStatus />
        {!isOnline && (
          <div
            role="status"
            data-testid="dashboard-offline-banner"
            className="mb-3 rounded-md border border-amber-200/60 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          >
            Working offline — showing locally cached reports. Edits save to this device and will sync when you reconnect.
          </div>
        )}
        {/* Inline sync status -- always present, visibility via opacity only */}
        <div
          className={cn(
            "mb-2 flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded",
            "border transition-all duration-500 ease-in-out",
            unsyncedCount > 0
              ? "opacity-100 text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30"
              : "opacity-0 pointer-events-none border-transparent"
          )}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-[pulse_3s_ease-in-out_infinite]" />
          <span>{unsyncedCount} pending</span>
          <button
            onClick={() => forceSync()}
            disabled={isSyncing || !navigator.onLine}
            className="ml-auto text-xs underline underline-offset-2 hover:no-underline disabled:opacity-40 disabled:no-underline"
          >
            {isSyncing ? 'syncing...' : 'sync now'}
          </button>
        </div>

        {/* Conflicts are now resolved automatically via last-write-wins strategy */}

        {/* Foyer Section */}
        <section className="mb-12">
          <div className="rounded-lg bg-background/40 backdrop-blur-sm">
            <div className="container mx-auto px-2 md:px-4 py-16">
              <div className="text-center mb-8">
                <h2 className="text-4xl font-bold text-primary dark:text-white mb-2">
                  <span className="block md:inline">Welcome to</span>{' '}
                  <span className="block md:inline">Belay Reports</span>
                </h2>
                <p className="text-lg text-muted-foreground dark:text-neutral-200">
                  Choose a report type to get started
                </p>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
                {/* INSPECTION CARD - FUNCTIONAL */}
                <Card 
                  className="relative overflow-visible hover:shadow-2xl transition-all duration-300 border-2 hover:border-blue-500 cursor-pointer group"
                  onClick={() => {
                    triggerHaptic('light'); // Haptic feedback when starting new inspection
                    navigate("/inspection/new");
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 to-transparent opacity-50 rounded-lg" />
                  <CardHeader className="relative z-10 text-center pb-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FileText className="w-8 h-8 text-blue-600" />
                    </div>
                    <CardTitle className="text-2xl mb-2">Inspection Report</CardTitle>
                    <CardDescription className="text-base">
                      Create a new equipment and facility inspection report
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10 text-center pb-6">
                    <GradientButton className="w-full group-hover:scale-105 transition-transform">
                      Start Inspection
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </GradientButton>
                  </CardContent>
                </Card>

                {/* TRAINING CARD - FUNCTIONAL */}
                <Card 
                  className="relative overflow-visible hover:shadow-2xl transition-all duration-300 border-2 hover:border-green-500 cursor-pointer group"
                  onClick={() => {
                    triggerHaptic('light');
                    navigate("/training/new");
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-sky-50/30 to-transparent opacity-50 rounded-lg" />
                  <CardHeader className="relative z-10 text-center pb-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <GraduationCap className="w-8 h-8 text-green-600" />
                    </div>
                    <CardTitle className="text-2xl mb-2">Training Report</CardTitle>
                    <CardDescription className="text-base">
                      Document training sessions and participant assessments
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10 text-center pb-6">
                    <GradientButton className="w-full group-hover:scale-105 transition-transform">
                      Start Training Report
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </GradientButton>
                  </CardContent>
                </Card>

                {/* DAILY COURSE ASSESSMENT CARD - FUNCTIONAL */}
                <Card 
                  className="relative overflow-visible hover:shadow-2xl transition-all duration-300 border-2 hover:border-purple-500 cursor-pointer group"
                  onClick={() => {
                    triggerHaptic('light');
                    navigate("/daily-assessment/new");
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/30 to-transparent opacity-50 rounded-lg" />
                  <CardHeader className="relative z-10 text-center pb-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FileText className="w-8 h-8 text-purple-600" />
                    </div>
                    <CardTitle className="text-2xl mb-2">Daily Course Assessment</CardTitle>
                    <CardDescription className="text-base">
                      Complete daily pre-use safety checks and documentation
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10 text-center pb-6">
                    <GradientButton className="w-full group-hover:scale-105 transition-transform">
                      Start Daily Assessment
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </GradientButton>
                  </CardContent>
                  
                </Card>

                {/* JOB COMPLETION FORM CARD — Lovable preview only.
                    Hidden in production builds while underlying data,
                    routes, and sync logic remain intact. */}
                {isLovablePreview() && (
                <Card
                  className="relative overflow-visible hover:shadow-2xl transition-all duration-300 border-2 hover:border-orange-500 cursor-pointer group"
                  onClick={() => {
                    triggerHaptic('light');
                    navigate("/jcf/new");
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-50/30 to-transparent opacity-50 rounded-lg" />
                  <CardHeader className="relative z-10 text-center pb-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Briefcase className="w-8 h-8 text-orange-600" />
                    </div>
                    <CardTitle className="text-2xl mb-2">Job Completion Form</CardTitle>
                    <CardDescription className="text-base">
                      Document job completion details and sign-off
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10 text-center pb-6">
                    <GradientButton className="w-full group-hover:scale-105 transition-transform">
                      Start JCF
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </GradientButton>
                  </CardContent>
                </Card>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Reports Section */}
        <section className="border-2 border-foreground rounded-lg p-4">
          {/* Brutalist loading bar */}
          {loading && (
            <div className="w-full h-[2px] bg-foreground mb-4 animate-pulse" />
          )}
          <div className="mb-6">
            {/* Section Toggle: Recent / All Reports */}
            <Tabs value={reportSection} onValueChange={(v) => setReportSection(v as "recent" | "all")}>
              <TabsList className="mb-4 h-11">
                <TabsTrigger value="recent" className="text-base font-semibold px-5 py-2">
                  <span className="hidden sm:inline">10 Most Recent Reports</span>
                  <span className="sm:hidden">Recent</span>
                </TabsTrigger>
                <TabsTrigger value="all" className="text-base font-semibold px-5 py-2">
                  <span className="hidden sm:inline">All Reports</span>
                  <span className="sm:hidden">All</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            {(() => {
              const sortByMostRecent = (arr: DbRow[]) => [...arr].sort((a, b) => {
                const dateA = a.updated_at || a.created_at || '';
                const dateB = b.updated_at || b.created_at || '';
                return String(dateB).localeCompare(String(dateA));
              });
              const baseInspections = reportSection === "recent" ? sortByMostRecent(inspections).slice(0, 9) : inspections;
              const baseTrainings = reportSection === "recent" ? sortByMostRecent(trainings).slice(0, 9) : trainings;
              const baseDailyAssessments = reportSection === "recent" ? sortByMostRecent(dailyAssessments).slice(0, 9) : dailyAssessments;
              const baseJcfs = reportSection === "recent" ? sortByMostRecent(jcfs).slice(0, 9) : jcfs;

              const dashboardInspections = activeReportTab === 'invoiced' ? inspections : baseInspections;
              const dashboardTrainings = activeReportTab === 'invoiced' ? trainings : baseTrainings;
              const dashboardDailyAssessments = activeReportTab === 'invoiced' ? dailyAssessments : baseDailyAssessments;
              const dashboardJcfs = activeReportTab === 'invoiced' ? jcfs : baseJcfs;

              const invoicedCount = isSuperAdmin && invoicedReportIds.size > 0
                ? [...inspections, ...trainings, ...dailyAssessments, ...jcfs].filter(r => invoicedReportIds.has(r.id)).length
                : 0;

              return (
                <DashboardReportsSection
                  inspections={dashboardInspections}
                  trainings={dashboardTrainings}
                  dailyAssessments={dashboardDailyAssessments}
                  jcfs={dashboardJcfs}
                  allInspections={inspections}
                  allTrainings={trainings}
                  allDailyAssessments={dailyAssessments}
                  allJcfs={jcfs}
                  totalInspections={inspectionsValidated ? inspections.length : undefined}
                  totalTrainings={trainingsValidated ? trainings.length : undefined}
                  totalDailyAssessments={dailyValidated ? dailyAssessments.length : undefined}
                  totalJcfs={jcfsValidated ? jcfs.length : undefined}
                  inspectionsValidated={inspectionsValidated}
                  trainingsValidated={trainingsValidated}
                  dailyValidated={dailyValidated}
                  jcfsValidated={jcfsValidated}
                  invoicedCount={invoicedCount}
                  activeReportTab={activeReportTab}
                  setActiveReportTab={setActiveReportTab}
                  loading={loading}
                  currentUserId={currentUser?.id || null}
                  uniqueInspectors={uniqueInspectors}
                  isSuperAdmin={!!isSuperAdmin}
                  inspectorFilter={inspectorFilter}
                  setInspectorFilter={setInspectorFilter}
                  navigate={navigate}
                  getStatusBadge={getStatusBadge}
                  setInspectionToDelete={setInspectionToDelete}
                  setReportToDelete={setReportToDelete}
                  setDeleteDialogOpen={setDeleteDialogOpen}
                  invoicedReportIds={invoicedReportIds}
                  invoicedMetaById={invoicedMetaById}
                  onToggleInvoiced={handleToggleInvoiced}
                  profilesById={profilesById}
                />
              );
            })()}
          </div>
          
          {/* TEMPORARY FEATURE: Known Issues - Remove when project complete */}
          <KnownIssuesCard isSuperAdmin={!!isSuperAdmin} />
          <DeveloperNotesCard isSuperAdmin={!!isSuperAdmin} />
          {/* END TEMPORARY FEATURE */}
        </section>
      </main>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {inspectionToDelete 
                ? 'Delete Inspection Report' 
                : reportToDelete && 'assessment_date' in reportToDelete && !('start_date' in reportToDelete)
                  ? 'Delete Daily Assessment'
                  : 'Delete Training Report'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete this report for{" "}
                  <strong>
                    {inspectionToDelete?.organization || reportToDelete?.organization}
                  </strong>? This report will be moved to trash and permanently deleted after 60 days.
                </p>
                {(() => {
                  const targetReport = inspectionToDelete || reportToDelete;
                  const ownerId = targetReport?.inspector_id;
                  const isOtherUsersReport = ownerId && currentUser?.id && ownerId !== currentUser.id;
                  if (!isOtherUsersReport) return null;
                  return (
                    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      <span className="text-sm font-medium">
                        This report belongs to another user. You are deleting it as an admin.
                      </span>
                    </div>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Development Tools */}
      <OfflineSimulator />
      </div>
    </div>
  );
}
