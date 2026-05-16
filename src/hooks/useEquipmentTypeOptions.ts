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

      // 2. If online, fetch from Supabase and merge
      if (isOnline) {
        try {
          const { data, error } = await supabase
            .from("equipment_type_options")
            .select("id, equipment_category, label, display_order, is_active")
            .eq("equipment_category", category)
            .eq("is_active", true)
            .order("display_order", { ascending: true });

          if (!error && data) {
            // Cache to IndexedDB for offline use
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
            
            // Merge in any existing values from the current report
            const lowerSet = new Set(labels.map((l: string) => l.toLowerCase()));
            for (const val of existingValues) {
              const trimmed = val.trim();
              if (trimmed && !lowerSet.has(trimmed.toLowerCase())) {
                labels.push(trimmed);
                lowerSet.add(trimmed.toLowerCase());
              }
            }
            
            return labels;
          }
        } catch (e) {
          console.warn("[useEquipmentTypeOptions] Fetch failed, using cache:", e);
        }
      }

      // Return cached labels
      const cachedLabels = cached.map((c) => c.label);
      
      // Merge in any existing values from the current report that aren't in the list
      const lowerSet = new Set(cachedLabels.map((l) => l.toLowerCase()));
      for (const val of existingValues) {
        const trimmed = val.trim();
        if (trimmed && !lowerSet.has(trimmed.toLowerCase())) {
          cachedLabels.push(trimmed);
          lowerSet.add(trimmed.toLowerCase());
        }
      }
      
      return cachedLabels;
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

  const addOption = useCallback(
    (label: string) => addOptionMutation.mutate(label),
    [addOptionMutation]
  );

  return { options, isLoading, addOption };
}
