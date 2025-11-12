import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GradientButton } from "@/components/ui/gradient-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogOut, FileText, GraduationCap, ArrowRight, Lock, Download, Settings, Trash2, MoreVertical, Bell, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import acctLogo from "@/assets/acct-accredited-vendor.png";
import { AuroraBackground } from "@/components/ui/aurora-background";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { NetworkStatusIndicator } from "@/components/pwa/NetworkStatusIndicator";
import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";
import { PushNotificationManager } from "@/components/pwa/PushNotificationManager";
import { ConflictResolver } from "@/components/sync/ConflictResolver";
import { ConflictNotification } from "@/components/sync/ConflictNotification";
import { useConflicts } from "@/hooks/useConflicts";
import { getOfflineInspections, deleteOfflineInspection, queueOperation } from "@/lib/offline-storage";
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<any>(null);
  const [notificationsDialogOpen, setNotificationsDialogOpen] = useState(false);
  const [conflictsDialogOpen, setConflictsDialogOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
  const { hasConflicts, conflictCount } = useConflicts();

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
    loadInspections();

    // Listen for online/offline events
    const handleOnline = () => {
      setIsOnline(true);
      loadInspections(); // Reload when coming back online
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadInspections = async () => {
    try {
      // Load from offline storage first
      const offlineInspections = await getOfflineInspections();
      
      if (offlineInspections.length > 0) {
        setInspections(offlineInspections);
        setLoading(false);
        
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loaded from offline storage:', offlineInspections.length);
        }
      }

      // If online, fetch from Supabase and merge
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from("inspections")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;
        
        if (data) {
          setInspections(data);
          
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded from Supabase:', data.length);
          }
        }
      }
    } catch (error: any) {
      console.error("Error loading inspections:", error);
      toast.error("Failed to load inspections");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
  };

  const handleDeleteClick = (e: React.MouseEvent, inspection: any) => {
    e.stopPropagation();
    setInspectionToDelete(inspection);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!inspectionToDelete) return;

    try {
      // Delete from offline storage
      await deleteOfflineInspection(inspectionToDelete.id);

      if (navigator.onLine) {
        // Delete from Supabase
        const { error } = await supabase
          .from("inspections")
          .delete()
          .eq("id", inspectionToDelete.id);

        if (error) throw error;
        
        toast.success("Inspection deleted successfully");
        
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Inspection deleted:', inspectionToDelete.id);
        }
      } else {
        // Queue for later deletion
        await queueOperation('delete', inspectionToDelete.id, inspectionToDelete);
        toast.success("Inspection deleted offline - will sync when online");
        
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Inspection deletion queued:', inspectionToDelete.id);
        }
      }

      // Update UI
      setInspections(inspections.filter(i => i.id !== inspectionToDelete.id));
      setDeleteDialogOpen(false);
      setInspectionToDelete(null);
    } catch (error: any) {
      console.error("Error deleting inspection:", error);
      toast.error("Failed to delete inspection");
    }
  };

  const getStatusBadge = (inspection: any) => {
    const isUnsynced = !inspection.synced_at || 
      (inspection.updated_at && new Date(inspection.updated_at) > new Date(inspection.synced_at));
    
    if (isUnsynced) {
      return <Badge variant="default">Unsynced</Badge>;
    }
    
    const variants: Record<string, { variant: any; label: string }> = {
      draft: { variant: "secondary", label: "Draft" },
      completed: { variant: "outline", label: "Completed" },
    };
    const config = variants[inspection.status] || variants.draft;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-2 md:px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <img src={ropeWorksLogo} alt="Rope Works" className="h-8 md:h-12 w-auto object-contain" />
            <img src={acctLogo} alt="ACCT Accredited Vendor" className="h-8 md:h-12 w-auto object-contain" />
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <NetworkStatusIndicator />
            <SyncStatusIndicator />
            {isInstallable && !isInstalled && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  if (import.meta.env.DEV) {
                    console.log('[Dashboard] Install App button clicked');
                  }
                  promptInstall();
                }}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                <span className="hidden md:inline">Install App</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <Settings className="w-4 h-4" />
                  <span className="hidden md:inline">Settings</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>App Settings</DropdownMenuLabel>
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
                <DropdownMenuItem onClick={() => setNotificationsDialogOpen(true)}>
                  <Bell className="w-4 h-4 mr-2" />
                  Notifications
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/capabilities')}>
                  Device Capabilities
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/install')}>
                  Install Instructions
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-2 md:px-4 py-8">
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

        {/* Offline Status Banner */}
        {!isOnline && (
          <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 text-center">
              📱 <strong>You're offline.</strong> You can still view and create inspections. Changes will sync when you're back online.
            </p>
          </div>
        )}

        {/* Foyer Section */}
        <section className="mb-12 -mx-4">
          <AuroraBackground className="rounded-lg" showRadialGradient={true}>
            <div className="container mx-auto px-4 py-16">
              <div className="text-center mb-8">
                <h2 className="text-4xl font-bold text-primary dark:text-white mb-2">
                  Welcome to Rope Works
                </h2>
                <p className="text-lg text-muted-foreground dark:text-neutral-200">
                  Choose a report type to get started
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                {/* INSPECTION CARD - FUNCTIONAL */}
                <Card 
                  className="relative overflow-hidden hover:shadow-2xl transition-all duration-300 border-2 hover:border-blue-500 cursor-pointer group"
                  onClick={() => navigate("/inspection/new")}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-transparent opacity-50" />
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

                {/* TRAINING CARD - MOCKUP (DISABLED) */}
                <Card className="relative overflow-hidden border-2 opacity-60 cursor-not-allowed">
                  <Badge 
                    variant="secondary" 
                    className="absolute top-4 right-4 z-20 bg-yellow-100 text-yellow-800 border-yellow-300"
                  >
                    Coming Soon
                  </Badge>
                  <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent opacity-30" />
                  <CardHeader className="relative z-10 text-center pb-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                      <GraduationCap className="w-8 h-8 text-green-600" />
                    </div>
                    <CardTitle className="text-2xl mb-2 text-muted-foreground">
                      Training Report
                    </CardTitle>
                    <CardDescription className="text-base">
                      Document training sessions and participant assessments
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10 text-center pb-6">
                    <Button size="lg" className="w-full" disabled>
                      <Lock className="w-4 h-4 mr-2" />
                      Coming Soon
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </AuroraBackground>
        </section>

        {/* Recent Reports Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold">Recent Reports</h3>
              <p className="text-muted-foreground mt-1">
                View and manage your inspection reports
              </p>
            </div>
            <GradientButton onClick={() => navigate("/inspection/new")}>
              <Plus className="w-5 h-5 mr-2" />
              New Inspection
            </GradientButton>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Loading inspections...</p>
            </div>
          ) : inspections.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No inspections yet</p>
                <GradientButton onClick={() => navigate("/inspection/new")} className="mt-4">
                  Create your first inspection
                </GradientButton>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {inspections.map((inspection) => (
                <Card
                  key={inspection.id}
                  className="cursor-pointer hover:shadow-lg transition-shadow group"
                  onClick={() => navigate(`/inspection/${inspection.id}`)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg truncate">{inspection.organization}</CardTitle>
                        <CardDescription className="truncate">{inspection.location}</CardDescription>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {getStatusBadge(inspection)}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              className="text-red-600 focus:text-red-600"
                              onClick={(e) => handleDeleteClick(e, inspection)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>
                        <span className="font-medium">Date:</span>{" "}
                        {new Date(inspection.inspection_date).toLocaleDateString()}
                      </p>
                      <p>
                        <span className="font-medium">Created:</span>{" "}
                        {new Date(inspection.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Inspection Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the inspection report for{" "}
              <strong>{inspectionToDelete?.organization}</strong>? This action cannot be undone.
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
    </div>
  );
}
