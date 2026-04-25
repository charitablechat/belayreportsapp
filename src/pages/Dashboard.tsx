import React, { useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GradientButton } from "@/components/ui/gradient-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogOut, FileText, GraduationCap, ArrowRight, Download, Settings, Trash2, MoreVertical, Bell, Cloud, User, Loader2, Check, RefreshCw, MessageCircle, Shield, CloudOff, ChevronDown, ChevronRight, Filter, X } from "lucide-react";
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
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReportCard } from "@/components/dashboard/ReportCard";
import { useProfileMap } from "@/hooks/useProfileMap";
import { ReportCardSkeleton } from "@/components/dashboard/ReportCardSkeleton";
/* TEMPORARY FEATURE: Known Issues */
import { KnownIssuesCard } from "@/components/dashboard/KnownIssuesCard";
import { DeveloperNotesCard } from "@/components/dashboard/DeveloperNotesCard";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
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
import { getOfflineInspections, deleteOfflineInspection, queueOperation, queueTrainingOperation, queueAssessmentOperation, saveInspectionOffline, getOfflineTrainings, saveTrainingOffline, deleteOfflineTraining, getOfflineDailyAssessments, saveDailyAssessmentOffline, deleteOfflineDailyAssessment, getOfflineInspection, getOfflineTraining, getOfflineDailyAssessment, clearRelatedDataOffline, clearTrainingDataOffline, clearAssessmentDataOffline } from "@/lib/offline-storage";
import { shouldPreserveLocalRecord } from "@/lib/local-data-guards";
import { reconcileServerDeletions } from "@/lib/reconcile-server-deletions";
import { ContactDeveloperSheet } from "@/components/ContactDeveloperSheet";
import { onSyncComplete, isSyncInProgress, consumePendingDashboardRefresh, consumeDashboardStaleTimestamp } from "@/lib/sync-events";
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

