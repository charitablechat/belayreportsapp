import { useEffect, useState, useMemo } from "react";
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
import { UserAvatar } from "@/components/ui/user-avatar";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReportCard } from "@/components/dashboard/ReportCard";
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
import { OfflineSimulator } from "@/components/dev/OfflineSimulator";
import { StatusIndicator } from "@/components/pwa/StatusIndicator";
import { SyncPulse } from "@/components/pwa/SyncPulse";
import { useConflicts } from "@/hooks/useConflicts";
import { usePWA } from "@/hooks/usePWA";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { getOfflineInspections, deleteOfflineInspection, queueOperation, saveInspectionOffline, getOfflineTrainings, saveTrainingOffline, deleteOfflineTraining, getOfflineDailyAssessments, saveDailyAssessmentOffline, deleteOfflineDailyAssessment, getOfflineInspection, getOfflineTraining, getOfflineDailyAssessment, clearRelatedDataOffline, clearTrainingDataOffline, clearAssessmentDataOffline } from "@/lib/offline-storage";
import { shouldPreserveLocalRecord } from "@/lib/local-data-guards";
import { ContactDeveloperSheet } from "@/components/ContactDeveloperSheet";
import { onSyncComplete, isSyncInProgress, consumePendingDashboardRefresh } from "@/lib/sync-events";
import { InspectionsEmptyState, TrainingsEmptyState, DailyAssessmentsEmptyState } from "@/components/EmptyState";
import { getUserWithCache, getSuperAdminStatusWithCache, invalidateSuperAdminCache, ensureValidSession, getOfflineUserId } from "@/lib/cached-auth";
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

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [inspections, setInspections] = useState<any[]>([]);
  const [trainings, setTrainings] = useState<any[]>([]);
  const [dailyAssessments, setDailyAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<any>(null);
  const [reportToDelete, setReportToDelete] = useState<any>(null);
  const [activeReportTab, setActiveReportTab] = useState("inspections");
  const [reportSection, setReportSection] = useState<"recent" | "all">("recent");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [inspectorFilter, setInspectorFilter] = useState<string>("all");
  
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
      triggerHaptic('medium'); // Haptic feedback when refresh triggers
      // Only reload data - sync happens automatically in background
      await loadInspections();
      await loadTrainingReports();
      await loadDailyAssessments();
    },
    isRefreshing: isSyncing,
  });
  
  const queryClient = useQueryClient();
  
  // Check if user is super admin - uses cached auth with robust fallback
  const { data: isSuperAdmin, isLoading: isSuperAdminLoading } = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      // Always check localStorage cache first for immediate UI feedback
      const cachedValue = localStorage.getItem('cached-super-admin-status');
      
      // Skip network check if offline - use cached value
      if (!navigator.onLine) {
        return cachedValue === 'true';
      }

      // Use cached auth instead of direct supabase.auth.getUser()
      const user = await getUserWithCache();
      if (!user) {
        localStorage.setItem('cached-super-admin-status', 'false');
        return false;
      }

      try {
        const { data: roles, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "super_admin");

        if (error) {
          console.warn('[Dashboard] Error checking super admin status:', error);
          // On error, return cached value if available
          return cachedValue === 'true';
        }

        const isAdmin = roles && roles.length > 0;
        
        // Cache the result for offline use and immediate UI on next load
        localStorage.setItem('cached-super-admin-status', isAdmin.toString());
        
        return isAdmin;
      } catch (err) {
        console.warn('[Dashboard] Exception checking super admin status:', err);
        return cachedValue === 'true';
      }
    },
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes (reduced for faster refresh)
    retry: 2, // Retry twice on failure
    retryDelay: 1000, // 1 second between retries
    // Initialize with cached value to prevent flash of missing badge
    placeholderData: () => {
      const cached = localStorage.getItem('cached-super-admin-status');
      return cached === 'true';
    },
  });

  useEffect(() => {
    const loadAllData = async () => {
      setLoading(true);
      
      // NON-BLOCKING: Start session refresh in background
      // Data loading uses getUserWithCache() which reads from localStorage instantly
      ensureValidSession().catch(e => {
        console.warn('[Dashboard] Background session refresh failed:', e);
      });
      
      // PERFORMANCE: Fetch user once, then pass to all loaders
      const user = await getUserWithCache();
      // Fallback: if getUserWithCache returns null (e.g. stale cache), extract userId from localStorage
      const userId = user?.id || getOfflineUserId();
      
      // Get super admin status once using cached function (for offline storage bypass)
      // This uses single-flight pattern to dedupe concurrent requests
      let superAdminStatus = false;
      if (user) {
        superAdminStatus = await getSuperAdminStatusWithCache();
      }
      
      // Safety timeout to prevent skeleton loading state from getting stuck
      // If data loads from offline storage, we want to show it immediately
      const LOAD_TIMEOUT = 8000;
      let loadCompleted = false;
      
      const safetyTimeout = setTimeout(() => {
        if (!loadCompleted) {
          console.warn('[Dashboard] Loading safety timeout - forcing loading state to false');
          setLoading(false);
        }
      }, LOAD_TIMEOUT);
      
      try {
        // Batch all data loading operations with shared userId and superAdminStatus
        // Each function sets state independently, so data appears as it loads
        await Promise.all([
          loadInspections(userId, superAdminStatus),
          loadTrainingReports(userId, superAdminStatus),
          loadDailyAssessments(userId, superAdminStatus)
        ]);
      } finally {
        loadCompleted = true;
        clearTimeout(safetyTimeout);
        setLoading(false);
      }
    };
    
    // Consume the flag synchronously before any async work
    const hasPendingRefresh = consumePendingDashboardRefresh();

    // Track whether data was loaded (refs avoid stale closure issues)
    const dataLoadedRef = { inspections: false, trainings: false, assessments: false };

    loadAllData().then(() => {
      // Check current state via DOM-independent tracking
      // Schedule retry if initial load came back empty while online
      // (session may have been stale; ensureValidSession runs in background)
      if (hasPendingRefresh || (navigator.onLine && !dataLoadedRef.inspections && !dataLoadedRef.trainings && !dataLoadedRef.assessments)) {
        setTimeout(async () => {
          const user = await getUserWithCache();
          const userId = user?.id || getOfflineUserId();
          const superAdminStatus = user ? await getSuperAdminStatusWithCache() : false;
          await Promise.all([
            loadInspections(userId, superAdminStatus),
            loadTrainingReports(userId, superAdminStatus),
            loadDailyAssessments(userId, superAdminStatus),
          ]);
        }, hasPendingRefresh ? 300 : 1500);
      }
    });
    
    // Fetch current user - works offline with cache!
    const fetchUser = async () => {
      const user = await getUserWithCache();
      setCurrentUser(user);
      
      // Fetch user profile if online
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
    
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Only update currentUser from real auth events, not synthetic session failures
        if (session?.user) {
          setCurrentUser(session.user);
        }
        
        // Only redirect on explicit sign-out while online
        // Offline synthetic sessions may trigger false SIGNED_OUT events
        if (event === 'SIGNED_OUT' && navigator.onLine) {
          navigate("/", { replace: true });
        }
      }
    );

    // Listen for online/offline events
    const handleOnline = async () => {
      setIsOnline(true);
      // Invalidate super admin status to refresh from server
      invalidateSuperAdminCache();
      queryClient.invalidateQueries({ queryKey: ["is-super-admin"] });
      // Pre-fetch auth once, then pass to all loaders in parallel
      const user = await getUserWithCache();
      const userId = user?.id;
      const superAdminStatus = await getSuperAdminStatusWithCache();
      await Promise.all([
        loadInspections(userId, superAdminStatus),
        loadTrainingReports(userId, superAdminStatus),
        loadDailyAssessments(userId, superAdminStatus),
      ]);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Subscribe to sync completion events from useAutoSync
    // This ensures Dashboard refreshes when background sync completes
    const unsubscribeSyncComplete = onSyncComplete(async () => {
      if (import.meta.env.DEV) {
        console.log('[Dashboard] Sync complete event received - reloading data');
      }
      // Invalidate super admin status on sync (in case user roles were updated)
      invalidateSuperAdminCache();
      queryClient.invalidateQueries({ queryKey: ["is-super-admin"] });
      // Pre-fetch auth once, then pass to all loaders in parallel
      const user = await getUserWithCache();
      const userId = user?.id;
      const superAdminStatus = await getSuperAdminStatusWithCache();
      await Promise.all([
        loadInspections(userId, superAdminStatus),
        loadTrainingReports(userId, superAdminStatus),
        loadDailyAssessments(userId, superAdminStatus),
      ]);
    });

    // Reload data when tab regains focus (e.g., after switching apps on mobile)
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        const user = await getUserWithCache();
        const userId = user?.id || getOfflineUserId();
        const superAdminStatus = user ? await getSuperAdminStatusWithCache() : false;
        await Promise.all([
          loadInspections(userId, superAdminStatus),
          loadTrainingReports(userId, superAdminStatus),
          loadDailyAssessments(userId, superAdminStatus),
        ]);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      subscription.unsubscribe();
      unsubscribeSyncComplete();
    };
  }, [location.key]);

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

  const loadInspections = async (cachedUserId?: string, cachedIsSuperAdmin?: boolean) => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // Get super admin status if not passed (for backward compatibility)
      const isSuperAdmin = cachedIsSuperAdmin ?? await getSuperAdminStatusWithCache();
      
      // PARALLEL LOADING: Start both IndexedDB and Supabase fetches simultaneously
      // This ensures mobile users see data quickly even if IndexedDB times out
      const offlinePromise = getOfflineInspections(userId, isSuperAdmin).catch(() => []);
      
      let supabasePromise: Promise<any[] | null> = Promise.resolve([]);
      if (navigator.onLine) {
        // Wrap in Promise.resolve to get a proper Promise with .catch()
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          Promise.resolve(
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
              .limit(10000)
          ).then(({ data, error }) => {
            if (error) throw error;
            return data || [];
          }).catch(err => {
            console.error('[Dashboard] Supabase fetch error:', err);
            return null;
          }),
          15000,
          null
        );
      }

      // SHORT TIMEOUT for IndexedDB (2 seconds) - prefer network data on mobile
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2000))
      ]);
      
      // Show offline data immediately if available
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0 && !navigator.onLine) {
        setInspections(offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Offline - loaded from cache:', offlineData.length);
        }
      }

      // Always try to get fresh data from network (runs in parallel)
      if (navigator.onLine) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          setInspections(networkData);
          
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
            return saveInspectionOffline({ ...inspection, synced_at: inspection.synced_at || now });
          }))
            .then(async () => {
              // ORPHAN CLEANUP with threshold guard + rate limiting (Vector 4)
              try {
                // Rate limit: only run orphan cleanup once per hour
                const ORPHAN_CLEANUP_COOLDOWN = 3600000; // 1 hour
                const lastCleanupKey = 'lastOrphanCleanup_inspections';
                const lastCleanup = parseInt(localStorage.getItem(lastCleanupKey) || '0');
                if (Date.now() - lastCleanup < ORPHAN_CLEANUP_COOLDOWN) {
                  if (import.meta.env.DEV) console.log('[Dashboard] Inspection orphan cleanup on cooldown -- skipping');
                } else {
                const serverIds = new Set(networkData.map((i: any) => i.id));
                const localInspections = await getOfflineInspections(userId);
                const nonTempLocals = localInspections.filter(l => !l.id.startsWith('temp-'));
                
                // SAFETY: If server returned far fewer records than local, skip cleanup
                // Increased threshold from 3 to 5 for additional safety
                if (networkData.length < nonTempLocals.length * 0.5 && nonTempLocals.length > 5) {
                  console.warn('[Dashboard] Server returned far fewer inspections than local -- skipping orphan cleanup', {
                    server: networkData.length,
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
              }
            })
            .catch(err => console.error('[Dashboard] Error batch saving inspections:', err));
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded from Supabase:', networkData.length);
          }
        } else if (networkData !== null && offlineData.length === 0) {
          // Only clear when server CONFIRMED zero records (not timeout/error)
          setInspections([]);
        } else if (networkData === null && offlineData.length > 0) {
          // Network failed -- fall back to offline data
          setInspections(offlineData);
        }
      }
    } catch (error: any) {
      console.error("Error loading inspections:", error);
    }
  };

  const loadTrainingReports = async (cachedUserId?: string, cachedIsSuperAdmin?: boolean) => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // Get super admin status if not passed (for backward compatibility)
      const isSuperAdmin = cachedIsSuperAdmin ?? await getSuperAdminStatusWithCache();
      
      // PARALLEL LOADING: Start both fetches simultaneously
      const offlinePromise = getOfflineTrainings(userId, isSuperAdmin).catch(() => []);
      
      let supabasePromise: Promise<any[] | null> = Promise.resolve([]);
      if (navigator.onLine) {
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          Promise.resolve(
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
              .limit(10000)
          ).then(({ data, error }) => {
            if (error) throw error;
            return data || [];
          }).catch(err => {
            console.error('[Dashboard] Supabase trainings fetch error:', err);
            return null;
          }),
          15000,
          null
        );
      }

      // SHORT TIMEOUT for IndexedDB (2 seconds)
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2000))
      ]);
      
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0 && !navigator.onLine) {
        setTrainings(offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Offline - loaded trainings from cache:', offlineData.length);
        }
      }

      // Always try to get fresh data from network
      if (navigator.onLine) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          setTrainings(networkData);
          
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
            return saveTrainingOffline({ ...training, synced_at: training.synced_at || nowT });
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
                const serverIds = new Set(networkData.map((t: any) => t.id));
                const localTrainings = await getOfflineTrainings(userId);
                const nonTempLocals = localTrainings.filter(l => !l.id.startsWith('temp-'));
                
                if (networkData.length < nonTempLocals.length * 0.5 && nonTempLocals.length > 5) {
                  console.warn('[Dashboard] Server returned far fewer trainings than local -- skipping orphan cleanup', {
                    server: networkData.length,
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
        } else if (networkData !== null && offlineData.length === 0) {
          // Only clear when server CONFIRMED zero records (not timeout/error)
          setTrainings([]);
        } else if (networkData === null && offlineData.length > 0) {
          // Network failed -- fall back to offline data
          setTrainings(offlineData);
        }
      }
    } catch (error: any) {
      console.error("Error loading training reports:", error);
    }
  };

  const loadDailyAssessments = async (cachedUserId?: string, cachedIsSuperAdmin?: boolean) => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // Get super admin status if not passed (for backward compatibility)
      const isSuperAdmin = cachedIsSuperAdmin ?? await getSuperAdminStatusWithCache();
      
      // PARALLEL LOADING: Start both fetches simultaneously
      const offlinePromise = getOfflineDailyAssessments(userId, isSuperAdmin).catch(() => []);
      
      let supabasePromise: Promise<any[] | null> = Promise.resolve([]);
      if (navigator.onLine) {
        // Add 6-second timeout to prevent hanging
        supabasePromise = withNetworkTimeout(
          Promise.resolve(
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
              .limit(10000)
          ).then(({ data, error }) => {
            if (error) throw error;
            return data || [];
          }).catch(err => {
            console.error('[Dashboard] Supabase assessments fetch error:', err);
            return null;
          }),
          15000,
          null
        );
      }

      // SHORT TIMEOUT for IndexedDB (2 seconds)
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2000))
      ]);
      
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0 && !navigator.onLine) {
        setDailyAssessments(offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loaded daily assessments from offline storage:', offlineData.length);
        }
      }

      // Always try to get fresh data from network
      if (navigator.onLine) {
        const networkData = await supabasePromise;
        if (networkData && networkData.length > 0) {
          setDailyAssessments(networkData);
          
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
            return saveDailyAssessmentOffline({ ...assessment, synced_at: assessment.synced_at || nowA });
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
                const serverIds = new Set(networkData.map((a: any) => a.id));
                const localAssessments = await getOfflineDailyAssessments(userId);
                const nonTempLocals = localAssessments.filter(l => !l.id.startsWith('temp-'));
                
                if (networkData.length < nonTempLocals.length * 0.5 && nonTempLocals.length > 5) {
                  console.warn('[Dashboard] Server returned far fewer assessments than local -- skipping orphan cleanup', {
                    server: networkData.length,
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
        } else if (networkData !== null && offlineData.length === 0) {
          // Only clear when server CONFIRMED zero records (not timeout/error)
          setDailyAssessments([]);
        } else if (networkData === null && offlineData.length > 0) {
          // Network failed -- fall back to offline data
          setDailyAssessments(offlineData);
        }
      }
    } catch (error: any) {
      console.error("Error loading daily assessments:", error);
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
          // Soft delete from Supabase (UPDATE instead of DELETE)
          const { error } = await supabase
            .from("inspections")
            .update(softDeleteData)
            .eq("id", inspectionToDelete.id);

          if (error) throw error;
          
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
        setInspections(inspections.filter(i => i.id !== inspectionToDelete.id));
      } else if (reportToDelete) {
        // Determine if it's a training or daily assessment
        const isTraining = 'start_date' in reportToDelete;
        const isDailyAssessment = 'assessment_date' in reportToDelete && !('start_date' in reportToDelete);

        if (isDailyAssessment) {
          // Soft delete daily assessment
          const { deleteOfflineDailyAssessment } = await import('@/lib/offline-storage');
          await deleteOfflineDailyAssessment(reportToDelete.id);

          if (navigator.onLine) {
            const { error } = await supabase
              .from("daily_assessments")
              .update(softDeleteData)
              .eq("id", reportToDelete.id);

            if (error) throw error;
            
            triggerHaptic('success');
            toast.success("Daily assessment moved to trash. It will be permanently deleted in 60 days.");
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Daily assessment soft-deleted:', reportToDelete.id);
            }
          } else {
            triggerHaptic('success');
            toast.success("Assessment will be deleted when you're back online.");
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Daily assessment soft-deletion queued:', reportToDelete.id);
            }
          }

          // Update UI
          setDailyAssessments(dailyAssessments.filter(a => a.id !== reportToDelete.id));
        } else if (isTraining) {
          // Soft delete training report
          if (navigator.onLine) {
            const { error } = await supabase
              .from("trainings")
              .update(softDeleteData)
              .eq("id", reportToDelete.id);

            if (error) throw error;
            
            triggerHaptic('success');
            toast.success("Training moved to trash. It will be permanently deleted in 60 days.");
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Training soft-deleted:', reportToDelete.id);
            }
          } else {
            triggerHaptic('error');
            toast.error("Cannot delete training while offline.");
            return;
          }

          // Update UI
          setTrainings(trainings.filter(t => t.id !== reportToDelete.id));
        }
      }

      setDeleteDialogOpen(false);
      setInspectionToDelete(null);
      setReportToDelete(null);
    } catch (error: any) {
      console.error("Error soft-deleting report:", error);
      toast.error("Failed to delete report");
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
              
              {/* Pending uploads chip - visible when items are queued */}
              {unsyncedCount > 0 && !isSyncing && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-mono text-xs gap-1">
                  <Cloud className="w-3 h-3" />
                  {unsyncedCount} pending
                </Badge>
              )}
              
              <NetworkQualityIndicator />
              
              {/* Visible Force Sync button for quick access */}
              <ForceSyncButton variant="icon" className="h-8 w-8" />
              
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
                  Recent Reports
                </TabsTrigger>
                <TabsTrigger value="all" className="text-base font-semibold px-5 py-2">
                  All Reports
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            {(() => {
              const filteredInspections = inspectorFilter !== "all" ? inspections.filter(i => i.inspector_id === inspectorFilter) : inspections;
              const filteredTrainings = inspectorFilter !== "all" ? trainings.filter(t => t.inspector_id === inspectorFilter) : trainings;
              const filteredDailyAssessments = inspectorFilter !== "all" ? dailyAssessments.filter(d => d.inspector_id === inspectorFilter) : dailyAssessments;
              const displayInspections = reportSection === "recent" ? filteredInspections.slice(0, 9) : filteredInspections;
              const displayTrainings = reportSection === "recent" ? filteredTrainings.slice(0, 9) : filteredTrainings;
              const displayDailyAssessments = reportSection === "recent" ? filteredDailyAssessments.slice(0, 9) : filteredDailyAssessments;
              
              return (
            <Tabs value={activeReportTab} onValueChange={setActiveReportTab}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <TabsList className="w-full sm:w-auto">
                  <TabsTrigger value="inspections" className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Inspections ({displayInspections.length})
                  </TabsTrigger>
                  <TabsTrigger value="training" className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4" />
                    Training ({displayTrainings.length})
                  </TabsTrigger>
                  <TabsTrigger value="daily" className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Daily ({displayDailyAssessments.length})
                  </TabsTrigger>
                </TabsList>
                
                {isSuperAdmin && (
                  <Select value={inspectorFilter} onValueChange={setInspectorFilter}>
                    <SelectTrigger className="w-full sm:w-[220px] bg-card border-border">
                      <SelectValue placeholder="Filter by inspector" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="all">All Inspectors</SelectItem>
                      {uniqueInspectors.map(({ id, name }) => (
                        <SelectItem key={id} value={id}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <TabsContent value="inspections">
                {loading ? (
                  <div className="grid gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <ReportCardSkeleton key={i} />
                    ))}
                  </div>
                ) : displayInspections.length === 0 ? (
                  <Card>
                    <CardContent className="p-0">
                      <InspectionsEmptyState 
                        onAction={() => {
                          triggerHaptic('light');
                          navigate("/inspection/new");
                        }}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {displayInspections
                      .sort((a, b) => {
                        const getInspectorName = (inspection: any) => {
                          const inspector = (inspection as any).inspector;
                          if (inspector?.first_name && inspector?.last_name) {
                            return `${inspector.first_name} ${inspector.last_name}`;
                          }
                          return 'Unknown';
                        };

                        // Age-priority tier: critical=0, warning=1, rest=2
                        const tierOf = (r: any) => {
                          if (r.status === 'completed') return 2;
                          const age = differenceInDays(new Date(), new Date(r.created_at));
                          if (age > 5) return 0;
                          if (age > 3) return 1;
                          return 2;
                        };
                        const tierDiff = tierOf(a) - tierOf(b);
                        if (tierDiff !== 0) return tierDiff;

                        return 0;
                      })
                      .map((inspection) => (
                        <ReportCard
                          key={inspection.id}
                          report={inspection}
                          type="inspection"
                          onDelete={(report) => {
                            setInspectionToDelete(report);
                            setDeleteDialogOpen(true);
                          }}
                          onClick={(report) => navigate(`/inspection/${report.id}`)}
                          getStatusBadge={getStatusBadge}
                        />
                      ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="training">
                {loading ? (
                  <div className="grid gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <ReportCardSkeleton key={i} />
                    ))}
                  </div>
                ) : displayTrainings.length === 0 ? (
                  <Card>
                    <CardContent className="p-0">
                      <TrainingsEmptyState 
                        onAction={() => {
                          triggerHaptic('light');
                          navigate("/training/new");
                        }}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {displayTrainings
                      .sort((a, b) => {
                        const getTrainerName = (training: any) => {
                          const trainer = training.trainer;
                          if (trainer?.first_name && trainer?.last_name) {
                            return `${trainer.first_name} ${trainer.last_name}`;
                          }
                          return 'Unknown';
                        };

                        const tierOf = (r: any) => {
                          if (r.status === 'completed') return 2;
                          const age = differenceInDays(new Date(), new Date(r.created_at));
                          if (age > 5) return 0;
                          if (age > 3) return 1;
                          return 2;
                        };
                        const tierDiff = tierOf(a) - tierOf(b);
                        if (tierDiff !== 0) return tierDiff;

                        return 0;
                      })
                      .map((training) => (
                        <ReportCard
                          key={training.id}
                          report={training}
                          type="training"
                          onDelete={(report) => {
                            setReportToDelete(report);
                            setDeleteDialogOpen(true);
                          }}
                          onClick={(report) => navigate(`/training/${report.id}`)}
                        />
                      ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="daily">
                {loading ? (
                  <div className="grid gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <ReportCardSkeleton key={i} />
                    ))}
                  </div>
                ) : displayDailyAssessments.length === 0 ? (
                  <Card>
                    <CardContent className="p-0">
                      <DailyAssessmentsEmptyState 
                        onAction={() => {
                          triggerHaptic('light');
                          navigate("/daily-assessment/new");
                        }}
                      />
                    </CardContent>
                  </Card>
) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {displayDailyAssessments
                      .sort((a, b) => {
                        const getInspectorName = (assessment: any) => {
                          const inspector = assessment.inspector;
                          if (inspector?.first_name && inspector?.last_name) {
                            return `${inspector.first_name} ${inspector.last_name}`;
                          }
                          return 'Unknown';
                        };

                        const tierOf = (r: any) => {
                          if (r.status === 'completed') return 2;
                          const age = differenceInDays(new Date(), new Date(r.created_at));
                          if (age > 5) return 0;
                          if (age > 3) return 1;
                          return 2;
                        };
                        const tierDiff = tierOf(a) - tierOf(b);
                        if (tierDiff !== 0) return tierDiff;

                        return 0;
                      })
                      .map((assessment) => (
                        <ReportCard
                          key={assessment.id}
                          report={assessment}
                          type="daily"
                          onClick={() => navigate(`/daily-assessment/${assessment.id}`)}
                          onDelete={(report) => {
                            setReportToDelete(report);
                            setDeleteDialogOpen(true);
                          }}
                        />
                      ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
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
            <AlertDialogDescription>
              Are you sure you want to delete this report for{" "}
              <strong>
                {inspectionToDelete?.organization || reportToDelete?.organization}
              </strong>? This action cannot be undone.
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
