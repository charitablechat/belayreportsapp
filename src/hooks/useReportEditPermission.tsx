import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isLovablePreview } from "@/lib/environment";
import { getUserWithCache, getSuperAdminStatusWithCache, getOfflineUserId } from "@/lib/cached-auth";

interface UseReportEditPermissionProps {
  inspectorId: string | undefined | null;
  reportType: 'inspection' | 'training' | 'daily_assessment';
}

interface ReportEditPermission {
  /** Whether the current user can edit this report */
  canEdit: boolean;
  /** Whether the report is in read-only mode (Super Admin viewing someone else's report) */
  isReadOnly: boolean;
  /** Whether the current user is the report owner */
  isOwner: boolean;
  /** Whether the current user is a super admin */
  isSuperAdmin: boolean;
  /** Loading state while checking permissions */
  isLoading: boolean;
  /** Reason for read-only mode (for UI display) */
  readOnlyReason: string | null;
}

/**
 * Hook to determine if the current user can edit a report.
 * 
 * Rules:
 * - Report owners (inspector_id === current user) can always edit
 * - Super Admins can VIEW and EDIT all reports
 * - The inspector_id field is immutable once set
 * 
 * Data integrity is preserved through the immutable inspector_id field
 * and updated_at timestamps for audit trails.
 */
export function useReportEditPermission({ 
  inspectorId, 
  reportType 
}: UseReportEditPermissionProps): ReportEditPermission {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Synchronous fast-path: set userId from localStorage immediately
    // so effectiveReadOnly is false while async auth resolves
    const offlineId = getOfflineUserId();
    if (offlineId && !currentUserId) {
      setCurrentUserId(offlineId);
    }

    const checkPermissions = async () => {
      try {
        // Get current user
        const user = await getUserWithCache();
        const userId = user?.id ?? getOfflineUserId();
        // Only update if we actually got a userId - don't clear a known-good ID
        if (userId) {
          setCurrentUserId(userId);
        }

        if (user) {
          // Use cached super admin status for performance
          const superAdminStatus = await getSuperAdminStatusWithCache();
          setIsSuperAdmin(superAdminStatus);
        }
      } catch (error) {
        console.error('[useReportEditPermission] Error checking permissions:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkPermissions();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const newUserId = session?.user?.id;
        if (newUserId) {
          setCurrentUserId(newUserId);
        } else if (navigator.onLine) {
          // Only clear userId on explicit sign-out while online
          setCurrentUserId(null);
        }
        // If offline and session is null, retain existing userId

        if (session?.user) {
          const superAdminStatus = await getSuperAdminStatusWithCache();
          setIsSuperAdmin(superAdminStatus);
        } else if (navigator.onLine) {
          setIsSuperAdmin(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const permission = useMemo<ReportEditPermission>(() => {
    const isOwner = currentUserId === inspectorId;
    
    // Fast path: If we can determine ownership, enable editing immediately for owners
    // This avoids blocking on the super admin check which is only needed for non-owners
    if (inspectorId && currentUserId && isOwner) {
      return {
        canEdit: true,
        isReadOnly: false,
        isOwner: true,
        isSuperAdmin, // May still be loading, but irrelevant for owners
        isLoading: false,
        readOnlyReason: null
      };
    }

    // Still loading user identity - default to read-only for safety
    if (isLoading || !currentUserId || !inspectorId) {
      return {
        canEdit: false,
        isReadOnly: true,
        isOwner: false,
        isSuperAdmin,
        isLoading: isLoading || !currentUserId,
        readOnlyReason: isLoading ? 'Checking permissions...' : 'Report owner not determined'
      };
    }

    // Only owners can edit - Super Admins are view-only
    if (isOwner) {
      return {
        canEdit: true,
        isReadOnly: false,
        isOwner: true,
        isSuperAdmin,
        isLoading: false,
        readOnlyReason: null
      };
    }

    // Super Admin viewing someone else's report - read-only
    // Super Admin viewing someone else's report - full edit access
    if (isSuperAdmin) {
      return {
        canEdit: true,
        isReadOnly: false,
        isOwner: false,
        isSuperAdmin: true,
        isLoading: false,
        readOnlyReason: null
      };
    }

    // Non-owner, non-super-admin - should not have access via RLS
    // but if they somehow do, they cannot edit
    return {
      canEdit: false,
      isReadOnly: true,
      isOwner: false,
      isSuperAdmin: false,
      isLoading: false,
      readOnlyReason: 'You do not have permission to edit this report'
    };
  }, [currentUserId, inspectorId, isSuperAdmin, isLoading]);

  return permission;
}
