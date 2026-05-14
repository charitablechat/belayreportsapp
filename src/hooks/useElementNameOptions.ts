import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import {
  getEquipmentTypeOptions,
  putEquipmentTypeOption,
  bulkPutEquipmentTypeOptions,
} from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useCallback } from "react";

const CATEGORY = "operating_system_elements";

export const DEFAULT_ELEMENT_NAMES = [
  "Tower",
  "Two Line Bridge",
  "Base Station",
  "Signal Repeater",
  "Power Module",
];

export function useElementNameOptions(existingValues: string[] = []) {
  const queryClient = useQueryClient();
  const { isOnline } = useNetworkStatus();

  const { data: options = [], isLoading } = useQuery({
    queryKey: ["equipment-type-options", CATEGORY],
    queryFn: async () => {
      const cached = await getEquipmentTypeOptions(CATEGORY);

      if (isOnline) {
        try {
          const { data, error } = await supabase
            .from("equipment_type_options")
            .select("id, equipment_category, label, display_order, is_active")
            .eq("equipment_category", CATEGORY)
            .eq("is_active", true)
            .order("display_order", { ascending: true });

          if (!error && data && data.length > 0) {
            const entries = data.map((d) => ({
              id: `${d.equipment_category}::${d.label}`,
              equipment_category: d.equipment_category,
              label: d.label,
              display_order: d.display_order,
              is_active: d.is_active,
              synced: true,
            }));
            await bulkPutEquipmentTypeOptions(entries);

            const labels = data.map((d) => d.label);
            return mergeExisting(labels, existingValues);
          }

          // No server data yet — seed defaults
          if (!error && data && data.length === 0) {
            await seedDefaults();
            return mergeExisting([...DEFAULT_ELEMENT_NAMES], existingValues);
          }
        } catch (e) {
          console.warn("[useElementNameOptions] Fetch failed, using cache:", e);
        }
      }

      if (cached.length > 0) {
        return mergeExisting(cached.map((c) => c.label), existingValues);
      }

      // Fallback to defaults
      return mergeExisting([...DEFAULT_ELEMENT_NAMES], existingValues);
    },
    staleTime: 5 * 60 * 1000,
  });

  const seedDefaults = async () => {
    try {
      const user = await getUserWithCache();
      const inserts = DEFAULT_ELEMENT_NAMES.map((label, i) => ({
        equipment_category: CATEGORY,
        label,
        display_order: i + 1,
        created_by: user?.id || null,
      }));
      await supabase.from("equipment_type_options").insert(inserts);

      const cacheEntries = DEFAULT_ELEMENT_NAMES.map((label, i) => ({
        id: `${CATEGORY}::${label}`,
        equipment_category: CATEGORY,
        label,
        display_order: i + 1,
        is_active: true,
        synced: true,
      }));
      await bulkPutEquipmentTypeOptions(cacheEntries);
    } catch (e) {
      console.warn("[useElementNameOptions] Seed failed:", e);
    }
  };

  const addOptionMutation = useMutation({
    mutationFn: async (label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      if (options.some((o) => o.toLowerCase() === trimmed.toLowerCase())) return;

      const cacheEntry = {
        id: `${CATEGORY}::${trimmed}`,
        equipment_category: CATEGORY,
        label: trimmed,
        display_order: options.length + 1,
        is_active: true,
        synced: false,
      };

      await putEquipmentTypeOption(cacheEntry);

      if (isOnline) {
        try {
          const user = await getUserWithCache();
          const { error } = await supabase
            .from("equipment_type_options")
            .insert({
              equipment_category: CATEGORY,
              label: trimmed,
              display_order: options.length + 1,
              created_by: user?.id || null,
            });

          if (error && !error.message?.includes("duplicate") && !error.code?.includes("23505")) {
            console.error("[useElementNameOptions] Insert error:", error);
          } else if (!error) {
            cacheEntry.synced = true;
            await putEquipmentTypeOption(cacheEntry);
          }
        } catch (e) {
          console.warn("[useElementNameOptions] Insert failed, saved offline:", e);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment-type-options", CATEGORY] });
    },
  });

  const addOption = useCallback(
    (label: string) => addOptionMutation.mutate(label),
    [addOptionMutation]
  );

  return { options, isLoading, addOption };
}

function mergeExisting(labels: string[], existingValues: string[]): string[] {
  const lowerSet = new Set(labels.map((l) => l.toLowerCase()));
  for (const val of existingValues) {
    const trimmed = val?.trim();
    if (trimmed && !lowerSet.has(trimmed.toLowerCase())) {
      labels.push(trimmed);
      lowerSet.add(trimmed.toLowerCase());
    }
  }
  return labels;
}
