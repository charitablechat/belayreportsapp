import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isLovablePreview } from "@/lib/environment";
import {
  getUserWithCache,
  getSuperAdminStatusWithCache,
  getIsTrueSuperAdmin,
  getOfflineUserId,
  getAdminCacheKey,
  getTrueSuperAdminCacheKey,
} from "@/lib/cached-auth";

interface UseReportEditPermissionProps {
  inspectorId: string | undefined | null;
  reportType: 'inspection' | 'training' | 'daily_assessment';
}

interface ReportEditPermission {
  /** Whether the current user can edit this report */
  canEdit: boolean;
  /** Whether the report is in read-only mode */
  isReadOnly: boolean;
  /** Whether the current user is the report owner */
  isOwner: boolean;
  /** Whether the current user is a super admin (kale) */
  isSuperAdmin: boolean;
  /** Whether the current user is an admin (Josh/Brenda) */
  isAdmin: boolean;
  /** Loading state while checking permissions */
  isLoading: boolean;
  /** Reason for read-only mode (for UI display) */
  readOnlyReason: string | null;
}

/**
 * Hook to determine if the current user can edit a report.
 * 
 * Three-tier permission model:
 * - Super Admin (kale): can VIEW all reports, strictly read-only, invisible (no traces)
 * - Admin (Josh/Brenda): can VIEW and EDIT all reports
 * - Regular users: own reports only
 */
export function useReportEditPermission({ 
  inspectorId, 
  reportType 
}: UseReportEditPermissionProps): ReportEditPermission {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false); // is_admin_or_above (admin OR super_admin role)
  const [isTrueSuperAdmin, setIsTrueSuperAdmin] = useState(false); // is_super_admin (kale only)
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Synchronous fast-path: set userId from localStorage immediately
    const offlineId = getOfflineUserId();
    if (offlineId && !currentUserId) {
      setCurrentUserId(offlineId);
    }

    const checkPermissions = async () => {
      try {
        const user = await getUserWithCache();
        const userId = user?.id ?? getOfflineUserId();
        if (userId) {
          setCurrentUserId(userId);
        }

        if (user) {
          // Check both admin tiers in parallel
          const [adminStatus, trueSuperAdminStatus] = await Promise.all([
            getSuperAdminStatusWithCache(),
            getIsTrueSuperAdmin()
          ]);
          setIsAdmin(adminStatus);
          setIsTrueSuperAdmin(trueSuperAdminStatus);
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
      (_event, session) => {
        const newUserId = session?.user?.id;
        if (newUserId) {
          setCurrentUserId(newUserId);
        } else if (navigator.onLine) {
          setCurrentUserId(null);
        }

        if (session?.user) {
          // Fire and forget — do NOT await inside onAuthStateChange to avoid blocking the auth pipeline
          Promise.all([
            getSuperAdminStatusWithCache(),
            getIsTrueSuperAdmin()
          ]).then(([adminStatus, trueSuperAdminStatus]) => {
            setIsAdmin(adminStatus);
            setIsTrueSuperAdmin(trueSuperAdminStatus);
          }).catch(() => {});
        } else if (navigator.onLine) {
          const offlineId = getOfflineUserId();
          const cachedAdmin = offlineId
            ? localStorage.getItem(getAdminCacheKey(offlineId))
            : null;
          if (cachedAdmin !== 'true') {
            setIsAdmin(false);
          }
          const cachedTrueSA = offlineId
            ? localStorage.getItem(getTrueSuperAdminCacheKey(offlineId))
            : null;
          if (cachedTrueSA !== 'true') {
            setIsTrueSuperAdmin(false);
          }
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const permission = useMemo<ReportEditPermission>(() => {
    if (isLovablePreview()) {
      return {
        canEdit: false,
        isReadOnly: true,
        isOwner: false,
        isSuperAdmin: false,
        isAdmin: false,
        isLoading: false,
        readOnlyReason: 'Preview mode — read-only'
      };
    }

    const isOwner = currentUserId === inspectorId;
    
    // Fast path: owners can always edit
    if (inspectorId && currentUserId && isOwner) {
      return {
        canEdit: true,
        isReadOnly: false,
        isOwner: true,
        isSuperAdmin: isTrueSuperAdmin,
        isAdmin,
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
        isSuperAdmin: isTrueSuperAdmin,
        isAdmin,
        isLoading: isLoading || !currentUserId,
        readOnlyReason: isLoading ? 'Checking permissions...' : 'Report owner not determined'
      };
    }

    // Owner (redundant but kept for clarity)
    if (isOwner) {
      return {
        canEdit: true,
        isReadOnly: false,
        isOwner: true,
        isSuperAdmin: isTrueSuperAdmin,
        isAdmin,
        isLoading: false,
        readOnlyReason: null
      };
    }

    // True Super Admin (kale) viewing someone else's report — strictly read-only, invisible
    if (isTrueSuperAdmin) {
      return {
        canEdit: false,
        isReadOnly: true,
        isOwner: false,
        isSuperAdmin: true,
        isAdmin: true,
        isLoading: false,
        readOnlyReason: null
      };
    }

    // Admin (Josh/Brenda) viewing someone else's report — full edit access
    if (isAdmin) {
      return {
        canEdit: true,
        isReadOnly: false,
        isOwner: false,
        isSuperAdmin: false,
        isAdmin: true,
        isLoading: false,
        readOnlyReason: null
      };
    }

    // Non-owner, non-admin — no edit access
    return {
      canEdit: false,
      isReadOnly: true,
      isOwner: false,
      isSuperAdmin: false,
      isAdmin: false,
      isLoading: false,
      readOnlyReason: 'You do not have permission to edit this report'
    };
  }, [currentUserId, inspectorId, isAdmin, isTrueSuperAdmin, isLoading]);

  return permission;
}
