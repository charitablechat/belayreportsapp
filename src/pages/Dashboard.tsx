import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GradientButton } from "@/components/ui/gradient-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogOut, FileText, GraduationCap, ArrowRight, Download, Settings, Trash2, MoreVertical, Bell, Cloud, User, Loader2, Check, RefreshCw, MessageCircle, Shield, CloudOff } from "lucide-react";
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
import dashboardBackground from "@/assets/dashboard-background.webp";
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
import { getOfflineInspections, deleteOfflineInspection, queueOperation, saveInspectionOffline, getOfflineTrainings, saveTrainingOffline, deleteOfflineTraining, getOfflineDailyAssessments, saveDailyAssessmentOffline, deleteOfflineDailyAssessment } from "@/lib/offline-storage";
import { ContactDeveloperSheet } from "@/components/ContactDeveloperSheet";
import { onSyncComplete } from "@/lib/sync-events";
import { InspectionsEmptyState, TrainingsEmptyState, DailyAssessmentsEmptyState } from "@/components/EmptyState";
import { getUserWithCache, getSuperAdminStatusWithCache, invalidateSuperAdminCache, ensureValidSession, getOfflineUserId } from "@/lib/cached-auth";
/* Holiday Theme Components */
import { HolidayBanner } from "@/components/christmas/HolidayBanner";
import { OlympicRings } from "@/components/christmas/OlympicRings";
import { UserProfileDropdown } from "@/components/UserProfileDropdown";


