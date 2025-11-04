import { supabase } from "@/integrations/supabase/client";
import { getUnsyncedInspections, saveInspectionOffline } from "./offline-storage";
import { toast } from "sonner";

export async function syncInspections() {
  if (!navigator.onLine) {
    console.log("Offline - skipping sync");
    return;
  }

  try {
    const unsynced = await getUnsyncedInspections();
    
    for (const inspection of unsynced) {
      // Sync to Supabase
      const { error } = await supabase
        .from("inspections")
        .upsert({
          ...inspection,
          synced_at: new Date().toISOString(),
        });

      if (error) throw error;

      // Update local storage
      await saveInspectionOffline({
        ...inspection,
        synced_at: new Date().toISOString(),
      });
    }

    if (unsynced.length > 0) {
      toast.success(`Synced ${unsynced.length} inspection(s)`);
    }
  } catch (error) {
    console.error("Sync error:", error);
    toast.error("Failed to sync inspections");
  }
}

// Auto-sync when coming online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    setTimeout(syncInspections, 1000);
  });
}
