import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useEffect, useCallback, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

// Storage key for auto-resolve preference
const AUTO_RESOLVE_KEY = 'sync_auto_resolve_strategy';

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

export type AutoResolveStrategy = 'manual' | 'last-write-wins' | 'local-wins' | 'remote-wins';

export const useConflicts = () => {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  
  // Auto-resolve strategy state - default to 'last-write-wins' on mobile
  const [autoResolveStrategy, setAutoResolveStrategyState] = useState<AutoResolveStrategy>(() => {
    // On mobile, always default to last-write-wins for seamless experience
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return 'last-write-wins';
    }
    const stored = localStorage.getItem(AUTO_RESOLVE_KEY);
    return (stored as AutoResolveStrategy) || 'manual';
  });
  
  // Update strategy when mobile state changes
  useEffect(() => {
    if (isMobile) {
      setAutoResolveStrategyState('last-write-wins');
    }
  }, [isMobile]);
  
  // Persist strategy changes (only for non-mobile)
  const setAutoResolveStrategy = useCallback((strategy: AutoResolveStrategy) => {
    if (!isMobile) {
      localStorage.setItem(AUTO_RESOLVE_KEY, strategy);
    }
    setAutoResolveStrategyState(strategy);
  }, [isMobile]);

  // Fetch unresolved conflicts with inspection details
  const { data: conflicts = [], isLoading, refetch } = useQuery({
    queryKey: ['sync-conflicts'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
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
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnWindowFocus: false,
    refetchInterval: 60000, // Check every 60 seconds instead of 30
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
  // PREVENTIVE MEASURE: Aggressively clean up conflicts that are no longer relevant
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
        
        // If inspection synced after conflict was created, mark for auto-resolve
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

  // Filter out stale conflicts from UI (they'll be resolved in background)
  const validConflicts = conflicts.filter(conflict => {
    if (!conflict.inspection?.synced_at) return true;
    const syncedAt = new Date(conflict.inspection.synced_at).getTime();
    const conflictCreatedAt = new Date(conflict.created_at).getTime();
    return syncedAt <= conflictCreatedAt;
  });

  // Auto-resolve conflicts based on strategy
  const autoResolveConflicts = useMutation({
    mutationFn: async (conflictsToResolve: SyncConflict[]) => {
      for (const conflict of conflictsToResolve) {
        const localTime = new Date(conflict.local_updated_at).getTime();
        const remoteTime = new Date(conflict.remote_updated_at).getTime();
        
        let useLocal = false;
        
        if (autoResolveStrategy === 'last-write-wins') {
          // Most recent change wins
          useLocal = localTime > remoteTime;
        } else if (autoResolveStrategy === 'local-wins') {
          useLocal = true;
        } else if (autoResolveStrategy === 'remote-wins') {
          useLocal = false;
        }
        
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sync-conflicts'] });
      const strategyLabel = autoResolveStrategy === 'last-write-wins' 
        ? 'last-write-wins' 
        : autoResolveStrategy === 'local-wins' 
          ? 'local version' 
          : 'remote version';
      toast.success(`${variables.length} conflict${variables.length > 1 ? 's' : ''} auto-resolved using ${strategyLabel}`);
    },
    onError: (error: Error) => {
      console.error('Failed to auto-resolve conflicts:', error);
      toast.error('Failed to auto-resolve conflicts');
    },
  });

  // Trigger auto-resolution when strategy is not manual and conflicts exist
  useEffect(() => {
    if (autoResolveStrategy !== 'manual' && validConflicts.length > 0 && !autoResolveConflicts.isPending) {
      autoResolveConflicts.mutate(validConflicts);
    }
  }, [autoResolveStrategy, validConflicts.length]);

  // Resolve conflict by choosing local version
  const resolveWithLocal = useMutation({
    mutationFn: async ({ conflictId, inspectionId }: { conflictId: string; inspectionId: string }) => {
      const { data: localInspection } = await supabase
        .from('inspections')
        .select('*')
        .eq('id', inspectionId)
        .single();

      if (!localInspection) throw new Error('Local inspection not found');

      // Update with local version
      const { error: updateError } = await supabase
        .from('inspections')
        .update({
          ...localInspection,
          updated_at: new Date().toISOString(),
          synced_at: new Date().toISOString(),
        })
        .eq('id', inspectionId);

      if (updateError) throw updateError;

      // Mark conflict as resolved
      const { error: resolveError } = await supabase
        .from('sync_conflicts')
        .update({ resolved: true })
        .eq('id', conflictId);

      if (resolveError) throw resolveError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-conflicts'] });
      toast.success('Conflict resolved with local version');
    },
    onError: (error: Error) => {
      console.error('Failed to resolve conflict:', error);
      toast.error('Failed to resolve conflict');
    },
  });

  // Resolve conflict by choosing remote version
  const resolveWithRemote = useMutation({
    mutationFn: async ({ conflictId, inspectionId }: { conflictId: string; inspectionId: string }) => {
      // Fetch latest remote version
      const { data: remoteInspection, error: fetchError } = await supabase
        .from('inspections')
        .select('*')
        .eq('id', inspectionId)
        .single();

      if (fetchError) throw fetchError;
      if (!remoteInspection) throw new Error('Remote inspection not found');

      // Mark conflict as resolved (remote is already the current version)
      const { error: resolveError } = await supabase
        .from('sync_conflicts')
        .update({ resolved: true })
        .eq('id', conflictId);

      if (resolveError) throw resolveError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-conflicts'] });
      toast.success('Conflict resolved with remote version');
    },
    onError: (error: Error) => {
      console.error('Failed to resolve conflict:', error);
      toast.error('Failed to resolve conflict');
    },
  });

  // Resolve all conflicts with the current strategy
  const resolveAllWithStrategy = useCallback(() => {
    if (validConflicts.length > 0 && autoResolveStrategy !== 'manual') {
      autoResolveConflicts.mutate(validConflicts);
    }
  }, [validConflicts, autoResolveStrategy]);

  return {
    conflicts: validConflicts,
    isLoading,
    hasConflicts: validConflicts.length > 0,
    conflictCount: validConflicts.length,
    resolveWithLocal: resolveWithLocal.mutate,
    resolveWithRemote: resolveWithRemote.mutate,
    isResolving: resolveWithLocal.isPending || resolveWithRemote.isPending || autoResolveConflicts.isPending,
    refetch,
    autoResolveStrategy,
    setAutoResolveStrategy,
    resolveAllWithStrategy,
  };
};
