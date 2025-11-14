import { useRequireSuperAdmin } from "@/hooks/useRequireSuperAdmin";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/admin/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Building2, Users, FileText, Bell, AlertTriangle, Radio, UserPlus, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";
import { UserManagementDialog } from "@/components/admin/UserManagementDialog";

export default function SuperAdminDashboard() {
  const { loading } = useRequireSuperAdmin();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<any>(null);

  // Overview stats queries
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [
        { count: orgsCount },
        { count: usersCount },
        { count: inspectionsCount },
        { data: inspectionsByStatus },
        { count: notificationsCount },
        { count: conflictsCount },
        { count: subscriptionsCount },
      ] = await Promise.all([
        supabase.from("organizations").select("*", { count: "exact", head: true }),
        supabase.from("organization_members").select("user_id", { count: "exact", head: true }),
        supabase.from("inspections").select("*", { count: "exact", head: true }),
        supabase.from("inspections").select("status"),
        supabase.from("notifications_log").select("*", { count: "exact", head: true }).gte("sent_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from("sync_conflicts").select("*", { count: "exact", head: true }).eq("resolved", false),
        supabase.from("push_subscriptions").select("*", { count: "exact", head: true }),
      ]);

      const statusCounts = inspectionsByStatus?.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        organizations: orgsCount || 0,
        users: usersCount || 0,
        inspections: inspectionsCount || 0,
        statusCounts: statusCounts || {},
        recentNotifications: notificationsCount || 0,
        unresolvedConflicts: conflictsCount || 0,
        activeSubscriptions: subscriptionsCount || 0,
      };
    },
    enabled: !loading,
  });

  // Organizations query
  const { data: organizations } = useQuery({
    queryKey: ["admin-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select(`
          *,
          organization_members(count),
          inspections(count)
        `)
        .order("created_at", { ascending: false });

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
          organizations(name)
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

  // Sync conflicts query
  const { data: conflicts } = useQuery({
    queryKey: ["admin-conflicts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_conflicts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get organization names
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name");

      // Combine the data
      const combined = data?.map(conflict => {
        const org = orgs?.find(o => o.id === conflict.organization_id);
        return {
          ...conflict,
          organization_name: org?.name || "Unknown",
        };
      });

      return combined;
    },
    enabled: !loading,
  });

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

  // Managed users query
  const { data: managedUsers, refetch: refetchUsers } = useQuery({
    queryKey: ["admin-managed-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data.users;
    },
    enabled: !loading,
  });

  // User management functions
  const handleCreateUser = async (userData: any) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: { 
          action: 'create',
          ...userData
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success('User created successfully');
      refetchUsers();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error: any) {
      console.error('Error creating user:', error);
      toast.error(error.message || 'Failed to create user');
      throw error;
    }
  };

  const handleUpdateUser = async (userData: any) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', {
        body: { 
          action: 'update',
          userId: selectedUser.id,
          ...userData
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success('User updated successfully');
      refetchUsers();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (error: any) {
      console.error('Error updating user:', error);
      toast.error(error.message || 'Failed to update user');
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
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast.error(error.message || 'Failed to delete user');
    }
  };

  const handleEditClick = (user: any) => {
    setSelectedUser(user);
    setDialogMode('edit');
    setDialogOpen(true);
  };

  const handleDeleteClick = (user: any) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Super Admin Dashboard</h1>
        <p className="text-muted-foreground">Manage all organizations, users, and inspections</p>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Organizations"
          value={stats?.organizations || 0}
          icon={Building2}
        />
        <StatCard
          title="Total Users"
          value={stats?.users || 0}
          icon={Users}
        />
        <StatCard
          title="Inspections"
          value={stats?.inspections || 0}
          icon={FileText}
          description={`${stats?.statusCounts?.completed || 0} completed, ${stats?.statusCounts?.draft || 0} draft`}
        />
        <StatCard
          title="Recent Notifications"
          value={stats?.recentNotifications || 0}
          icon={Bell}
          description="Last 7 days"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          title="Unresolved Conflicts"
          value={stats?.unresolvedConflicts || 0}
          icon={AlertTriangle}
        />
        <StatCard
          title="Active Subscriptions"
          value={stats?.activeSubscriptions || 0}
          icon={Radio}
        />
      </div>

      {/* Tabs for different sections */}
      <Tabs defaultValue="organizations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="user-management">User Management</TabsTrigger>
          <TabsTrigger value="inspections">Inspections</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="conflicts">Conflicts</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
        </TabsList>

        <TabsContent value="organizations" className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Inspections</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations?.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell>{org.organization_members?.[0]?.count || 0}</TableCell>
                  <TableCell>{org.inspections?.[0]?.count || 0}</TableCell>
                  <TableCell>{format(new Date(org.created_at), "PP")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersWithRoles?.map((user) => (
                <TableRow key={`${user.user_id}-${user.organization_id}`}>
                  <TableCell className="font-mono text-xs">{user.user_id.slice(0, 8)}...</TableCell>
                  <TableCell>{user.organizations?.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{user.role}</Badge>
                  </TableCell>
                  <TableCell>{format(new Date(user.created_at), "PP")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Last Sign In</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managedUsers?.map((user: any) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>{user.firstName} {user.lastName}</TableCell>
                  <TableCell>
                    {user.organizations?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.organizations.map((org: any, idx: number) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {org.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">No organizations</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.roles?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r: any, idx: number) => (
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
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="inspections" className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Created</TableHead>
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
                    <Badge variant={inspection.status === "completed" ? "default" : "secondary"}>
                      {inspection.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{format(new Date(inspection.inspection_date), "PP")}</TableCell>
                  <TableCell>{format(new Date(inspection.created_at), "PP")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
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
        </TabsContent>

        <TabsContent value="conflicts" className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Inspection ID</TableHead>
                <TableHead>Local Update</TableHead>
                <TableHead>Remote Update</TableHead>
                <TableHead>Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conflicts?.map((conflict) => (
                <TableRow key={conflict.id}>
                  <TableCell>{conflict.organization_name}</TableCell>
                  <TableCell className="font-mono text-xs">{conflict.inspection_id.slice(0, 8)}...</TableCell>
                  <TableCell>{format(new Date(conflict.local_updated_at), "PPp")}</TableCell>
                  <TableCell>{format(new Date(conflict.remote_updated_at), "PPp")}</TableCell>
                  <TableCell>
                    <Badge variant={conflict.resolved ? "default" : "destructive"}>
                      {conflict.resolved ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="subscriptions" className="space-y-4">
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
        </TabsContent>
      </Tabs>

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
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the user account for <strong>{userToDelete?.email}</strong>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
