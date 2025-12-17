import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GradientButton } from "@/components/ui/gradient-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogOut, FileText, GraduationCap, ArrowRight, Download, Settings, Trash2, MoreVertical, Bell, AlertCircle, Cloud, User, Loader2, Check, RefreshCw, MessageCircle, Shield } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { toast } from "sonner";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReportCard } from "@/components/dashboard/ReportCard";
import { ReportCardSkeleton } from "@/components/dashboard/ReportCardSkeleton";
/* TEMPORARY FEATURE: Known Issues */
import { KnownIssuesCard } from "@/components/dashboard/KnownIssuesCard";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import acctLogo from "@/assets/acct-accredited-vendor.png";
import dashboardBackgroundVideo from "@/assets/dashboard-background.mp4";
import { triggerHaptic } from "@/lib/haptics";

import { usePWAInstall } from "@/hooks/usePWAInstall";
import { useSyncProgress } from "@/hooks/useSyncProgress";
import { NetworkStatusIndicator } from "@/components/pwa/NetworkStatusIndicator";
import { NetworkQualityIndicator } from "@/components/pwa/NetworkQualityIndicator";
import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";
import { SyncControlPanel } from "@/components/pwa/SyncControlPanel";
import { ManualUpdateButton } from "@/components/pwa/ManualUpdateButton";
import { OfflineSimulator } from "@/components/dev/OfflineSimulator";
import { PushNotificationManager } from "@/components/pwa/PushNotificationManager";
import { ConflictResolver } from "@/components/sync/ConflictResolver";
import { ConflictNotification } from "@/components/sync/ConflictNotification";
import { useConflicts } from "@/hooks/useConflicts";
import { usePWA } from "@/hooks/usePWA";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { getOfflineInspections, deleteOfflineInspection, queueOperation, saveInspectionOffline, getOfflineTrainings, saveTrainingOffline, getOfflineDailyAssessments, saveDailyAssessmentOffline } from "@/lib/offline-storage";
import { ContactDeveloperSheet } from "@/components/ContactDeveloperSheet";
import { InspectionsEmptyState, TrainingsEmptyState, DailyAssessmentsEmptyState } from "@/components/EmptyState";
import { getUserWithCache } from "@/lib/cached-auth";
/* Christmas Theme Components */
import { Snowfall } from "@/components/christmas/Snowfall";
import { HolidayBanner } from "@/components/christmas/HolidayBanner";
import { SnowPile } from "@/components/christmas/SnowPile";
import { Icicles } from "@/components/christmas/Icicles";
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
  const [conflictsDialogOpen, setConflictsDialogOpen] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [inspectorFilter, setInspectorFilter] = useState<string>("all");
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
  const { hasConflicts, conflictCount } = useConflicts();
  const { photosByInspection, triggerSync, isSyncing } = usePWA();
  const { progress } = useSyncProgress();
  
  // Pull to refresh for mobile
  const { isPulling, pullDistance, shouldTriggerRefresh, isActive } = usePullToRefresh({
    onRefresh: async () => {
      triggerHaptic('medium'); // Haptic feedback when refresh triggers
      await triggerSync();
      await loadInspections();
      await loadTrainingReports();
      await loadDailyAssessments();
      
      // Sync all data types using atomic sync
      const { syncAllTrainingsAtomic, syncAllDailyAssessmentsAtomic } = await import('@/lib/atomic-sync-manager');
      await Promise.all([
        syncAllTrainingsAtomic(),
        syncAllDailyAssessmentsAtomic()
      ]);
    },
    isRefreshing: isSyncing,
  });
  
  // Check if user is super admin
  const { data: isSuperAdmin } = useQuery({
    queryKey: ["is-super-admin"],
    queryFn: async () => {
      // Skip check if offline - use cached value
      if (!navigator.onLine) {
        const cached = localStorage.getItem('cached-super-admin-status');
        return cached === 'true';
      }

      const { data: { user } } = await supabase.auth.getUser();
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
      
      // Batch all data loading operations
      await Promise.all([
        loadInspections(),
        loadTrainingReports(),
        loadDailyAssessments()
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

  const loadInspections = async () => {
    try {
      // Get current user for filtering offline data
      const user = await getUserWithCache();
      const userId = user?.id;
      
      // Load from offline storage first (filtered by current user for privacy)
      const offlineInspections = await getOfflineInspections(userId);
      
      if (offlineInspections.length > 0) {
        setInspections(offlineInspections);
        
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loaded from offline storage:', offlineInspections.length);
        }
      }

      // If online, fetch from Supabase and merge
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from("inspections")
          .select(`
            *,
            inspector:profiles(first_name, last_name, avatar_url)
          `)
          .order("last_opened_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });

        if (error) throw error;
        
        if (data) {
          setInspections(data);
          
          // Save to offline storage to cache inspector profiles
          for (const inspection of data) {
            await saveInspectionOffline(inspection);
          }
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded from Supabase:', data.length);
          }
        }
      }
    } catch (error: any) {
      console.error("Error loading inspections:", error);
    }
  };

  const loadTrainingReports = async () => {
    try {
      // Get current user for filtering offline data
      const user = await getUserWithCache();
      const userId = user?.id;
      
      // Load from offline storage first (filtered by current user for privacy)
      const offlineTrainings = await getOfflineTrainings(userId);
      
      if (offlineTrainings.length > 0) {
        setTrainings(offlineTrainings);
        
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loaded trainings from offline storage:', offlineTrainings.length);
        }
      }

      // If online, fetch from Supabase
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from("trainings")
          .select(`
            *,
            trainer:profiles(first_name, last_name, avatar_url)
          `)
          .order("created_at", { ascending: false });

        if (error) throw error;
        
        if (data) {
          setTrainings(data);
          
          // Save to offline storage for offline access
          for (const training of data) {
            await saveTrainingOffline(training);
          }
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded training reports from Supabase:', data.length);
          }
        }
      }
    } catch (error: any) {
      console.error("Error loading training reports:", error);
    }
  };

  const loadDailyAssessments = async () => {
    try {
      // Get current user for filtering offline data
      const user = await getUserWithCache();
      const userId = user?.id;
      
      // Load from offline storage first (filtered by current user for privacy)
      const offlineAssessments = await getOfflineDailyAssessments(userId);
      
      if (offlineAssessments.length > 0) {
        setDailyAssessments(offlineAssessments);
        
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loaded daily assessments from offline storage:', offlineAssessments.length);
        }
      }

      // If online, fetch from Supabase
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from("daily_assessments")
          .select(`
            *,
            inspector:profiles(first_name, last_name, avatar_url)
          `)
          .order("assessment_date", { ascending: false });

        if (error) throw error;
        
        if (data) {
          setDailyAssessments(data);
          
          // Save to offline storage
          for (const assessment of data) {
            await saveDailyAssessmentOffline(assessment);
          }
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded daily assessments from Supabase:', data.length);
          }
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

    try {
      if (isInspection) {
        // Delete from offline storage
        await deleteOfflineInspection(inspectionToDelete.id);

        if (navigator.onLine) {
          // Delete from Supabase
          const { error } = await supabase
            .from("inspections")
            .delete()
            .eq("id", inspectionToDelete.id);

          if (error) throw error;
          
          triggerHaptic('success');
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Inspection deleted:', inspectionToDelete.id);
          }
        } else {
          // Queue for later deletion
          await queueOperation('delete', inspectionToDelete.id, inspectionToDelete);
          triggerHaptic('success');
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Inspection deletion queued:', inspectionToDelete.id);
          }
        }

        // Update UI
        setInspections(inspections.filter(i => i.id !== inspectionToDelete.id));
      } else if (reportToDelete) {
        // Determine if it's a training or daily assessment
        const isTraining = 'start_date' in reportToDelete;
        const isDailyAssessment = 'assessment_date' in reportToDelete && !('start_date' in reportToDelete);

        if (isDailyAssessment) {
          // Delete daily assessment
          const { deleteOfflineDailyAssessment } = await import('@/lib/offline-storage');
          await deleteOfflineDailyAssessment(reportToDelete.id);

          if (navigator.onLine) {
            const { error } = await supabase
              .from("daily_assessments")
              .delete()
              .eq("id", reportToDelete.id);

            if (error) throw error;
            
            triggerHaptic('success');
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Daily assessment deleted:', reportToDelete.id);
            }
          } else {
            triggerHaptic('success');
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Daily assessment deletion (offline):', reportToDelete.id);
            }
          }

          // Update UI
          setDailyAssessments(dailyAssessments.filter(a => a.id !== reportToDelete.id));
        } else if (isTraining) {
          // Delete training report
          if (navigator.onLine) {
            const { error } = await supabase
              .from("trainings")
              .delete()
              .eq("id", reportToDelete.id);

            if (error) throw error;
            
            triggerHaptic('success');
            
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Training deleted:', reportToDelete.id);
            }
          } else {
            triggerHaptic('error');
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
      console.error("Error deleting report:", error);
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
      {/* Christmas Snowfall Animation */}
      <Snowfall />
      
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
              <SyncControlPanel />
            </div>
            
            <div className="flex items-center gap-2">
              <NetworkQualityIndicator />
              <SyncStatusIndicator />
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
                <DropdownMenuItem onClick={() => setNotificationsDialogOpen(true)}>
                  <Bell className="w-4 h-4 mr-2" />
                  Notifications
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
        {/* Conflict Notification */}
        <ConflictNotification onViewConflicts={() => setConflictsDialogOpen(true)} />

        {/* Sync Conflicts Banner */}
        {hasConflicts && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                    Sync Conflict{conflictCount > 1 ? 's' : ''} Detected
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    {conflictCount} inspection{conflictCount > 1 ? 's have' : ' has'} conflicting versions that need resolution.
                  </p>
                </div>
              </div>
              <Button 
                variant="destructive" 
                size="sm"
                onClick={() => setConflictsDialogOpen(true)}
              >
                Resolve Now
              </Button>
            </div>
          </div>
        )}

        {/* Foyer Section */}
        <section className="mb-12">
          <div className="rounded-lg bg-background/40 backdrop-blur-sm">
            <div className="container mx-auto px-2 md:px-4 py-16">
              <div className="text-center mb-8">
                <h2 className="text-4xl font-bold text-primary dark:text-white mb-2">
                  <span className="mr-2">🎄</span>
                  Welcome to Rope Works
                  <span className="ml-2">🎄</span>
                </h2>
                <p className="text-lg text-muted-foreground dark:text-neutral-200">
                  Choose a report type to get started
                </p>
                <p className="text-sm text-green-600 dark:text-green-400 mt-2 font-medium">
                  ❄️ Wishing you a safe and joyful holiday season! ❄️
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
                  <SnowPile />
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-transparent opacity-50 rounded-lg" />
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
                  <Icicles />
                </Card>

                {/* TRAINING CARD - FUNCTIONAL */}
                <Card 
                  className="relative overflow-visible hover:shadow-2xl transition-all duration-300 border-2 hover:border-green-500 cursor-pointer group"
                  onClick={() => {
                    triggerHaptic('light');
                    navigate("/training/new");
                  }}
                >
                  <SnowPile />
                  <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent opacity-50 rounded-lg" />
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
                  <Icicles />
                </Card>

                {/* DAILY COURSE ASSESSMENT CARD - FUNCTIONAL */}
                <Card 
                  className="relative overflow-visible hover:shadow-2xl transition-all duration-300 border-2 hover:border-purple-500 cursor-pointer group"
                  onClick={() => {
                    triggerHaptic('light');
                    navigate("/daily-assessment/new");
                  }}
                >
                  <SnowPile />
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-transparent opacity-50 rounded-lg" />
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
                  <Icicles />
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

      <ConflictResolver 
        open={conflictsDialogOpen} 
        onOpenChange={setConflictsDialogOpen}
      />
      
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
