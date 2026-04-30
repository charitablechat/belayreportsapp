import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { StatCard, StatCardHoverContent } from "@/components/admin/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building2, Users, FileText, Bell, UserPlus, Pencil, Trash2, ClipboardList, ArrowLeft, Merge, Clock, Calendar, Shield, ShieldOff, GraduationCap, ClipboardCheck, Check, Settings, RotateCcw, UserCog, AlertTriangle, UserX, UserCheck } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { useState, useEffect, useMemo } from "react";
import { useProfileMap } from "@/hooks/useProfileMap";
import { resolveProfileName, type ProfileLike } from "@/lib/report-utils";
import { AdminTabsSection } from "@/components/admin/AdminTabsSection";
import { UserManagementDialog } from "@/components/admin/UserManagementDialog";

import { MergeOrganizationsDialog } from "@/components/admin/MergeOrganizationsDialog";
import { DataRecoveryTool } from "@/components/admin/DataRecoveryTool";
import { DeletedRecordsRecovery } from "@/components/admin/DeletedRecordsRecovery";
import { ReportOwnershipTool } from "@/components/admin/ReportOwnershipTool";
import { DatabaseBackupsPanel } from "@/components/admin/DatabaseBackupsPanel";
import { OrganizationReportsPanel } from "@/components/admin/OrganizationReportsPanel";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { VersionDistributionPanel } from "@/components/admin/VersionDistributionPanel";
import { MinVersionPolicyPanel } from "@/components/admin/MinVersionPolicyPanel";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "sonner";
import { parseLocalDate } from "@/lib/date-utils";
import { getSessionBackground } from "@/lib/background-manager";
import { getUserWithCache } from "@/lib/cached-auth";

// Local types — admin payloads aren't in the generated Supabase types.
type ManagedUserRole = {
  user_id: string;
  role: string;
  organization_id: string | null;
};
type ManagedUserOrg = { id: string; name: string };
type ManagedUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  lastSignIn: string | null;
  roles: ManagedUserRole[];
  organizations: ManagedUserOrg[];
  isSuperAdmin: boolean;
  isActive: boolean;
  currentRole?: string;
};

type AdminOrgInspectionStub = { inspection_date: string | null };
type AdminOrganization = {
  id: string;
  name: string;
  created_at: string;
  inspections?: AdminOrgInspectionStub[] | null;
  trainings?: Array<{ id: string }> | null;
  daily_assessments?: Array<{ id: string }> | null;
  organization_members?: Array<{ count: number }> | null;
};

type AdminUserFormPayload = {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  organizationId?: string;
  role?: 'admin' | 'inspector' | 'trainer';
};

/** Joined profile/inspector fields that exist on report rows but aren't
 *  in the generated Supabase types because they come from a renamed FK alias
 *  (`inspector:profiles!...`, `trainer:profiles!...`). */
type JoinedReportProfile = {
  inspector?: ProfileLike | null;
  trainer?: ProfileLike | null;
  inspector_id?: string | null;
  trainer_of_record?: string | null;
};

/** Narrow shape of FunctionsHttpError-style errors returned by
 *  `supabase.functions.invoke()`. */
type InvokeErrorContext = {
  context?: { json?: () => Promise<{ error?: string } | undefined> };
};

async function readInvokeErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error && typeof error === 'object') {
    try {
      const ctx = (error as InvokeErrorContext).context;
      const body = await ctx?.json?.();
      if (body && typeof body.error === 'string' && body.error) return body.error;
    } catch {
      // fall through to the message-based path
    }
    if (error instanceof Error && error.message) return error.message;
  }
  return fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