import { triggerValentineConfetti } from "@/lib/confetti";
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
  const [inspections, setInspections] = useState<any[]>([]);
  const [trainings, setTrainings] = useState<any[]>([]);
  const [dailyAssessments, setDailyAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<any>(null);
  const [reportToDelete, setReportToDelete] = useState<any>(null);
  const [activeReportTab, setActiveReportTab] = useState("inspections");
  const [reportSection, setReportSection] = useState<"recent" | "all">("recent");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [inspectorFilter, setInspectorFilter] = useState<string>("all");
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
      
      // CRITICAL: Refresh auth session before any RLS-restricted queries
      // This fixes the "session validation timed out" loop where stale JWTs
      // cause all Supabase queries to return empty results
      try {
        await Promise.race([
          ensureValidSession(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Session refresh timeout')), 5000))
        ]);
      } catch (e) {
        console.warn('[Dashboard] Session refresh failed, will try cached auth:', e);
      }
      
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
    
    loadAllData();
    
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

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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
          Promise.all(networkData.map(inspection => saveInspectionOffline({ ...inspection, synced_at: inspection.synced_at || now })))
            .then(async () => {
              // ORPHAN CLEANUP with threshold guard: protect against incomplete server responses
              try {
                const serverIds = new Set(networkData.map((i: any) => i.id));
                const localInspections = await getOfflineInspections(userId);
                const nonTempLocals = localInspections.filter(l => !l.id.startsWith('temp-'));
                
                // SAFETY: If server returned far fewer records than local, skip cleanup
                // This prevents data loss from partial responses, query limits, or RLS changes
                if (networkData.length < nonTempLocals.length * 0.5 && nonTempLocals.length > 3) {
                  console.warn('[Dashboard] Server returned far fewer inspections than local -- skipping orphan cleanup', {
                    server: networkData.length,
                    local: nonTempLocals.length,
                  });
                } else {
                  for (const local of localInspections) {
                    if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
                      if (import.meta.env.DEV) console.log('[Dashboard] Removing orphaned local inspection:', local.id);
                      await deleteOfflineInspection(local.id);
                    }
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
          Promise.all(networkData.map(training => saveTrainingOffline({ ...training, synced_at: training.synced_at || nowT })))
            .then(async () => {
              // ORPHAN CLEANUP with threshold guard
              try {
                const serverIds = new Set(networkData.map((t: any) => t.id));
                const localTrainings = await getOfflineTrainings(userId);
                const nonTempLocals = localTrainings.filter(l => !l.id.startsWith('temp-'));
                
                if (networkData.length < nonTempLocals.length * 0.5 && nonTempLocals.length > 3) {
                  console.warn('[Dashboard] Server returned far fewer trainings than local -- skipping orphan cleanup', {
                    server: networkData.length,
                    local: nonTempLocals.length,
                  });
                } else {
                  for (const local of localTrainings) {
                    if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
                      if (import.meta.env.DEV) console.log('[Dashboard] Removing orphaned local training:', local.id);
                      await deleteOfflineTraining(local.id);
                    }
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
          Promise.all(networkData.map(assessment => saveDailyAssessmentOffline({ ...assessment, synced_at: assessment.synced_at || nowA })))
            .then(async () => {
              // ORPHAN CLEANUP with threshold guard
              try {
                const serverIds = new Set(networkData.map((a: any) => a.id));
                const localAssessments = await getOfflineDailyAssessments(userId);
                const nonTempLocals = localAssessments.filter(l => !l.id.startsWith('temp-'));
                
                if (networkData.length < nonTempLocals.length * 0.5 && nonTempLocals.length > 3) {
                  console.warn('[Dashboard] Server returned far fewer assessments than local -- skipping orphan cleanup', {
                    server: networkData.length,
                    local: nonTempLocals.length,
                  });
                } else {
                  for (const local of localAssessments) {
                    if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
                      if (import.meta.env.DEV) console.log('[Dashboard] Removing orphaned local assessment:', local.id);
                      await deleteOfflineDailyAssessment(local.id);
                    }
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

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error signing out:", error);
      setSigningOut(false);
    }
  };

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
        
        {/* Synced badge */}
        {!isCurrentlySyncing && inspection.synced_at && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1 cursor-help text-xs px-2 py-0">
                <Check className="w-3 h-3" />
                <span className="hidden sm:inline">Synced</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                Last synced: {format(new Date(inspection.synced_at), "PPp")}
              </p>
            </TooltipContent>
          </Tooltip>
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
          src={dashboardBackground}
          alt=""
          className="w-full h-full object-cover object-center"
        />
        
        {/* Gradient fade: ensures text/cards remain readable over full-page background */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/50 via-background/60 to-background/80" />
        
        {/* Reduced motion fallback */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/80 via-sky-900/70 to-blue-900/80 hidden motion-reduce:block" />
      </div>
      <div className="relative z-10 min-h-screen">
        {/* Holiday Banner */}
        <HolidayBanner />
        
        <header className="border-b bg-card/95 backdrop-blur-sm">
        <div className="container mx-auto px-1 md:px-4 py-3 md:py-4">
          {/* Top row - Logos, status indicators, and user dropdown */}
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-2 md:gap-3">
              <img src={ropeWorksLogo} alt="Rope Works" className="h-8 md:h-12 w-auto object-contain" />
              <img src={acctLogo} alt="ACCT Accredited Vendor" className="h-8 md:h-12 w-auto object-contain" />
            </div>
            
            <div className="flex items-center gap-2">
              {/* Minimal dot-based sync indicator */}
              <SyncPulse />
              
              <NetworkQualityIndicator />
              
              {/* Visible Force Sync button for quick access */}
              <ForceSyncButton variant="icon" className="h-8 w-8" />
              
              {isSuperAdmin && (
                <Badge variant="default" className="bg-warning text-warning-foreground border-warning/50 shadow-lg shadow-warning/20 animate-pulse hidden sm:flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Super Admin
                </Badge>
              )}
            </div>
            
            <UserProfileDropdown
              currentUser={currentUser}
              userProfile={userProfile}
              isSuperAdmin={isSuperAdmin}
              onSignOut={handleSignOut}
              signingOut={signingOut}
            />
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
                  <OlympicRings />
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
                  <OlympicRings />
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
                  <OlympicRings />
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
        <section>
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
              const displayInspections = reportSection === "recent" ? inspections.slice(0, 9) : inspections;
              const displayTrainings = reportSection === "recent" ? trainings.slice(0, 9) : trainings;
              const displayDailyAssessments = reportSection === "recent" ? dailyAssessments.slice(0, 9) : dailyAssessments;
              
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
                      <SelectItem value="a-z">Name: A to Z</SelectItem>
                      <SelectItem value="z-a">Name: Z to A</SelectItem>
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

                        if (inspectorFilter === 'a-z') {
                          return getInspectorName(a).localeCompare(getInspectorName(b));
                        } else if (inspectorFilter === 'z-a') {
                          return getInspectorName(b).localeCompare(getInspectorName(a));
                        }
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

                        if (inspectorFilter === 'a-z') {
                          return getTrainerName(a).localeCompare(getTrainerName(b));
                        } else if (inspectorFilter === 'z-a') {
                          return getTrainerName(b).localeCompare(getTrainerName(a));
                        }
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

                        if (inspectorFilter === 'a-z') {
                          return getInspectorName(a).localeCompare(getInspectorName(b));
                        } else if (inspectorFilter === 'z-a') {
                          return getInspectorName(b).localeCompare(getInspectorName(a));
                        }
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
