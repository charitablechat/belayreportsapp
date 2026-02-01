import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GradientButton } from "@/components/ui/gradient-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogOut, FileText, GraduationCap, ArrowRight, Download, Settings, Trash2, MoreVertical, Bell, Cloud, User, Loader2, Check, RefreshCw, MessageCircle, Shield } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { toast } from "sonner";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReportCard } from "@/components/dashboard/ReportCard";
import { ReportCardSkeleton } from "@/components/dashboard/ReportCardSkeleton";
/* TEMPORARY FEATURE: Known Issues */
import { KnownIssuesCard } from "@/components/dashboard/KnownIssuesCard";
import { DeveloperNotesCard } from "@/components/dashboard/DeveloperNotesCard";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import acctLogo from "@/assets/acct-accredited-vendor.png";
import dashboardBackgroundVideo from "@/assets/dashboard-background.mp4";
import { triggerHaptic } from "@/lib/haptics";

import { usePWAInstall } from "@/hooks/usePWAInstall";
import { useSyncProgress } from "@/hooks/useSyncProgress";
import { NetworkStatusIndicator } from "@/components/pwa/NetworkStatusIndicator";
import { NetworkQualityIndicator } from "@/components/pwa/NetworkQualityIndicator";

import { ManualUpdateButton } from "@/components/pwa/ManualUpdateButton";
import { ForceSyncButton } from "@/components/pwa/ForceSyncButton";
import { OfflineSimulator } from "@/components/dev/OfflineSimulator";
import { PushNotificationManager } from "@/components/pwa/PushNotificationManager";
import { NotificationCenter } from "@/components/pwa/NotificationCenter";
import { StatusIndicator } from "@/components/pwa/StatusIndicator";
import { useNotificationCenter } from "@/hooks/useNotificationCenter";
import { useConflicts } from "@/hooks/useConflicts";
import { usePWA } from "@/hooks/usePWA";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { getOfflineInspections, deleteOfflineInspection, queueOperation, saveInspectionOffline, getOfflineTrainings, saveTrainingOffline, getOfflineDailyAssessments, saveDailyAssessmentOffline } from "@/lib/offline-storage";
import { ContactDeveloperSheet } from "@/components/ContactDeveloperSheet";
import { InspectionsEmptyState, TrainingsEmptyState, DailyAssessmentsEmptyState } from "@/components/EmptyState";
import { getUserWithCache } from "@/lib/cached-auth";
/* Holiday Theme Components */
import { FallingHearts } from "@/components/christmas/FallingHearts";
import { HolidayBanner } from "@/components/christmas/HolidayBanner";
import { HeartsBorder } from "@/components/christmas/HeartsBorder";


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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [notificationsDialogOpen, setNotificationsDialogOpen] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [inspectorFilter, setInspectorFilter] = useState<string>("all");
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
  // Silent auto-resolution of conflicts via last-write-wins
  useConflicts();
  const { photosByInspection, isSyncing } = usePWA();
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
  
  // Check if user is super admin - uses cached auth to avoid duplicate network calls
  const { data: isSuperAdmin } = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      // Skip check if offline - use cached value
      if (!navigator.onLine) {
        const cached = localStorage.getItem('cached-super-admin-status');
        return cached === 'true';
      }

      // Use cached auth instead of direct supabase.auth.getUser()
      const user = await getUserWithCache();
      if (!user) return false;

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "super_admin");

      const isAdmin = roles && roles.length > 0;
      
      // Cache the result for offline use
      localStorage.setItem('cached-super-admin-status', isAdmin.toString());
      
      return isAdmin;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: false, // Don't retry if offline
  });

  useEffect(() => {
    const loadAllData = async () => {
      setLoading(true);
      
      // PERFORMANCE: Fetch user once, then pass to all loaders
      const user = await getUserWithCache();
      const userId = user?.id;
      
      // Batch all data loading operations with shared userId
      await Promise.all([
        loadInspections(userId),
        loadTrainingReports(userId),
        loadDailyAssessments(userId)
      ]);
      
      setLoading(false);
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
        setCurrentUser(session?.user ?? null);
        
        // Redirect to login page when user signs out
        if (event === 'SIGNED_OUT' || !session) {
          navigate("/", { replace: true });
        }
      }
    );

    // Listen for online/offline events
    const handleOnline = () => {
      setIsOnline(true);
      loadInspections(); // Reload when coming back online
      loadTrainingReports();
      loadDailyAssessments();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      subscription.unsubscribe();
    };
  }, []);

  const loadInspections = async (cachedUserId?: string) => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // PARALLEL LOADING: Start both IndexedDB and Supabase fetches simultaneously
      // This ensures mobile users see data quickly even if IndexedDB times out
      const offlinePromise = getOfflineInspections(userId).catch(() => []);
      
      let supabasePromise: Promise<any[]> = Promise.resolve([]);
      if (navigator.onLine) {
        // Wrap in Promise.resolve to get a proper Promise with .catch()
        supabasePromise = Promise.resolve(
          supabase
            .from("inspections")
            .select(`
              *,
              inspector:profiles(first_name, last_name, avatar_url)
            `)
            .order("last_opened_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
        ).then(({ data, error }) => {
          if (error) throw error;
          return data || [];
        }).catch(err => {
          console.error('[Dashboard] Supabase fetch error:', err);
          return [];
        });
      }

      // SHORT TIMEOUT for IndexedDB (2 seconds) - prefer network data on mobile
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2000))
      ]);
      
      // Show offline data immediately if available
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0) {
        setInspections(offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loaded from offline storage:', offlineData.length);
        }
      }

      // Always try to get fresh data from network (runs in parallel)
      if (navigator.onLine) {
        const networkData = await supabasePromise;
        if (networkData.length > 0) {
          setInspections(networkData);
          
          // Background save to offline storage (fire-and-forget)
          Promise.all(networkData.map(inspection => saveInspectionOffline(inspection)))
            .catch(err => console.error('[Dashboard] Error batch saving inspections:', err));
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded from Supabase:', networkData.length);
          }
        } else if (offlineData.length === 0) {
          // Neither offline nor network has data - set empty explicitly
          setInspections([]);
        }
      }
    } catch (error: any) {
      console.error("Error loading inspections:", error);
    }
  };

  const loadTrainingReports = async (cachedUserId?: string) => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // PARALLEL LOADING: Start both fetches simultaneously
      const offlinePromise = getOfflineTrainings(userId).catch(() => []);
      
      let supabasePromise: Promise<any[]> = Promise.resolve([]);
      if (navigator.onLine) {
        supabasePromise = Promise.resolve(
          supabase
            .from("trainings")
            .select(`
              *,
              trainer:profiles(first_name, last_name, avatar_url)
            `)
            .order("created_at", { ascending: false })
        ).then(({ data, error }) => {
          if (error) throw error;
          return data || [];
        }).catch(err => {
          console.error('[Dashboard] Supabase trainings fetch error:', err);
          return [];
        });
      }

      // SHORT TIMEOUT for IndexedDB (2 seconds)
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2000))
      ]);
      
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0) {
        setTrainings(offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loaded trainings from offline storage:', offlineData.length);
        }
      }

      // Always try to get fresh data from network
      if (navigator.onLine) {
        const networkData = await supabasePromise;
        if (networkData.length > 0) {
          setTrainings(networkData);
          
          Promise.all(networkData.map(training => saveTrainingOffline(training)))
            .catch(err => console.error('[Dashboard] Error batch saving trainings:', err));
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded training reports from Supabase:', networkData.length);
          }
        } else if (offlineData.length === 0) {
          setTrainings([]);
        }
      }
    } catch (error: any) {
      console.error("Error loading training reports:", error);
    }
  };

  const loadDailyAssessments = async (cachedUserId?: string) => {
    try {
      // Use passed userId or fetch from cache
      const userId = cachedUserId || (await getUserWithCache())?.id;
      
      // PARALLEL LOADING: Start both fetches simultaneously
      const offlinePromise = getOfflineDailyAssessments(userId).catch(() => []);
      
      let supabasePromise: Promise<any[]> = Promise.resolve([]);
      if (navigator.onLine) {
        supabasePromise = Promise.resolve(
          supabase
            .from("daily_assessments")
            .select(`
              *,
              inspector:profiles(first_name, last_name, avatar_url)
            `)
            .order("assessment_date", { ascending: false })
        ).then(({ data, error }) => {
          if (error) throw error;
          return data || [];
        }).catch(err => {
          console.error('[Dashboard] Supabase assessments fetch error:', err);
          return [];
        });
      }

      // SHORT TIMEOUT for IndexedDB (2 seconds)
      const offlineWithTimeout = Promise.race([
        offlinePromise,
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2000))
      ]);
      
      const offlineData = await offlineWithTimeout;
      if (offlineData.length > 0) {
        setDailyAssessments(offlineData);
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loaded daily assessments from offline storage:', offlineData.length);
        }
      }

      // Always try to get fresh data from network
      if (navigator.onLine) {
        const networkData = await supabasePromise;
        if (networkData.length > 0) {
          setDailyAssessments(networkData);
          
          Promise.all(networkData.map(assessment => saveDailyAssessmentOffline(assessment)))
            .catch(err => console.error('[Dashboard] Error batch saving assessments:', err));
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded daily assessments from Supabase:', networkData.length);
          }
        } else if (offlineData.length === 0) {
          setDailyAssessments([]);
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
      <div className="flex gap-1 items-center flex-nowrap">
        {/* Show syncing indicator when actively syncing this inspection */}
        {isCurrentlySyncing && (
          <Badge variant="default" className="gap-1 bg-primary text-primary-foreground animate-pulse text-xs px-2 py-0">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span className="hidden sm:inline">Syncing</span>
          </Badge>
        )}
        
        {/* Show sync status badge only when synced */}
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
        
        {/* Show unsynced photos count if any */}
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
      {/* Valentine's Falling Hearts Animation */}
      <FallingHearts />
      
      
      
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
      
      {/* Background - Christmas gradient on mobile, video on desktop */}
      <div className="absolute inset-0 z-0">
        {/* Christmas gradient for mobile */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/30 via-green-900/20 to-red-900/30 md:hidden" />
        
        {/* Video background - desktop only, respects reduced motion */}
        <video 
          autoPlay 
          loop 
          muted 
          playsInline
          className="hidden md:block w-full h-full object-cover motion-reduce:hidden"
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            video.playbackRate = 0.7;
          }}
        >
          <source src={dashboardBackgroundVideo} type="video/mp4" />
        </video>
        
        {/* Gradient fallback when motion is reduced */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-900/30 via-green-900/20 to-red-900/30 hidden motion-reduce:block" />
      </div>
      <div className="relative z-10 min-h-screen bg-background/80 backdrop-blur-sm">
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
              {/* Subtle status indicator for mobile - shows sync/save status */}
              <StatusIndicator className="md:hidden" />
              
              <NetworkQualityIndicator />
              
              {isSuperAdmin && (
                <Badge variant="default" className="bg-warning text-warning-foreground border-warning/50 shadow-lg shadow-warning/20 animate-pulse hidden sm:flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Super Admin
                </Badge>
              )}
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
              <UserAvatar 
                userEmail={currentUser?.email ?? null}
                avatarUrl={userProfile?.avatar_url ?? null}
                isSuperAdmin={isSuperAdmin}
              />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Account</p>
                      {isSuperAdmin && (
                        <Badge variant="default" className="bg-warning text-warning-foreground border-warning/50 shadow-md shadow-warning/20 animate-pulse text-xs flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          Admin
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {currentUser?.email || 'user@example.com'}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isSuperAdmin && (
                  <>
                    <DropdownMenuItem onClick={() => navigate('/admin')}>
                      <Settings className="w-4 h-4 mr-2" />
                      Admin Dashboard
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                <NotificationCenter 
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Bell className="w-4 h-4 mr-2" />
                      Activity Log
                    </DropdownMenuItem>
                  }
                />
                <DropdownMenuItem onClick={() => setNotificationsDialogOpen(true)}>
                  <Bell className="w-4 h-4 mr-2" />
                  Push Notifications
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/capabilities')}>
                  Device Capabilities
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/install')}>
                  <FileText className="w-4 h-4 mr-2" />
                  Install Instructions
                </DropdownMenuItem>
                
                {isInstallable && !isInstalled && (
                  <DropdownMenuItem onClick={promptInstall}>
                    <Download className="w-4 h-4 mr-2" />
                    Install App
                  </DropdownMenuItem>
                )}
                
                <DropdownMenuItem asChild>
                  <div className="w-full px-2 py-1.5">
                    <ManualUpdateButton />
                  </div>
                </DropdownMenuItem>
                
                <DropdownMenuItem asChild>
                  <ForceSyncButton variant="menu-item" />
                </DropdownMenuItem>
                
                <DropdownMenuItem onClick={() => setContactSheetOpen(true)}>
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Contact Developer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} disabled={signingOut}>
                  {signingOut ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4 mr-2" />
                  )}
                  {signingOut ? "Signing out..." : "Sign Out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-1 md:px-4 py-8">
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
                  <HeartsBorder />
                  <div className="absolute inset-0 bg-gradient-to-br from-pink-50 to-transparent opacity-50 rounded-lg" />
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
                  <HeartsBorder />
                  <div className="absolute inset-0 bg-gradient-to-br from-rose-50 to-transparent opacity-50 rounded-lg" />
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
                  <HeartsBorder />
                  <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-transparent opacity-50 rounded-lg" />
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

        {/* Recent Reports Section */}
        <section>
          <div className="mb-6">
            <h3 className="text-2xl font-bold mb-4">Recent Reports</h3>
            
            <Tabs value={activeReportTab} onValueChange={setActiveReportTab}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <TabsList className="w-full sm:w-auto">
                  <TabsTrigger value="inspections" className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Inspections ({inspections.length})
                  </TabsTrigger>
                  <TabsTrigger value="training" className="flex items-center gap-2">
                    <GraduationCap className="w-4 h-4" />
                    Training ({trainings.length})
                  </TabsTrigger>
                  <TabsTrigger value="daily" className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Daily ({dailyAssessments.length})
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
                ) : inspections.length === 0 ? (
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
                    {inspections
                      .sort((a, b) => {
                        const getInspectorName = (inspection: any) => {
                          const inspector = (inspection as any).inspector;
                          if (inspector?.first_name && inspector?.last_name) {
                            return `${inspector.first_name} ${inspector.last_name}`;
                          }
                          return 'Unknown';
                        };

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
                ) : trainings.length === 0 ? (
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
                    {trainings
                      .sort((a, b) => {
                        const getTrainerName = (training: any) => {
                          const trainer = training.trainer;
                          if (trainer?.first_name && trainer?.last_name) {
                            return `${trainer.first_name} ${trainer.last_name}`;
                          }
                          return 'Unknown';
                        };

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
                ) : dailyAssessments.length === 0 ? (
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
                    {dailyAssessments
                      .sort((a, b) => {
                        const getInspectorName = (assessment: any) => {
                          const inspector = assessment.inspector;
                          if (inspector?.first_name && inspector?.last_name) {
                            return `${inspector.first_name} ${inspector.last_name}`;
                          }
                          return 'Unknown';
                        };

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

      <Dialog open={notificationsDialogOpen} onOpenChange={setNotificationsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Notification Settings</DialogTitle>
            <DialogDescription>
              Manage your push notification preferences for inspections and sync updates
            </DialogDescription>
          </DialogHeader>
          <PushNotificationManager />
        </DialogContent>
      </Dialog>

      
      <ContactDeveloperSheet 
        open={contactSheetOpen} 
        onOpenChange={setContactSheetOpen}
      />
      
      {/* Development Tools */}
      <OfflineSimulator />
      </div>
    </div>
  );
}
