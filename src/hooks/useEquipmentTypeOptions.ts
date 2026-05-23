import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import {
  getEquipmentTypeOptions,
  putEquipmentTypeOption,
  bulkPutEquipmentTypeOptions,
} from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useCallback, useRef } from "react";

interface EquipmentTypeOption {
  id: string;
  equipment_category: string;
  label: string;
  display_order: number;
  is_active: boolean;
}

export function useEquipmentTypeOptions(category: string, existingValues: string[] = []) {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  const { data: options = [], isLoading } = useQuery({
    queryKey: ["equipment-type-options", category],
    queryFn: async () => {
      // 1. Read from IndexedDB first for instant offline access
      const cached = await getEquipmentTypeOptions(category);
      const cachedLabels = cached.map((c) => c.label);

      // 2. If online, fetch from Supabase and merge
      if (isOnline) {
        try {
          const { data, error } = await supabase
            .from("equipment_type_options")
            .select("id, equipment_category, label, display_order, is_active")
            .eq("equipment_category", category)
            .eq("is_active", true)
            .order("display_order", { ascending: true });

          // CRITICAL: only adopt the Supabase response when it actually has
          // rows. An empty array (RLS denial under a synthetic offline JWT,
          // transient empty response, partial outage, etc.) must NOT wipe
          // an already-populated IDB cache — that produced the empty
          // "No entries found" dropdown on Lanyards / Connectors even
          // though 66+/133+ options exist on the server. Symmetrically,
          // never overwrite the cache with empty entries for the same
          // reason.
          if (!error && data && data.length > 0) {
            const entries = data.map((d: EquipmentTypeOption) => ({
              id: `${d.equipment_category}::${d.label}`,
              equipment_category: d.equipment_category,
              label: d.label,
              display_order: d.display_order,
              is_active: d.is_active,
              synced: true,
            }));
            await bulkPutEquipmentTypeOptions(entries);

            const labels = data.map((d: EquipmentTypeOption) => d.label);
            return mergeExisting(labels, existingValues);
          }
        } catch (e) {
          console.warn("[useEquipmentTypeOptions] Fetch failed, using cache:", e);
        }
      }

      // Offline, fetch failed, or Supabase returned 0 rows → fall back to
      // the IDB cache so the dropdown still shows preloaded options.
      return mergeExisting(cachedLabels, existingValues);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const addOptionMutation = useMutation({
    mutationFn: async (label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;

      // Check if already exists locally
      if (options.some((o) => o.toLowerCase() === trimmed.toLowerCase())) return;

      const cacheEntry = {
        id: `${category}::${trimmed}`,
        equipment_category: category,
        label: trimmed,
        display_order: options.length + 1,
        is_active: true,
        synced: false,
      };

      // 1. Write to IndexedDB immediately (works offline)
      await putEquipmentTypeOption(cacheEntry);

      // 2. Try to write to Supabase
      if (isOnline) {
        try {
          const user = await getUserWithCache();
          const { error } = await supabase
            .from("equipment_type_options")
            .insert({
              equipment_category: category,
              label: trimmed,
              display_order: options.length + 1,
              created_by: user?.id || null,
            });

          if (error) {
            // Unique constraint violation means it already exists — that's fine
            if (!error.message?.includes("duplicate") && !error.code?.includes("23505")) {
              console.error("[useEquipmentTypeOptions] Insert error:", error);
            }
          } else {
            // Mark as synced
            cacheEntry.synced = true;
            await putEquipmentTypeOption(cacheEntry);
          }
        } catch (e) {
          console.warn("[useEquipmentTypeOptions] Insert failed, saved offline:", e);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment-type-options", category] });
    },
  });

  // Phase 2 perf: stable identity. `addOptionMutation` has a new
  // reference every render, so `useCallback([addOptionMutation])` was
  // effectively unstable and broke React.memo on EquipmentTable (8
  // instances re-rendering on every InspectionForm tick). Route calls
  // through a ref that always points at the latest mutate function.
  const mutateRef = useRef(addOptionMutation.mutate);
  mutateRef.current = addOptionMutation.mutate;
  const addOption = useCallback((label: string) => {
    mutateRef.current(label);
  }, []);

  return { options, isLoading, addOption };
}
