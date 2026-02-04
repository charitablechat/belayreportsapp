import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache } from '@/lib/cached-auth';
import { useEffect } from 'react';

export interface SyncConflict {
  id: string;
  inspection_id: string;
  organization_id: string;
  local_updated_at: string;
  remote_updated_at: string;
  resolved: boolean;
  created_at: string;
  inspection?: {
    organization: string;
    location: string;
    status: string;
    synced_at: string | null;
  } | null;
}

export type AutoResolveStrategy = 'last-write-wins';

export const useConflicts = () => {
  const queryClient = useQueryClient();
  
  // Always use last-write-wins strategy for all users
  const autoResolveStrategy: AutoResolveStrategy = 'last-write-wins';

  // Fetch unresolved conflicts with inspection details
  const { data: conflicts = [], isLoading, refetch } = useQuery({
    queryKey: ['sync-conflicts'],
    queryFn: async () => {
      const user = await getUserWithCache();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sync_conflicts')
        .select(`
          *,
          inspection:inspections(organization, location, status, synced_at)
        `)
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      return (data as SyncConflict[]) || [];
    },
    enabled: typeof navigator !== 'undefined' && navigator.onLine,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchInterval: 60000,
  });

  // Mutation for auto-resolving stale conflicts
  const autoResolveMutation = useMutation({
    mutationFn: async (staleConflictIds: string[]) => {
      if (staleConflictIds.length === 0) return;
      
      const { error } = await supabase
        .from('sync_conflicts')
        .update({ resolved: true })
        .in('id', staleConflictIds);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-conflicts'] });
    },
  });

  // Auto-resolve stale conflicts after data is fetched
  useEffect(() => {
    if (!conflicts || conflicts.length === 0) return;
    
    const staleConflictIds: string[] = [];
    const now = Date.now();
    
    for (const conflict of conflicts) {
      // Auto-resolve if:
      // 1. Inspection was synced after conflict was created
      // 2. Conflict is older than 24 hours (stale cleanup)
      // 3. Inspection no longer exists (orphaned conflict)
      
      if (conflict.inspection?.synced_at) {
        const syncedAt = new Date(conflict.inspection.synced_at).getTime();
        const conflictCreatedAt = new Date(conflict.created_at).getTime();
        
        if (syncedAt > conflictCreatedAt) {
          staleConflictIds.push(conflict.id);
          continue;
        }
      }
      
      // Auto-resolve conflicts older than 24 hours as stale
      const conflictAge = now - new Date(conflict.created_at).getTime();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      if (conflictAge > twentyFourHours) {
        staleConflictIds.push(conflict.id);
        continue;
      }
      
      // Auto-resolve orphaned conflicts (inspection no longer exists)
      if (!conflict.inspection) {
        staleConflictIds.push(conflict.id);
      }
    }
    
    if (staleConflictIds.length > 0) {
      autoResolveMutation.mutate(staleConflictIds);
    }
  }, [conflicts]);

  // Filter out stale conflicts
  const validConflicts = conflicts.filter(conflict => {
    if (!conflict.inspection?.synced_at) return true;
    const syncedAt = new Date(conflict.inspection.synced_at).getTime();
    const conflictCreatedAt = new Date(conflict.created_at).getTime();
    return syncedAt <= conflictCreatedAt;
  });

  // Auto-resolve conflicts using last-write-wins strategy
  const autoResolveConflicts = useMutation({
    mutationFn: async (conflictsToResolve: SyncConflict[]) => {
      for (const conflict of conflictsToResolve) {
        const localTime = new Date(conflict.local_updated_at).getTime();
        const remoteTime = new Date(conflict.remote_updated_at).getTime();
        
        // Last-write-wins: most recent change wins
        const useLocal = localTime > remoteTime;
        
        if (useLocal) {
          // Apply local version
          const { data: localInspection } = await supabase
            .from('inspections')
            .select('*')
            .eq('id', conflict.inspection_id)
            .single();
          
          if (localInspection) {
            await supabase
              .from('inspections')
              .update({
                ...localInspection,
                updated_at: new Date().toISOString(),
                synced_at: new Date().toISOString(),
              })
              .eq('id', conflict.inspection_id);
          }
        }
        
        // Mark conflict as resolved
        await supabase
          .from('sync_conflicts')
          .update({ resolved: true })
          .eq('id', conflict.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-conflicts'] });
    },
    onError: (error: Error) => {
      console.error('Failed to auto-resolve conflicts:', error);
    },
  });

  // Automatically resolve all conflicts when they exist
  useEffect(() => {
    if (validConflicts.length > 0 && !autoResolveConflicts.isPending) {
      autoResolveConflicts.mutate(validConflicts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validConflicts.length, autoResolveConflicts.isPending]);

  return {
    conflicts: validConflicts,
    isLoading,
    refetch,
    isResolving: autoResolveConflicts.isPending,
  };
};