function readDashboardCache(key: string): any[] {
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

function writeDashboardCache(key: string, data: any[]) {
  try {
    const payload = JSON.stringify({ data, ts: Date.now() });
    sessionStorage.setItem(key, payload);
    // Also persist to localStorage as long-lived fallback
    localStorage.setItem(LS_CACHE_PREFIX + key, payload);
  } catch {}
}

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [inspections, setInspections] = useState<any[]>(() => readDashboardCache('dashboard-cache-inspections'));
  const [trainings, setTrainings] = useState<any[]>(() => readDashboardCache('dashboard-cache-trainings'));
  const [dailyAssessments, setDailyAssessments] = useState<any[]>(() => readDashboardCache('dashboard-cache-daily'));
  const [loading, setLoading] = useState(true);
  // Track whether we've received at least one definitive result per category
  // Per-dataset validation: tracks whether each dataset has received a definitive result
  const [inspectionsValidated, setInspectionsValidated] = useState(false);
  const [trainingsValidated, setTrainingsValidated] = useState(false);
  const [dailyValidated, setDailyValidated] = useState(false);
  const dataValidated = inspectionsValidated && trainingsValidated && dailyValidated;

  // Build a unified inspector_id → profile map so cards can resolve names
  // even when locally-saved IDB rows lost the `inspector` / `trainer` join.
  const profilesById = useProfileMap(
    useMemo(
      () => [...inspections, ...trainings, ...dailyAssessments],
      [inspections, trainings, dailyAssessments],
    ),
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<any>(null);
  const [reportToDelete, setReportToDelete] = useState<any>(null);
  const [activeReportTab, setActiveReportTab] = useState("inspections");
  const [reportSection, setReportSection] = useState<"recent" | "all">("recent");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [inspectorFilter, setInspectorFilter] = useState<string>("all");

  // Deduplication & throttle refs for refreshReports
  const refreshInFlightRef = React.useRef(false);
  const pendingRefreshRef = React.useRef(false);
  const lastRefreshTsRef = React.useRef(0);
  const REFRESH_THROTTLE_MS = 3000;
  const [showStaleDataBanner, setShowStaleDataBanner] = useState(false);
  const networkFailCountRef = React.useRef(0);

  
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

  // Fetch invoiced report IDs (admin only) — single source of truth via React Query
  const invoicedQuery = useQuery({
    queryKey: ["invoiced-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoiced_reports")
        .select("report_id");
      if (error) {
        console.warn('[Dashboard] Error fetching invoiced reports:', error);
        return new Set<string>();
      }
      return new Set((data || []).map((r: any) => r.report_id));
    },
    enabled: !!isSuperAdmin,
    staleTime: 30_000,
  });

  const invoicedReportIds = invoicedQuery.data ?? new Set<string>();

  const handleToggleInvoiced = React.useCallback(async (report: any, type: 'inspection' | 'training' | 'daily') => {
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
      queryClient.setQueryData<Set<string>>(["invoiced-reports"], (old) => {
        const next = new Set(old);
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
      queryClient.setQueryData<Set<string>>(["invoiced-reports"], (old) => {
        return new Set(old).add(report.id);
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
      ]);

      // Fix 1: Always flip per-dataset validation true once the load function
      // returns. Previously this only happened on `definitive: true`, which
      // left the StatsBar pulsing forever when network timed out AND IDB was
      // empty. We'd rather show real numbers from cache (or a real 0) than
      // skeletons indefinitely.
      setInspectionsValidated(true);
      setTrainingsValidated(true);
      setDailyValidated(true);
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
    } finally {
      refreshInFlightRef.current = false;
      // If a refresh was queued while we were busy, trigger it now
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        refreshReports(true);
      }
    }
  }, []);

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
        const { data: profile } = await (supabase as any)
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
      refreshReports(true);
    };
    const handleOffline = () => setIsOnline(false);

    // Sync completion
    const unsubscribeSyncComplete = onSyncComplete(() => {
      if (import.meta.env.DEV) console.log('[Dashboard] Sync complete - refreshing');
      invalidateSuperAdminCache();
      queryClient.invalidateQueries({ queryKey: ["is-super-admin"] });
      refreshReports(true);
    });

    // Visibility change (tab switch, app resume)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshReports(true);
    };

    // Window focus (SPA back-navigation)
    const handleWindowFocus = () => refreshReports(true);

    // iPad/Safari bfcache restore
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        if (import.meta.env.DEV) console.log('[Dashboard] bfcache restore - refreshing');
        refreshReports(true);
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
    const handleDashboardStale = () => refreshReports(true);
    window.addEventListener('dashboard-stale', handleDashboardStale);

    // F1: Realtime subscription — merge remote UPDATE/INSERT/DELETE events directly into
    // local list state so the "Edited X ago" pill (and any other server-derived field)
    // refreshes within ~1s on every connected device, not just on tab refocus.
    const mergeRow = (prev: any[], row: any) => {
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
    const removeRow = (prev: any[], id: string) => prev.filter((r) => r.id !== id);

    const dashboardChannel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inspections' }, (payload: any) => {
        // Fix 5: any incoming row guarantees we have data — un-skeletonize.
        setInspectionsValidated(true);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trainings' }, (payload: any) => {
        setTrainingsValidated(true);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_assessments' }, (payload: any) => {
        setDailyValidated(true);
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
      // Fix 4: realtime health check. If the channel errors or times out we
      // log it and trigger a one-shot refetch so the dashboard counts don't
      // silently drift from server reality.
      .subscribe((status) => {
        if (import.meta.env.DEV) console.log('[Dashboard] realtime status:', status);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[Dashboard] realtime channel degraded:', status, '— scheduling fallback refetch');
          setTimeout(() => refreshReports(true), 1500);
        }
      });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('dashboard-stale', handleDashboardStale);
      supabase.removeChannel(dashboardChannel);
      subscription.unsubscribe();
      unsubscribeSyncComplete();
    };
  }, []);

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
    buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
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
      
      let supabasePromise: Promise<any[] | null> = Promise.resolve([]);
      if (navigator.onLine && sessionValid) {
        // Wrap in Promise.resolve to get a proper Promise with .catch()
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          // M13: Paginate so super-admins with >500 reports get the full set;
          // truncated results were silently caching as the offline source-of-truth.
          fetchAllPaginated<any>(
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
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 4000))
      ]);
      
      // Show offline/cached data immediately (stale-while-revalidate)
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0) {
        setInspections(offlineData);
        writeDashboardCache('dashboard-cache-inspections', offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Stale-while-revalidate inspections from cache:', offlineData.length);
        }
      }

      // Always try to get fresh data from network (runs in parallel)
      if (navigator.onLine && sessionValid) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          setInspections(networkData);
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
            if (shouldPreserveLocalRecord(localRecord)) {
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
            return saveInspectionOffline({ ...inspection, updated_at: preservedUpdatedAt, synced_at: preservedSyncedAt });
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
                  const idQuery = supabase.from('inspections').select('id').is('deleted_at', null);
                  if (!isSuperAdmin) idQuery.eq('inspector_id', userId);
                  const { data: idRows, error: idErr } = await idQuery;
                  if (idErr) throw idErr;
                  serverIds = new Set((idRows || []).map((r: any) => r.id));
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
                (window as any).requestIdleCallback(() => runOrphanCleanup());
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
          setInspections([]);
          writeDashboardCache('dashboard-cache-inspections', []);
          return { networkSuccess: true, definitive: true };
        } else if (networkData === null && offlineData.length > 0) {
          // Network failed -- fall back to offline data (definitive from offline)
          setInspections(offlineData);
          return { networkSuccess: false, definitive: true };
        }
        // networkData === null and no offline data — not definitive
        return { networkSuccess: false, definitive: offlineData.length > 0 };
      }
      // Offline-only: definitive if we got offline data or cache had data
      return { networkSuccess: false, definitive: true };
    } catch (error: any) {
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
      
      let supabasePromise: Promise<any[] | null> = Promise.resolve([]);
      if (navigator.onLine && sessionValid) {
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          // M13: Paginate to capture full result set for super-admin views.
          fetchAllPaginated<any>(
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
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 4000))
      ]);
      
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0) {
        setTrainings(offlineData);
        writeDashboardCache('dashboard-cache-trainings', offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Stale-while-revalidate trainings from cache:', offlineData.length);
        }
      }

      // Always try to get fresh data from network
      if (navigator.onLine && sessionValid) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          setTrainings(networkData);
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
            if (shouldPreserveLocalRecord(localRecord)) {
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
            return saveTrainingOffline({ ...training, updated_at: preservedUpdatedAtT, synced_at: preservedSyncedAtT });
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
                  serverIds = new Set((idRows || []).map((r: any) => r.id));
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
          setTrainings([]);
          writeDashboardCache('dashboard-cache-trainings', []);
          return { networkSuccess: true, definitive: true };
        } else if (networkData === null && offlineData.length > 0) {
          setTrainings(offlineData);
          return { networkSuccess: false, definitive: true };
        }
        return { networkSuccess: false, definitive: offlineData.length > 0 };
      }
      return { networkSuccess: false, definitive: true };
    } catch (error: any) {
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
      
      let supabasePromise: Promise<any[] | null> = Promise.resolve([]);
      if (navigator.onLine && sessionValid) {
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          // M13: Paginate to capture full result set for super-admin views.
          fetchAllPaginated<any>(
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
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 4000))
      ]);
      
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0) {
        setDailyAssessments(offlineData);
        writeDashboardCache('dashboard-cache-daily', offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Stale-while-revalidate assessments from cache:', offlineData.length);
        }
      }

      // Always try to get fresh data from network
      if (navigator.onLine && sessionValid) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          setDailyAssessments(networkData);
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
            if (shouldPreserveLocalRecord(localRecord)) {
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
            return saveDailyAssessmentOffline({ ...assessment, updated_at: preservedUpdatedAtA, synced_at: preservedSyncedAtA });
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
                  serverIds = new Set((idRows || []).map((r: any) => r.id));
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
          setDailyAssessments([]);
          writeDashboardCache('dashboard-cache-daily', []);
          return { networkSuccess: true, definitive: true };
        } else if (networkData === null && offlineData.length > 0) {
          setDailyAssessments(offlineData);
          return { networkSuccess: false, definitive: true };
        }
        return { networkSuccess: false, definitive: offlineData.length > 0 };
      }
      return { networkSuccess: false, definitive: true };
    } catch (error: any) {
      console.error("Error loading daily assessments:", error);
      return { networkSuccess: false, definitive: false };
    }
  };

  // Sign-out is now handled globally by AuthenticatedHeader

  const handleDeleteClick = (e: React.MouseEvent, inspection: any) => {
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
        const isDailyAssessment = 'assessment_date' in reportToDelete && !('start_date' in reportToDelete);

        if (isDailyAssessment) {
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
    } catch (error: any) {
      const itemId = itemToDelete?.id || 'unknown';
      const step = isInspection ? 'inspection' : ('start_date' in (reportToDelete || {}) ? 'training' : 'daily_assessment');
      console.error(`[Dashboard] Soft-delete failed:`, { step, id: itemId, error: error?.message, code: error?.code });
      
      const detail = error?.message?.includes('row-level security')
        ? 'Permission denied. Please sign in again and retry.'
        : (error?.message || 'Unknown error');
      toast.error(`Failed to delete report: ${detail}`);
      triggerHaptic('error');
    }
  };

  const getStatusBadge = (inspection: any) => {
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
              <img src={ropeWorksLogo} alt="Rope Works" className="h-8 md:h-12 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/dashboard')} />
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
                  <span className="block md:inline">Rope Works</span>
                </h2>
                <p className="text-lg text-muted-foreground dark:text-neutral-200">
                  Choose a report type to get started
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
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
                  <span className="hidden sm:inline">9 Most Recent Reports</span>
                  <span className="sm:hidden">Recent</span>
                </TabsTrigger>
                <TabsTrigger value="all" className="text-base font-semibold px-5 py-2">
                  <span className="hidden sm:inline">All Reports</span>
                  <span className="sm:hidden">All</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            {(() => {
              const sortByMostRecent = (arr: any[]) => [...arr].sort((a, b) => {
                const dateA = a.updated_at || a.created_at || '';
                const dateB = b.updated_at || b.created_at || '';
                return dateB.localeCompare(dateA);
              });
              const baseInspections = reportSection === "recent" ? sortByMostRecent(inspections).slice(0, 9) : inspections;
              const baseTrainings = reportSection === "recent" ? sortByMostRecent(trainings).slice(0, 9) : trainings;
              const baseDailyAssessments = reportSection === "recent" ? sortByMostRecent(dailyAssessments).slice(0, 9) : dailyAssessments;

              const dashboardInspections = activeReportTab === 'invoiced' ? inspections : baseInspections;
              const dashboardTrainings = activeReportTab === 'invoiced' ? trainings : baseTrainings;
              const dashboardDailyAssessments = activeReportTab === 'invoiced' ? dailyAssessments : baseDailyAssessments;

              const invoicedCount = isSuperAdmin && invoicedReportIds.size > 0
                ? [...inspections, ...trainings, ...dailyAssessments].filter(r => invoicedReportIds.has(r.id)).length
                : 0;

              return (
                <DashboardReportsSection
                  inspections={dashboardInspections}
                  trainings={dashboardTrainings}
                  dailyAssessments={dashboardDailyAssessments}
                  allInspections={inspections}
                  allTrainings={trainings}
                  allDailyAssessments={dailyAssessments}
                  totalInspections={inspectionsValidated ? inspections.length : undefined}
                  totalTrainings={trainingsValidated ? trainings.length : undefined}
                  totalDailyAssessments={dailyValidated ? dailyAssessments.length : undefined}
                  inspectionsValidated={inspectionsValidated}
                  trainingsValidated={trainingsValidated}
                  dailyValidated={dailyValidated}
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
                  onToggleInvoiced={handleToggleInvoiced}
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