export default function SuperAdminDashboard() {
  const { loading } = useRequireAdmin();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isBackupAdmin, setIsBackupAdmin] = useState(false);
  useEffect(() => {
    getUserWithCache().then(u => setCurrentUserId(u?.id || null));
    // M1: Role-based backup admin check via RPC (replaces hardcoded UUID)
    supabase.rpc('is_backup_admin').then(({ data }) => {
      setIsBackupAdmin(data === true);
    });
  }, []);
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<ManagedUser | null>(null);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminAction, setAdminAction] = useState<'grant' | 'revoke'>('grant');
  const [adminTargetUser, setAdminTargetUser] = useState<ManagedUser | null>(null);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [userToDeactivate, setUserToDeactivate] = useState<ManagedUser | null>(null);
  
  // Dialog states for stat cards
  const [isUsersListOpen, setIsUsersListOpen] = useState(false);
  const [isOrgsListOpen, setIsOrgsListOpen] = useState(false);
  const [isInspectionsListOpen, setIsInspectionsListOpen] = useState(false);
  const [isTrainingsListOpen, setIsTrainingsListOpen] = useState(false);
  const [isDailyListOpen, setIsDailyListOpen] = useState(false);
  
  const [resetMetricDialogOpen, setResetMetricDialogOpen] = useState(false);
  
  // Organization edit/delete states
  const [editOrgDialogOpen, setEditOrgDialogOpen] = useState(false);
  const [deleteOrgDialogOpen, setDeleteOrgDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<AdminOrganization | null>(null);
  const [editingOrgName, setEditingOrgName] = useState("");
  const [orgToDelete, setOrgToDelete] = useState<AdminOrganization | null>(null);
  const [selectedOrgForReports, setSelectedOrgForReports] = useState<{ id: string; name: string } | null>(null);
  
  // Pagination states for dialogs
  const [usersPage, setUsersPage] = useState(1);
  const [orgsPage, setOrgsPage] = useState(1);
  const [inspectionsPage, setInspectionsPage] = useState(1);
  const [trainingsPage, setTrainingsPage] = useState(1);
  const [dailyPage, setDailyPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Managed users query
  const { data: managedUsers, refetch: refetchUsers } = useQuery({
    queryKey: ["admin-managed-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data.users as ManagedUser[];
    },
    enabled: !loading,
  });

  // Overview stats queries
  const { data: stats } = useQuery({
    queryKey: ["admin-stats", managedUsers?.length],
    queryFn: async () => {
      const [
        { count: orgsCount },
        { count: inspectionsCount },
        { data: inspectionsByStatus },
        { count: notificationsCount },
        { count: conflictsCount },
        { count: trainingsCount },
        { data: trainingsByStatus },
        { count: dailyAssessmentsCount },
        { data: dailyAssessmentsByStatus },
      ] = await Promise.all([
        supabase.from("organizations").select("*", { count: "exact", head: true }),
        supabase.from("inspections").select("*", { count: "exact", head: true }),
        supabase.from("inspections").select("status"),
        supabase.from("notifications_log").select("*", { count: "exact", head: true }).gte("sent_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from("sync_conflicts").select("*", { count: "exact", head: true }).eq("resolved", false),
        supabase.from("trainings").select("*", { count: "exact", head: true }),
        supabase.from("trainings").select("status"),
        supabase.from("daily_assessments").select("*", { count: "exact", head: true }),
        supabase.from("daily_assessments").select("status"),
      ]);

      const statusCounts = inspectionsByStatus?.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const trainingStatusCounts = trainingsByStatus?.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const dailyStatusCounts = dailyAssessmentsByStatus?.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        organizations: orgsCount || 0,
        users: managedUsers?.length || 0,
        inspections: inspectionsCount || 0,
        statusCounts: statusCounts || {},
        trainings: trainingsCount || 0,
        trainingStatusCounts: trainingStatusCounts || {},
        dailyAssessments: dailyAssessmentsCount || 0,
        dailyStatusCounts: dailyStatusCounts || {},
        recentNotifications: notificationsCount || 0,
        unresolvedConflicts: conflictsCount || 0,
      };
    },
    enabled: !loading && managedUsers !== undefined,
  });

  // Trigger health check (P2)
  const { data: triggerHealth } = useQuery({
    queryKey: ["trigger-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_trigger_health');
      if (error) throw error;
      return data as { healthy: boolean; active_count: number; expected_count: number };
    },
    enabled: !loading,
    refetchInterval: 300000, // recheck every 5 minutes
  });

  // Organizations query with trainings and daily assessments
  const { data: organizations, refetch: refetchOrganizations } = useQuery({
    queryKey: ["admin-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select(`
          *,
          inspections(inspection_date),
          trainings(id),
          daily_assessments(id),
          organization_members(count)
        `)
        .order("name", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !loading,
  });

  // Users with roles query
  const { data: usersWithRoles } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select(`
          user_id,
          created_at,
          organization_id,
          organizations(name)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get roles for all users
      const { data: rolesData } = await supabase
        .from("user_roles")
        .select("user_id, organization_id, role");

      // Combine the data
      const combined = data?.map(member => {
        const userRole = rolesData?.find(
          r => r.user_id === member.user_id && r.organization_id === member.organization_id
        );
        return {
          ...member,
          role: userRole?.role || "member",
        };
      });

      return combined;
    },
    enabled: !loading,
  });

  // All inspections query
  const { data: allInspections } = useQuery({
    queryKey: ["admin-inspections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inspections")
        .select(`
          *,
          organizations(name),
          inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
    enabled: !loading,
  });

  // All trainings query
  const { data: allTrainings } = useQuery({
    queryKey: ["admin-trainings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trainings")
        .select(`
          *,
          organizations(name),
          trainer:profiles!trainings_inspector_id_profiles_fkey(first_name, last_name)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
    enabled: !loading,
  });

  // All daily assessments query
  const { data: allDailyAssessments } = useQuery({
    queryKey: ["admin-daily-assessments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_assessments")
        .select(`
          *,
          organizations(name),
          inspector:profiles!daily_assessments_inspector_id_profiles_fkey(first_name, last_name)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
    enabled: !loading,
  });

  // Notifications log query
  const { data: notifications } = useQuery({
    queryKey: ["admin-notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications_log")
        .select("*")
        .order("sent_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
    enabled: !loading,
  });

  // Build a unified inspector_id → profile map across all three report types so
  // table cells can resolve a name even when the joined `inspector` / `trainer`
  // blob was stripped on a local IDB write. Hook handles synchronous seed from
  // available joins plus lazy fill via getCachedProfile.
  const allReportsForProfileMap = useMemo(
    () => [
      ...((allInspections as ReadonlyArray<Record<string, unknown>>) ?? []),
      ...((allTrainings as ReadonlyArray<Record<string, unknown>>) ?? []),
      ...((allDailyAssessments as ReadonlyArray<Record<string, unknown>>) ?? []),
    ],
    [allInspections, allTrainings, allDailyAssessments],
  );
  const profilesById = useProfileMap(allReportsForProfileMap);

  // Push subscriptions query
  const { data: subscriptions } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !loading,
  });

  // Fetch reset timestamp from admin_settings
  const { data: resetTimestamp } = useQuery({
    queryKey: ["admin-settings", "avg_completion_time_reset_at"],
    queryFn: async () => {
      // admin_settings isn't in the generated Supabase types.
      // @ts-expect-error untyped admin_settings table
      const { data, error } = await supabase
        .from("admin_settings")
        .select("value, updated_at")
        .eq("key", "avg_completion_time_reset_at")
        .single();

      if (error) return { value: '1970-01-01T00:00:00Z', updated_at: null };
      return data as { value: string; updated_at: string | null };
    },
    enabled: !loading,
  });

  // Average completion time query (respects reset timestamp)
  const { data: avgCompletionTimeData } = useQuery({
    queryKey: ["avg-completion-time", resetTimestamp?.value],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const resetAt = resetTimestamp?.value || '1970-01-01T00:00:00Z';
      const lowerBound = resetAt > thirtyDaysAgo ? resetAt : thirtyDaysAgo;
      
      const { data, error } = await supabase
        .from("inspections")
        .select("created_at, started_at, updated_at, active_duration_seconds")
        .eq("status", "completed")
        .not("updated_at", "is", null)
        .gte("updated_at", lowerBound);
      
      if (error) throw error;
      
      if (!data || data.length === 0) return { avg: 0, count: 0, min: 0, max: 0, activeCount: 0 };
      
      let activeCount = 0;
      const durations = data
        .filter(i => i.created_at)
        .map((inspection) => {
          // Prefer active_duration_seconds when available
          if (inspection.active_duration_seconds && inspection.active_duration_seconds > 0) {
            activeCount++;
            return inspection.active_duration_seconds / 3600;
          }
          // Fall back to wall-clock calculation
          const startTime = inspection.started_at 
            ? new Date(inspection.started_at).getTime()
            : new Date(inspection.created_at!).getTime();
          const endTime = new Date(inspection.updated_at!).getTime();
          return (endTime - startTime) / (1000 * 60 * 60);
        }).filter(h => h > 0 && h < 8760);
      
      if (durations.length === 0) return { avg: 0, count: 0, min: 0, max: 0, activeCount: 0 };
      
      const total = durations.reduce((s, h) => s + h, 0);
      return {
        avg: total / durations.length,
        count: durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        activeCount,
      };
    },
    enabled: !loading && resetTimestamp !== undefined,
  });
  const avgCompletionTime = avgCompletionTimeData?.avg ?? 0;

  // Inspections this month query
  const { data: inspectionsThisMonth } = useQuery({
    queryKey: ["inspections-this-month"],
    queryFn: async () => {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      
      const { count, error } = await supabase
        .from("inspections")
        .select("*", { count: "exact", head: true })
        .gte("created_at", firstDay);
      
      if (error) throw error;
      return count || 0;
    },
    enabled: !loading,
  });

  // User management functions
  const handleCreateUser = async (userData: AdminUserFormPayload) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: 'create',
          ...userData
        }
      });

      if (error) {
        throw new Error(await readInvokeErrorMessage(error, 'Failed to create user'));
      }
      if (!data?.success) throw new Error(data?.error || 'Failed to create user');

      toast.success(`User ${userData.email} created successfully`);
      refetchUsers();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error(errorMessage(error, 'Failed to create user'));
      throw error;
    }
  };

  const handleUpdateUser = async (userData: AdminUserFormPayload) => {
    if (!selectedUser) return;
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: 'update',
          userId: selectedUser.id,
          ...userData
        }
      });

      if (error) {
        throw new Error(await readInvokeErrorMessage(error, 'Failed to update user'));
      }
      if (!data?.success) throw new Error(data?.error || 'Failed to update user');

      toast.success('User updated successfully');
      refetchUsers();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error(errorMessage(error, 'Failed to update user'));
      throw error;
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: { 
          action: 'delete',
          userId: userToDelete.id
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success('User deleted successfully');
      setDeleteDialogOpen(false);
      setUserToDelete(null);
      refetchUsers();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error(errorMessage(error, 'Failed to delete user'));
    }
  };

  const handleEditClick = (user: ManagedUser) => {
    // Determine the user's primary role
    const primaryRole = user.isSuperAdmin
      ? 'admin'
      : user.roles?.find((r) => r.role === 'admin')
        ? 'admin'
        : user.roles?.find((r) => r.role === 'inspector')
          ? 'inspector'
          : 'inspector';
    setSelectedUser({ ...user, currentRole: primaryRole });
    setDialogMode('edit');
    setDialogOpen(true);
  };

  const handleDeleteClick = (user: ManagedUser) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const handleAdminToggle = (user: ManagedUser) => {
    setAdminTargetUser(user);
    setAdminAction(user.isSuperAdmin ? 'revoke' : 'grant');
    setAdminDialogOpen(true);
  };

  const handleConfirmAdminToggle = async () => {
    if (!adminTargetUser) return;

    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: adminAction === 'grant' ? 'grant_admin' : 'revoke_admin',
          userId: adminTargetUser.id
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success(adminAction === 'grant' 
        ? 'Admin privileges granted' 
        : 'Admin privileges revoked');
      setAdminDialogOpen(false);
      setAdminTargetUser(null);
      refetchUsers();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error) {
      console.error('Error toggling admin:', error);
      toast.error(errorMessage(error, 'Failed to update admin status'));
    }
  };

  const handleDeactivateClick = (user: ManagedUser) => {
    setUserToDeactivate(user);
    setDeactivateDialogOpen(true);
  };

  const handleConfirmDeactivateToggle = async () => {
    if (!userToDeactivate) return;
    const isCurrentlyActive = userToDeactivate.isActive !== false;

    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: {
          action: isCurrentlyActive ? 'deactivate' : 'reactivate',
          userId: userToDeactivate.id,
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success(isCurrentlyActive ? 'User deactivated' : 'User reactivated');
      setDeactivateDialogOpen(false);
      setUserToDeactivate(null);
      refetchUsers();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error) {
      console.error('Error toggling user activation:', error);
      toast.error(errorMessage(error, 'Failed to update user status'));
    }
  };

  // Reset avg completion time metric
  const handleResetCompletionTime = async () => {
    try {
      // admin_settings isn't in the generated Supabase types.
      // @ts-expect-error untyped admin_settings table
      const { error } = await supabase
        .from("admin_settings")
        .update({ value: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("key", "avg_completion_time_reset_at");

      if (error) throw error;
      
      toast.success("Metric reset — tracking starts from now");
      setResetMetricDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      queryClient.invalidateQueries({ queryKey: ["avg-completion-time"] });
    } catch (error) {
      console.error("Error resetting metric:", error);
      toast.error(errorMessage(error, "Failed to reset metric"));
    }
  };


  // Organization management functions
  const handleEditOrg = (org: AdminOrganization) => {
    setSelectedOrg(org);
    setEditingOrgName(org.name);
    setEditOrgDialogOpen(true);
  };

  const handleDeleteOrgClick = (org: AdminOrganization) => {
    setOrgToDelete(org);
    setDeleteOrgDialogOpen(true);
  };

  const handleSaveOrg = async () => {
    if (!selectedOrg || !editingOrgName.trim()) return;

    try {
      const { error } = await supabase
        .from("organizations")
        .update({ name: editingOrgName.trim() })
        .eq("id", selectedOrg.id);

      if (error) throw error;

      toast.success("Organization updated successfully");
      setEditOrgDialogOpen(false);
      setSelectedOrg(null);
      setEditingOrgName("");
      refetchOrganizations();
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (error) {
      console.error("Error updating organization:", error);
      toast.error(errorMessage(error, "Failed to update organization"));
    }
  };

  const handleDeleteOrg = async () => {
    if (!orgToDelete) return;

    try {
      const { error } = await supabase
        .from("organizations")
        .delete()
        .eq("id", orgToDelete.id);

      if (error) throw error;

      toast.success("Organization deleted successfully");
      setDeleteOrgDialogOpen(false);
      setOrgToDelete(null);
      refetchOrganizations();
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (error) {
      console.error("Error deleting organization:", error);
      toast.error(errorMessage(error, "Failed to delete organization"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <div className="fixed inset-0 z-0">
        <img src={getSessionBackground()} alt="" className="w-full h-full object-cover" />
      </div>
      <div className="relative z-10 min-h-screen bg-gradient-to-b from-background/50 via-background/60 to-background/80 backdrop-blur-sm">
    <div className="container mx-auto px-6 py-10 md:px-10 space-y-10 max-w-7xl">
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => goBack(navigate)}
          className="mt-1 hover:bg-white/5 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground/70 text-sm tracking-wide">Manage all organizations, users, and inspections</p>
        </div>
      </div>

      {/* Trigger Health Warning */}
      {triggerHealth && !triggerHealth.healthy && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <strong>Database triggers degraded:</strong> {triggerHealth.active_count}/{triggerHealth.expected_count} active.
            Notifications, audit logging, and automated field management may not be working. Contact your developer.
          </div>
        </div>
      )}

      {/* Overview Stats - Row 1 */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Organizations"
          value={stats?.organizations || 0}
          icon={Building2}
          onClick={() => setIsOrgsListOpen(true)}
          hoverContent={{
            title: "All Organizations",
            description: "Total client organizations registered in the system.",
            details: [
              { label: "Total registered", value: stats?.organizations || 0 },
              { label: "With inspections", value: organizations?.filter(o => ((o as AdminOrganization).inspections?.length ?? 0) > 0).length || 0 },
            ],
            tip: "Click to view full organization list"
          }}
        />
        <StatCard
          title="Total Users"
          value={stats?.users || 0}
          icon={Users}
          onClick={() => setIsUsersListOpen(true)}
          hoverContent={{
            title: "System Users",
            description: "All registered users including inspectors and admins.",
            details: [
              { label: "Admins", value: managedUsers?.filter((u) => u.isSuperAdmin).length || 0 },
              { label: "Regular users", value: managedUsers?.filter((u) => !u.isSuperAdmin).length || 0 },
            ],
            tip: "Click to manage user accounts"
          }}
        />
        <StatCard
          title="Inspections"
          value={stats?.inspections || 0}
          icon={ClipboardList}
          description={`${stats?.statusCounts?.completed || 0} completed, ${stats?.statusCounts?.draft || 0} draft`}
          onClick={() => setIsInspectionsListOpen(true)}
          hoverContent={{
            title: "Inspection Reports",
            description: "Field inspection reports for adventure courses.",
            details: [
              { label: "Completed", value: stats?.statusCounts?.completed || 0 },
              { label: "Draft", value: stats?.statusCounts?.draft || 0 },
              { label: "In progress", value: stats?.statusCounts?.in_progress || 0 },
            ],
            tip: "Click to view all inspections"
          }}
        />
      </div>

      {/* Overview Stats - Row 2 */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Training Reports"
          value={stats?.trainings || 0}
          icon={GraduationCap}
          description={`${stats?.trainingStatusCounts?.completed || 0} completed, ${stats?.trainingStatusCounts?.draft || 0} draft`}
          onClick={() => setIsTrainingsListOpen(true)}
          hoverContent={{
            title: "Training Sessions",
            description: "Documented training sessions and audit reports.",
            details: [
              { label: "Completed", value: stats?.trainingStatusCounts?.completed || 0 },
              { label: "Draft", value: stats?.trainingStatusCounts?.draft || 0 },
              { label: "In progress", value: stats?.trainingStatusCounts?.in_progress || 0 },
            ],
            tip: "Click to view all training reports"
          }}
        />
        <StatCard
          title="Daily Assessments"
          value={stats?.dailyAssessments || 0}
          icon={ClipboardCheck}
          description={`${stats?.dailyStatusCounts?.completed || 0} completed, ${stats?.dailyStatusCounts?.draft || 0} draft`}
          onClick={() => setIsDailyListOpen(true)}
          hoverContent={{
            title: "Daily Facility Checks",
            description: "Daily assessment reports for facility operations.",
            details: [
              { label: "Completed", value: stats?.dailyStatusCounts?.completed || 0 },
              { label: "Draft", value: stats?.dailyStatusCounts?.draft || 0 },
            ],
            tip: "Click to view all daily assessments"
          }}
        />
        <StatCard
          title="Recent Notifications"
          value={stats?.recentNotifications || 0}
          icon={Bell}
          description="Last 7 days"
          hoverContent={{
            title: "Push Notifications",
            description: "Notifications sent to users in the last 7 days.",
            details: [
              { label: "Weekly total", value: stats?.recentNotifications || 0 },
              { label: "Daily average", value: ((stats?.recentNotifications || 0) / 7).toFixed(1) },
            ],
            tip: "View the Notifications tab for details"
          }}
        />
      </div>

      {/* Overview Stats - Row 3 */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {/* DISABLED: Avg Completion Time — greyed out until timer accuracy is resolved */}
        <div className="opacity-40 pointer-events-none select-none">
        <StatCard
          title="Avg Completion Time"
          value={avgCompletionTime ? `${avgCompletionTime.toFixed(1)}h` : "0h"}
          icon={Clock}
          description="Average time to complete"
          hoverContent={{
            title: "Inspection Duration",
            description: avgCompletionTimeData?.activeCount 
              ? `Uses active editing time for ${avgCompletionTimeData.activeCount} report(s); wall-clock for the rest.`
              : "Average time from inspection creation to completion.",
            details: [
              { label: "Average", value: avgCompletionTime ? `${avgCompletionTime.toFixed(1)} hours` : "N/A" },
              { label: "Fastest", value: avgCompletionTimeData?.min ? `${avgCompletionTimeData.min.toFixed(1)} hours` : "N/A" },
              { label: "Slowest", value: avgCompletionTimeData?.max ? `${avgCompletionTimeData.max.toFixed(1)} hours` : "N/A" },
              { label: "Sample size", value: avgCompletionTimeData?.count ?? 0 },
              { label: "Active-tracked", value: avgCompletionTimeData?.activeCount ?? 0 },
            ],
            tip: "Active time tracks only when users are editing. Older reports use wall-clock time as fallback."
          }}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs font-mono bg-background/50 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setResetMetricDialogOpen(true);
                }}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                RESET
              </Button>
              {resetTimestamp?.updated_at && resetTimestamp.value !== '1970-01-01T00:00:00Z' && (
                <Badge className="h-5 text-[10px] font-mono bg-background/50 text-emerald-400 border-emerald-500/30 hover:bg-background/50">
                  RST {format(new Date(resetTimestamp.updated_at), "MM/dd HH:mm")}
                </Badge>
              )}
            </div>
          }
        />
        </div>
        <StatCard
          title="This Month"
          value={inspectionsThisMonth || 0}
          icon={Calendar}
          description="Inspections created"
          hoverContent={{
            title: "Monthly Activity",
            description: "Inspections created in the current calendar month.",
            details: [
              { label: "This month", value: inspectionsThisMonth || 0 },
            ],
            tip: "Track monthly trends over time"
          }}
        />
      </div>

      {/* Tabs for different sections */}
      <Tabs defaultValue="organizations" className="space-y-6">
        <AdminTabsSection showBackupTab={isBackupAdmin} />

        <TabsContent value="organizations" className="space-y-4">
          {/* Desktop table */}
          <div className="hidden md:block rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead className="text-center">Inspections</TableHead>
                  <TableHead className="text-center">Training Reports</TableHead>
                  <TableHead className="text-center">Daily Reports</TableHead>
                  <TableHead>Last Inspection</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No organizations found
                    </TableCell>
                  </TableRow>
                ) : (
                  organizations?.map((org) => {
                    const adminOrg = org as AdminOrganization;
                    const inspectionCount = adminOrg.inspections?.length || 0;
                    const trainingCount = adminOrg.trainings?.length || 0;
                    const dailyAssessmentCount = adminOrg.daily_assessments?.length || 0;
                    const lastInspectionDate = adminOrg.inspections && adminOrg.inspections.length > 0
                      ? adminOrg.inspections.reduce<string | null>((latest, insp) => {
                          if (!insp.inspection_date) return latest;
                          if (!latest || new Date(insp.inspection_date) > new Date(latest)) {
                            return insp.inspection_date;
                          }
                          return latest;
                        }, null)
                      : null;

                    return (
                      <TableRow key={org.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedOrgForReports({ id: org.id, name: org.name })}>
                        <TableCell className="font-medium">{org.name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={inspectionCount > 0 ? "default" : "outline"}>
                            {inspectionCount}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={trainingCount > 0 ? "default" : "outline"}>
                            {trainingCount}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={dailyAssessmentCount > 0 ? "default" : "outline"}>
                            {dailyAssessmentCount}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {lastInspectionDate ? (
                            <span className="text-sm">{format(new Date(lastInspectionDate), "PP")}</span>
                          ) : (
                            <span className="text-sm text-muted-foreground">No inspections</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(org.created_at), "PP")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleEditOrg(adminOrg); }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleDeleteOrgClick(adminOrg); }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {organizations?.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No organizations found</p>
            ) : (
              organizations?.map((org) => {
                const adminOrg = org as AdminOrganization;
                const inspectionCount = adminOrg.inspections?.length || 0;
                const trainingCount = adminOrg.trainings?.length || 0;
                const dailyAssessmentCount = adminOrg.daily_assessments?.length || 0;
                const lastInspectionDate = adminOrg.inspections && adminOrg.inspections.length > 0
                  ? adminOrg.inspections.reduce<string | null>((latest, insp) => {
                      if (!insp.inspection_date) return latest;
                      if (!latest || new Date(insp.inspection_date) > new Date(latest)) return insp.inspection_date;
                      return latest;
                    }, null)
                  : null;

                return (
                  <div key={org.id} className="rounded-lg border bg-card p-4 space-y-2 cursor-pointer active:bg-muted/50" onClick={() => setSelectedOrgForReports({ id: org.id, name: org.name })}>
                    <div className="font-medium text-sm">{org.name}</div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={inspectionCount > 0 ? "default" : "outline"} className="text-xs">{inspectionCount} Inspections</Badge>
                      <Badge variant={trainingCount > 0 ? "default" : "outline"} className="text-xs">{trainingCount} Trainings</Badge>
                      <Badge variant={dailyAssessmentCount > 0 ? "default" : "outline"} className="text-xs">{dailyAssessmentCount} Daily</Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Last: {lastInspectionDate ? format(new Date(lastInspectionDate), "PP") : 'None'}</span>
                      <span>Created: {format(new Date(org.created_at), "PP")}</span>
                    </div>
                    <div className="flex justify-end gap-1 pt-1">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleEditOrg(adminOrg); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleDeleteOrgClick(adminOrg); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <Sheet open={!!selectedOrgForReports} onOpenChange={(open) => { if (!open) setSelectedOrgForReports(null); }}>
            <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{selectedOrgForReports?.name} — Reports</SheetTitle>
                <SheetDescription>All reports associated with this organization</SheetDescription>
              </SheetHeader>
              {selectedOrgForReports && (
                <OrganizationReportsPanel
                  organizationId={selectedOrgForReports.id}
                  organizationName={selectedOrgForReports.name}
                />
              )}
            </SheetContent>
          </Sheet>
        </TabsContent>

        <TabsContent value="user-management" className="space-y-4">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-2xl font-semibold">User Management</h2>
              <p className="text-sm text-muted-foreground">Create, edit, and delete user accounts</p>
            </div>
            <Button onClick={() => { setDialogMode('create'); setSelectedUser(null); setDialogOpen(true); }}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          </div>
          
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                 <TableHead>Email</TableHead>
                 <TableHead>Name</TableHead>
                 <TableHead>Status</TableHead>
                 <TableHead>Roles</TableHead>
                 <TableHead>Last Sign In</TableHead>
                 <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managedUsers?.map((user) => {
                const isInactive = user.isActive === false;
                return (
                <TableRow key={user.id} className={isInactive ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>{user.firstName} {user.lastName}</TableCell>
                  <TableCell>
                    {isInactive ? (
                      <Badge variant="destructive" className="text-xs">Deactivated</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.roles?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {r.role}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">No roles</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.lastSignIn ? format(new Date(user.lastSignIn), "PP p") : 'Never'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeactivateClick(user)}
                        title={isInactive ? 'Reactivate User' : 'Deactivate User'}
                      >
                        {isInactive ? (
                          <UserCheck className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <UserX className="h-4 w-4 text-amber-500" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleAdminToggle(user)}
                        title={user.isSuperAdmin ? 'Remove Admin' : 'Make Admin'}
                      >
                        {user.isSuperAdmin ? (
                          <ShieldOff className="h-4 w-4 text-orange-500" />
                        ) : (
                          <Shield className="h-4 w-4 text-blue-500" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditClick(user)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(user)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {managedUsers?.map((user) => {
              const isInactive = user.isActive === false;
              return (
                <div key={user.id} className={`rounded-lg border bg-card p-4 space-y-2 ${isInactive ? 'opacity-50' : ''}`}>
                  <div className="font-medium text-sm break-all">{user.email}</div>
                  <div className="text-sm text-muted-foreground">{user.firstName} {user.lastName}</div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {isInactive ? (
                      <Badge variant="destructive" className="text-xs">Deactivated</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Active</Badge>
                    )}
                    {user.isSuperAdmin && <Badge className="text-xs">Admin</Badge>}
                    {user.roles?.map((r, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">{r.role}</Badge>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Last sign in: {user.lastSignIn ? format(new Date(user.lastSignIn), "PP p") : 'Never'}
                  </div>
                  <div className="flex gap-1 pt-1 flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => handleDeactivateClick(user)} title={isInactive ? 'Reactivate' : 'Deactivate'}>
                      {isInactive ? <UserCheck className="h-4 w-4 text-emerald-500" /> : <UserX className="h-4 w-4 text-amber-500" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleAdminToggle(user)} title={user.isSuperAdmin ? 'Remove Admin' : 'Make Admin'}>
                      {user.isSuperAdmin ? <ShieldOff className="h-4 w-4 text-orange-500" /> : <Shield className="h-4 w-4 text-blue-500" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleEditClick(user)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteClick(user)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="inspections" className="space-y-4">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Inspector</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allInspections?.map((inspection) => (
                <TableRow 
                  key={inspection.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(`/inspection/${inspection.id}`)}
                >
                  <TableCell>{inspection.organizations?.name}</TableCell>
                  <TableCell>{inspection.location}</TableCell>
                  <TableCell>
                    <Badge className={
                      inspection.status === "completed" ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30" :
                      inspection.status === "in_progress" ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" :
                      "bg-slate-500/15 text-slate-400 border-slate-400/30"
                    }>
                      {inspection.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{parseLocalDate(inspection.inspection_date) ? format(parseLocalDate(inspection.inspection_date)!, "PP") : '-'}</TableCell>
                  <TableCell>{format(new Date(inspection.created_at), "PP")}</TableCell>
                  <TableCell>
                    {resolveProfileName((inspection as JoinedReportProfile).inspector, (inspection as JoinedReportProfile).inspector_id, profilesById)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {allInspections?.map((inspection) => (
              <div key={inspection.id} className="rounded-lg border bg-card p-4 space-y-2 cursor-pointer active:bg-muted/50" onClick={() => navigate(`/inspection/${inspection.id}`)}>
                <div className="font-medium text-sm">{inspection.organizations?.name}</div>
                <div className="text-sm text-muted-foreground">{inspection.location}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={
                    inspection.status === "completed" ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30" :
                    inspection.status === "in_progress" ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" :
                    "bg-slate-500/15 text-slate-400 border-slate-400/30"
                  }>
                    {inspection.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {resolveProfileName((inspection as JoinedReportProfile).inspector, (inspection as JoinedReportProfile).inspector_id, profilesById)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Date: {parseLocalDate(inspection.inspection_date) ? format(parseLocalDate(inspection.inspection_date)!, "PP") : '-'}</span>
                  <span>Created: {format(new Date(inspection.created_at), "PP")}</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="trainings" className="space-y-4">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allTrainings?.map((training) => (
                <TableRow 
                  key={training.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(`/training/${training.id}`)}
                >
                  <TableCell>{training.organizations?.name || training.organization}</TableCell>
                  <TableCell>
                    {resolveProfileName((training as JoinedReportProfile).trainer, (training as JoinedReportProfile).inspector_id, profilesById, (training as JoinedReportProfile).trainer_of_record)}
                  </TableCell>
                  <TableCell>
                    <Badge className={
                      training.status === "completed" ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30" :
                      training.status === "in_progress" ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" :
                      "bg-slate-500/15 text-slate-400 border-slate-400/30"
                    }>
                      {training.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{parseLocalDate(training.start_date) ? format(parseLocalDate(training.start_date)!, "PP") : '-'}</TableCell>
                  <TableCell>{parseLocalDate(training.end_date) ? format(parseLocalDate(training.end_date)!, "PP") : '-'}</TableCell>
                  <TableCell>{format(new Date(training.created_at), "PP")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {allTrainings?.map((training) => (
              <div key={training.id} className="rounded-lg border bg-card p-4 space-y-2 cursor-pointer active:bg-muted/50" onClick={() => navigate(`/training/${training.id}`)}>
                <div className="font-medium text-sm">{training.organizations?.name || training.organization}</div>
                <div className="text-sm text-muted-foreground">
                  {resolveProfileName((training as JoinedReportProfile).trainer, (training as JoinedReportProfile).inspector_id, profilesById, (training as JoinedReportProfile).trainer_of_record)}
                </div>
                <Badge className={
                  training.status === "completed" ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30" :
                  training.status === "in_progress" ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" :
                  "bg-slate-500/15 text-slate-400 border-slate-400/30"
                }>
                  {training.status}
                </Badge>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Start: {parseLocalDate(training.start_date) ? format(parseLocalDate(training.start_date)!, "PP") : '-'}</span>
                  <span>End: {parseLocalDate(training.end_date) ? format(parseLocalDate(training.end_date)!, "PP") : '-'}</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="daily-assessments" className="space-y-4">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Inspector</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assessment Date</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allDailyAssessments?.map((assessment) => (
                <TableRow 
                  key={assessment.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(`/daily-assessment/${assessment.id}`)}
                >
                  <TableCell>{assessment.organizations?.name || assessment.organization}</TableCell>
                  <TableCell>{assessment.site || '-'}</TableCell>
                  <TableCell>
                    {resolveProfileName((assessment as JoinedReportProfile).inspector, (assessment as JoinedReportProfile).inspector_id, profilesById, (assessment as JoinedReportProfile).trainer_of_record)}
                  </TableCell>
                  <TableCell>
                    <Badge className={
                      assessment.status === "completed" ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30" :
                      assessment.status === "in_progress" ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" :
                      "bg-slate-500/15 text-slate-400 border-slate-400/30"
                    }>
                      {assessment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{parseLocalDate(assessment.assessment_date) ? format(parseLocalDate(assessment.assessment_date)!, "PP") : '-'}</TableCell>
                  <TableCell>{format(new Date(assessment.created_at), "PP")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {allDailyAssessments?.map((assessment) => (
              <div key={assessment.id} className="rounded-lg border bg-card p-4 space-y-2 cursor-pointer active:bg-muted/50" onClick={() => navigate(`/daily-assessment/${assessment.id}`)}>
                <div className="font-medium text-sm">{assessment.organizations?.name || assessment.organization}</div>
                <div className="text-sm text-muted-foreground">{assessment.site || '-'}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={
                    assessment.status === "completed" ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30" :
                    assessment.status === "in_progress" ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" :
                    "bg-slate-500/15 text-slate-400 border-slate-400/30"
                  }>
                    {assessment.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {resolveProfileName((assessment as JoinedReportProfile).inspector, (assessment as JoinedReportProfile).inspector_id, profilesById, (assessment as JoinedReportProfile).trainer_of_record)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Date: {parseLocalDate(assessment.assessment_date) ? format(parseLocalDate(assessment.assessment_date)!, "PP") : '-'}</span>
                  <span>Created: {format(new Date(assessment.created_at), "PP")}</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>


        <TabsContent value="notifications" className="space-y-4">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notifications?.map((notif) => (
                <TableRow key={notif.id}>
                  <TableCell>
                    <Badge variant="outline">{notif.notification_type}</Badge>
                  </TableCell>
                  <TableCell>{notif.title}</TableCell>
                  <TableCell>
                    <Badge variant={notif.status === "sent" ? "default" : "destructive"}>
                      {notif.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{format(new Date(notif.sent_at), "PPp")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {notifications?.map((notif) => (
              <div key={notif.id} className="rounded-lg border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="text-xs">{notif.notification_type}</Badge>
                  <Badge variant={notif.status === "sent" ? "default" : "destructive"} className="text-xs">
                    {notif.status}
                  </Badge>
                </div>
                <div className="text-sm font-medium">{notif.title}</div>
                <div className="text-xs text-muted-foreground">{format(new Date(notif.sent_at), "PPp")}</div>
              </div>
            ))}
          </div>
        </TabsContent>


        <TabsContent value="subscriptions" className="space-y-4">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>User Agent</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions?.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-mono text-xs">{sub.user_id.slice(0, 8)}...</TableCell>
                  <TableCell className="max-w-xs truncate">{sub.user_agent}</TableCell>
                  <TableCell>{format(new Date(sub.created_at), "PP")}</TableCell>
                  <TableCell>{format(new Date(sub.last_used_at), "PP")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {subscriptions?.map((sub) => (
              <div key={sub.id} className="rounded-lg border bg-card p-4 space-y-1">
                <div className="font-mono text-xs">{sub.user_id.slice(0, 8)}...</div>
                <div className="text-xs text-muted-foreground break-all">{sub.user_agent}</div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Created: {format(new Date(sub.created_at), "PP")}</span>
                  <span>Last: {format(new Date(sub.last_used_at), "PP")}</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="data-recovery" className="space-y-4">
          <DataRecoveryTool deletedRecordsSlot={<DeletedRecordsRecovery />} />
        </TabsContent>


        <TabsContent value="report-ownership" className="space-y-4">
          <ReportOwnershipTool />
        </TabsContent>

        <TabsContent value="database-backups" className="space-y-4">
          <DatabaseBackupsPanel />
        </TabsContent>

        <TabsContent value="audit-logs" className="space-y-4">
          <AuditLogPanel />
          <VersionDistributionPanel />
          <MinVersionPolicyPanel />
        </TabsContent>
      </Tabs>

      {/* Users List Dialog */}
      <Dialog open={isUsersListOpen} onOpenChange={(open) => { setIsUsersListOpen(open); if (!open) setUsersPage(1); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>All Users ({managedUsers?.length || 0})</DialogTitle>
          </DialogHeader>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managedUsers?.slice((usersPage - 1) * ITEMS_PER_PAGE, usersPage * ITEMS_PER_PAGE).map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>
                    {user.firstName || user.lastName 
                      ? `${user.firstName} ${user.lastName}`.trim() 
                      : '-'}
                  </TableCell>
                  <TableCell>
                    {user.organizations?.length > 0
                      ? user.organizations.map((org) => org.name).join(', ')
                      : '-'}
                  </TableCell>
                  <TableCell>
                    {user.roles?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r, idx) => (
                          <Badge key={idx} variant="outline">{r.role}</Badge>
                        ))}
                      </div>
                    ) : '-'}
                  </TableCell>
                  <TableCell>{format(new Date(user.createdAt), "PP")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {managedUsers?.slice((usersPage - 1) * ITEMS_PER_PAGE, usersPage * ITEMS_PER_PAGE).map((user) => (
              <div key={user.id} className="rounded-lg border bg-card p-3 space-y-1">
                <div className="font-medium text-sm break-all">{user.email}</div>
                <div className="text-sm text-muted-foreground">{user.firstName || user.lastName ? `${user.firstName} ${user.lastName}`.trim() : '-'}</div>
                <div className="flex flex-wrap gap-1">
                  {user.roles?.map((r, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">{r.role}</Badge>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">Joined: {format(new Date(user.createdAt), "PP")}</div>
              </div>
            ))}
          </div>
          {managedUsers && managedUsers.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((usersPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(usersPage * ITEMS_PER_PAGE, managedUsers.length)} of {managedUsers.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setUsersPage(p => Math.max(1, p - 1))} disabled={usersPage === 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setUsersPage(p => p + 1)} disabled={usersPage * ITEMS_PER_PAGE >= managedUsers.length}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Organizations List Dialog */}
      <Dialog open={isOrgsListOpen} onOpenChange={(open) => { setIsOrgsListOpen(open); if (!open) setOrgsPage(1); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>All Organizations ({organizations?.length || 0})</DialogTitle>
          </DialogHeader>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Inspections</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations?.slice((orgsPage - 1) * ITEMS_PER_PAGE, orgsPage * ITEMS_PER_PAGE).map((org) => {
                const adminOrg = org as AdminOrganization;
                return (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell>{adminOrg.organization_members?.[0]?.count || 0}</TableCell>
                  <TableCell>{adminOrg.inspections?.length || 0}</TableCell>
                  <TableCell>{format(new Date(org.created_at), "PP")}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          <div className="md:hidden space-y-3">
            {organizations?.slice((orgsPage - 1) * ITEMS_PER_PAGE, orgsPage * ITEMS_PER_PAGE).map((org) => (
              <div key={org.id} className="rounded-lg border bg-card p-3 space-y-1">
                <div className="font-medium text-sm">{org.name}</div>
                <div className="text-xs text-muted-foreground">Created: {format(new Date(org.created_at), "PP")}</div>
              </div>
            ))}
          </div>
          {organizations && organizations.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((orgsPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(orgsPage * ITEMS_PER_PAGE, organizations.length)} of {organizations.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setOrgsPage(p => Math.max(1, p - 1))} disabled={orgsPage === 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setOrgsPage(p => p + 1)} disabled={orgsPage * ITEMS_PER_PAGE >= organizations.length}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Inspections List Dialog */}
      <Dialog open={isInspectionsListOpen} onOpenChange={(open) => { setIsInspectionsListOpen(open); if (!open) setInspectionsPage(1); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>All Inspections ({allInspections?.length || 0})</DialogTitle>
          </DialogHeader>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allInspections?.slice((inspectionsPage - 1) * ITEMS_PER_PAGE, inspectionsPage * ITEMS_PER_PAGE).map((inspection) => (
                <TableRow key={inspection.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setIsInspectionsListOpen(false); navigate(`/inspection/${inspection.id}`); }}>
                  <TableCell className="font-medium">{inspection.organization}</TableCell>
                  <TableCell>{inspection.location}</TableCell>
                  <TableCell>
                    <Badge variant={inspection.status === 'completed' ? 'default' : 'secondary'}>
                      {inspection.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{format(new Date(inspection.inspection_date), "PP")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <div className="md:hidden space-y-3">
            {allInspections?.slice((inspectionsPage - 1) * ITEMS_PER_PAGE, inspectionsPage * ITEMS_PER_PAGE).map((inspection) => (
              <div key={inspection.id} className="rounded-lg border bg-card p-3 space-y-1 cursor-pointer active:bg-muted/50" onClick={() => { setIsInspectionsListOpen(false); navigate(`/inspection/${inspection.id}`); }}>
                <div className="font-medium text-sm">{inspection.organization}</div>
                <div className="text-sm text-muted-foreground">{inspection.location}</div>
                <div className="flex items-center justify-between">
                  <Badge variant={inspection.status === 'completed' ? 'default' : 'secondary'} className="text-xs">{inspection.status}</Badge>
                  <span className="text-xs text-muted-foreground">{format(new Date(inspection.inspection_date), "PP")}</span>
                </div>
              </div>
            ))}
          </div>
          {allInspections && allInspections.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((inspectionsPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(inspectionsPage * ITEMS_PER_PAGE, allInspections.length)} of {allInspections.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setInspectionsPage(p => Math.max(1, p - 1))} disabled={inspectionsPage === 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setInspectionsPage(p => p + 1)} disabled={inspectionsPage * ITEMS_PER_PAGE >= allInspections.length}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Trainings List Dialog */}
      <Dialog open={isTrainingsListOpen} onOpenChange={(open) => { setIsTrainingsListOpen(open); if (!open) setTrainingsPage(1); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>All Training Reports ({allTrainings?.length || 0})</DialogTitle>
          </DialogHeader>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allTrainings?.slice((trainingsPage - 1) * ITEMS_PER_PAGE, trainingsPage * ITEMS_PER_PAGE).map((training) => (
                <TableRow key={training.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setIsTrainingsListOpen(false); navigate(`/training/${training.id}`); }}>
                  <TableCell className="font-medium">{training.organizations?.name || training.organization}</TableCell>
                  <TableCell>
                    {resolveProfileName((training as JoinedReportProfile).trainer, (training as JoinedReportProfile).inspector_id, profilesById, (training as JoinedReportProfile).trainer_of_record)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={training.status === 'completed' ? 'default' : 'secondary'}>
                      {training.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{parseLocalDate(training.start_date) ? format(parseLocalDate(training.start_date)!, "PP") : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <div className="md:hidden space-y-3">
            {allTrainings?.slice((trainingsPage - 1) * ITEMS_PER_PAGE, trainingsPage * ITEMS_PER_PAGE).map((training) => (
              <div key={training.id} className="rounded-lg border bg-card p-3 space-y-1 cursor-pointer active:bg-muted/50" onClick={() => { setIsTrainingsListOpen(false); navigate(`/training/${training.id}`); }}>
                <div className="font-medium text-sm">{training.organizations?.name || training.organization}</div>
                <div className="text-sm text-muted-foreground">
                  {resolveProfileName((training as JoinedReportProfile).trainer, (training as JoinedReportProfile).inspector_id, profilesById, (training as JoinedReportProfile).trainer_of_record)}
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant={training.status === 'completed' ? 'default' : 'secondary'} className="text-xs">{training.status}</Badge>
                  <span className="text-xs text-muted-foreground">{parseLocalDate(training.start_date) ? format(parseLocalDate(training.start_date)!, "PP") : '-'}</span>
                </div>
              </div>
            ))}
          </div>
          {allTrainings && allTrainings.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((trainingsPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(trainingsPage * ITEMS_PER_PAGE, allTrainings.length)} of {allTrainings.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setTrainingsPage(p => Math.max(1, p - 1))} disabled={trainingsPage === 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setTrainingsPage(p => p + 1)} disabled={trainingsPage * ITEMS_PER_PAGE >= allTrainings.length}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Daily Assessments List Dialog */}
      <Dialog open={isDailyListOpen} onOpenChange={(open) => { setIsDailyListOpen(open); if (!open) setDailyPage(1); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>All Daily Assessments ({allDailyAssessments?.length || 0})</DialogTitle>
          </DialogHeader>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assessment Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allDailyAssessments?.slice((dailyPage - 1) * ITEMS_PER_PAGE, dailyPage * ITEMS_PER_PAGE).map((assessment) => (
                <TableRow key={assessment.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setIsDailyListOpen(false); navigate(`/daily-assessment/${assessment.id}`); }}>
                  <TableCell className="font-medium">{assessment.organizations?.name || assessment.organization}</TableCell>
                  <TableCell>{assessment.site || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={assessment.status === 'completed' ? 'default' : 'secondary'}>
                      {assessment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{parseLocalDate(assessment.assessment_date) ? format(parseLocalDate(assessment.assessment_date)!, "PP") : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <div className="md:hidden space-y-3">
            {allDailyAssessments?.slice((dailyPage - 1) * ITEMS_PER_PAGE, dailyPage * ITEMS_PER_PAGE).map((assessment) => (
              <div key={assessment.id} className="rounded-lg border bg-card p-3 space-y-1 cursor-pointer active:bg-muted/50" onClick={() => { setIsDailyListOpen(false); navigate(`/daily-assessment/${assessment.id}`); }}>
                <div className="font-medium text-sm">{assessment.organizations?.name || assessment.organization}</div>
                <div className="text-sm text-muted-foreground">{assessment.site || '-'}</div>
                <div className="flex items-center justify-between">
                  <Badge variant={assessment.status === 'completed' ? 'default' : 'secondary'} className="text-xs">{assessment.status}</Badge>
                  <span className="text-xs text-muted-foreground">{parseLocalDate(assessment.assessment_date) ? format(parseLocalDate(assessment.assessment_date)!, "PP") : '-'}</span>
                </div>
              </div>
            ))}
          </div>
          {allDailyAssessments && allDailyAssessments.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                Showing {((dailyPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(dailyPage * ITEMS_PER_PAGE, allDailyAssessments.length)} of {allDailyAssessments.length}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDailyPage(p => Math.max(1, p - 1))} disabled={dailyPage === 1}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDailyPage(p => p + 1)} disabled={dailyPage * ITEMS_PER_PAGE >= allDailyAssessments.length}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* User Management Dialog */}
      <UserManagementDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        user={selectedUser}
        organizations={organizations || []}
        onSubmit={dialogMode === 'create' ? handleCreateUser : handleUpdateUser}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Permanently Delete User?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will permanently delete the account for <strong>{userToDelete?.email}</strong>.
                  This action cannot be undone.
                </p>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <p className="font-medium mb-1">⚠️ Reports will be preserved</p>
                  <p>All inspections, trainings, and daily assessments created by this user will remain in the system, but the inspector name will be removed from those reports.</p>
                </div>
                <p className="text-sm font-medium">
                  Consider <strong>deactivating</strong> the user instead — this prevents login while keeping full report attribution.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Deactivate / Reactivate Confirmation Dialog */}
      <AlertDialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {userToDeactivate?.isActive !== false ? 'Deactivate User' : 'Reactivate User'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {userToDeactivate?.isActive !== false ? (
                  <>
                    <p>
                      Deactivating <strong>{userToDeactivate?.email}</strong> will prevent them from logging in.
                    </p>
                    <p className="text-sm">
                      Their profile and all reports will remain intact with full attribution. You can reactivate them at any time.
                    </p>
                  </>
                ) : (
                  <p>
                    Reactivating <strong>{userToDeactivate?.email}</strong> will restore their ability to log in and use the system.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeactivateToggle}
              className={userToDeactivate?.isActive !== false
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'}
            >
              {userToDeactivate?.isActive !== false ? 'Deactivate' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge Organizations Dialog */}
      <MergeOrganizationsDialog
        open={isMergeDialogOpen}
        onOpenChange={setIsMergeDialogOpen}
      />

      {/* Admin Toggle Confirmation Dialog */}
      <AlertDialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {adminAction === 'grant' ? 'Grant Admin Access' : 'Revoke Admin Access'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {adminAction === 'grant' ? (
                <>
                  Are you sure you want to grant admin privileges to{' '}
                  <strong>{adminTargetUser?.email}</strong>?
                  They will have full access to manage all organizations, users, and system settings.
                </>
              ) : (
                <>
                  Are you sure you want to revoke admin privileges from{' '}
                  <strong>{adminTargetUser?.email}</strong>?
                  They will lose access to the admin dashboard and system-wide management capabilities.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmAdminToggle}
              className={adminAction === 'grant' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-600 hover:bg-orange-700'}
            >
              {adminAction === 'grant' ? 'Grant Access' : 'Revoke Access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Organization Dialog */}
      <Dialog open={editOrgDialogOpen} onOpenChange={setEditOrgDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Organization Name</label>
              <input
                type="text"
                value={editingOrgName}
                onChange={(e) => setEditingOrgName(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Enter organization name"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditOrgDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveOrg} disabled={!editingOrgName.trim()}>
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Organization Confirmation Dialog */}
      <AlertDialog open={deleteOrgDialogOpen} onOpenChange={setDeleteOrgDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Organization</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{orgToDelete?.name}</strong>?
              {orgToDelete && (
                <div className="mt-2 text-sm">
                  <p>This organization has:</p>
                  <ul className="list-disc list-inside mt-1">
                    <li>{orgToDelete.inspections?.length || 0} inspection(s)</li>
                    <li>{orgToDelete.trainings?.length || 0} training report(s)</li>
                    <li>{orgToDelete.daily_assessments?.length || 0} daily report(s)</li>
                  </ul>
                  <p className="mt-2 text-destructive font-medium">
                    Note: Related records may become orphaned.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOrg}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Organization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Metric Confirmation Dialog */}
      <AlertDialog open={resetMetricDialogOpen} onOpenChange={setResetMetricDialogOpen}>
        <AlertDialogContent className="bg-[#0a0a0a] border-[#00ff41]/30 text-[#00ff41] font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#00ff41] font-mono">
              &gt; RESET_METRIC_CONFIRM
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#00ff41]/70 font-mono text-sm">
              This will reset the Avg Completion Time metric to 0h. All future calculations will start from this timestamp. No data will be deleted — legacy records are preserved but excluded from the metric.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono border-[#00ff41]/30 text-[#00ff41] hover:bg-[#00ff41]/10 hover:text-[#00ff41] bg-transparent">
              ABORT
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetCompletionTime}
              className="font-mono bg-[#00ff41] text-[#0a0a0a] hover:bg-[#00ff41]/80"
            >
              EXECUTE RESET
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
    </div>
  );
}
