import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import {
  getEquipmentTypeOptions,
  putEquipmentTypeOption,
  bulkPutEquipmentTypeOptions,
  deleteEquipmentTypeOption,
} from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useCallback } from "react";

interface EquipmentTypeOption {
  id: string;
  equipment_category: string;
  label: string;
  display_order: number;
  is_active: boolean;
}

export function useEquipmentTypeOptions(category: string) {
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

            return data.map((d: EquipmentTypeOption) => d.label);
          }
        } catch (e) {
          console.warn("[useEquipmentTypeOptions] Fetch failed, using cache:", e);
        }
      }

      // Return cached labels
      return cached.map((c) => c.label);
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

  const deleteOptionMutation = useMutation({
    mutationFn: async (label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;

      // 1. Remove from IndexedDB immediately (optimistic)
      await deleteEquipmentTypeOption(category, trimmed);

      // 2. If online, soft-delete in Supabase (set is_active = false)
      if (isOnline) {
        try {
          const { error } = await supabase
            .from("equipment_type_options")
            .update({ is_active: false })
            .eq("equipment_category", category)
            .ilike("label", trimmed);

          if (error) {
            console.error("[useEquipmentTypeOptions] Delete error:", error);
          }
        } catch (e) {
          console.warn("[useEquipmentTypeOptions] Delete failed, removed locally:", e);
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

  const deleteOption = useCallback(
    (label: string) => deleteOptionMutation.mutate(label),
    [deleteOptionMutation]
  );

  return { options, isLoading, addOption, deleteOption };
}
