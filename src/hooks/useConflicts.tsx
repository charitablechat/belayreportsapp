import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SyncConflict {
  id: string;
  inspection_id: string;
  organization_id: string;
  local_updated_at: string;
  remote_updated_at: string;
  resolved: boolean;
  created_at: string;
}

export const useConflicts = () => {
  const queryClient = useQueryClient();

  // Fetch unresolved conflicts
  const { data: conflicts = [], isLoading } = useQuery({
    queryKey: ['sync-conflicts'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sync_conflicts')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as SyncConflict[];
    },
    enabled: navigator.onLine,
    refetchInterval: 30000, // Check every 30 seconds
  });

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
    onError: (error: any) => {
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
    onError: (error: any) => {
      console.error('Failed to resolve conflict:', error);
      toast.error('Failed to resolve conflict');
    },
  });

  return {
    conflicts,
    isLoading,
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length,
    resolveWithLocal: resolveWithLocal.mutate,
    resolveWithRemote: resolveWithRemote.mutate,
    isResolving: resolveWithLocal.isPending || resolveWithRemote.isPending,
  };
};
