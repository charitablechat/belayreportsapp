import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, CheckCircle, Loader2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import InspectionHeader from "@/components/inspection/InspectionHeader";
import OperatingSystemsTable from "@/components/inspection/OperatingSystemsTable";
import ZiplinesTable from "@/components/inspection/ZiplinesTable";
import EquipmentTable from "@/components/inspection/EquipmentTable";
import StandardsTable from "@/components/inspection/StandardsTable";
import SummarySection from "@/components/inspection/SummarySection";
import { saveInspectionOffline, getOfflineInspection, queueOperation } from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";

export default function InspectionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [inspection, setInspection] = useState<any>(null);
  const [systems, setSystems] = useState<any[]>([]);
  const [ziplines, setZiplines] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [standards, setStandards] = useState<any[]>([
    { standard_name: "Local Written Operations Procedures", has_documentation: false },
    { standard_name: "Local Written Emergency Action Plan", has_documentation: false },
    { standard_name: "Minimum Annual Training", has_documentation: false },
    { standard_name: "Written Pre-Use Inspection in Use", has_documentation: false },
    { standard_name: "Inventory Tracking System in Use", has_documentation: false },
    { standard_name: "Operational Review Every 5 Years", has_documentation: false },
  ]);
  const [summary, setSummary] = useState({
    repairs_performed: "",
    critical_actions: "",
    future_considerations: "",
    next_inspection_date: "",
  });

  useEffect(() => {
    loadInspection();
  }, [id]);

  // Track changes to inspection data
  useEffect(() => {
    if (!loading) {
      setHasUnsavedChanges(true);
    }
  }, [systems, ziplines, equipment, standards, summary]);

  // Auto-save interval (every 2 minutes)
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      autoSaveProgress();
    }, 120000); // 2 minutes = 120,000 ms

    return () => clearInterval(autoSaveInterval);
  }, [hasUnsavedChanges, saving, autoSaving]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const loadInspection = async () => {
    try {
      // Try offline first
      const offlineData = await getOfflineInspection(id!);
      
      if (offlineData) {
        setInspection(offlineData);
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Loaded from offline storage');
        }
      }

      // If online, fetch from Supabase and update local cache
      if (isOnline) {
        const { data, error } = await supabase
          .from("inspections")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (error) throw error;
        
        if (data) {
          setInspection(data);
          await saveInspectionOffline(data);
          
          if (import.meta.env.DEV) {
            console.log('[InspectionForm] Loaded from Supabase and cached');
          }
        }
      } else if (!offlineData) {
        throw new Error("No offline data available");
      }

      const { data: systemsData } = await supabase
        .from("inspection_systems")
        .select("*")
        .eq("inspection_id", id);
      if (systemsData) setSystems(systemsData);

      const { data: ziplinesData } = await supabase
        .from("inspection_ziplines")
        .select("*")
        .eq("inspection_id", id);
      if (ziplinesData) setZiplines(ziplinesData);

      const { data: equipmentData } = await supabase
        .from("inspection_equipment")
        .select("*")
        .eq("inspection_id", id);
      if (equipmentData) setEquipment(equipmentData);

      const { data: standardsData } = await supabase
        .from("inspection_standards")
        .select("*")
        .eq("inspection_id", id);
      if (standardsData && standardsData.length > 0) {
        setStandards(standardsData);
      }

      const { data: summaryData } = await supabase
        .from("inspection_summary")
        .select("*")
        .eq("inspection_id", id)
        .single();
      if (summaryData) setSummary(summaryData);
    } catch (error: any) {
      console.error("Error loading inspection:", error);
      toast.error("Failed to load inspection");
    } finally {
      setLoading(false);
    }
  };

  const performSave = async () => {
    const saveData = {
      systems,
      ziplines,
      equipment,
      standards,
      summary,
      updated_at: new Date().toISOString(),
    };

    // Always save to offline storage first
    await saveInspectionOffline({
      ...inspection,
      ...saveData,
    });

    if (import.meta.env.DEV) {
      console.log('[InspectionForm] Saved to offline storage');
    }

    // If online, sync to Supabase
    if (isOnline) {
      try {
        // Save systems
        for (const system of systems) {
          if (system.id) {
            await supabase
              .from("inspection_systems")
              .update(system)
              .eq("id", system.id);
          } else {
            await supabase
              .from("inspection_systems")
              .insert({ ...system, inspection_id: id });
          }
        }

    // Save ziplines
    for (const zipline of ziplines) {
      if (zipline.id) {
        await supabase
          .from("inspection_ziplines")
          .update(zipline)
          .eq("id", zipline.id);
      } else {
        await supabase
          .from("inspection_ziplines")
          .insert({ ...zipline, inspection_id: id });
      }
    }

    // Save equipment
    for (const item of equipment) {
      if (item.id) {
        await supabase
          .from("inspection_equipment")
          .update(item)
          .eq("id", item.id);
      } else {
        await supabase
          .from("inspection_equipment")
          .insert({ ...item, inspection_id: id });
      }
    }

    // Save standards
    await supabase.from("inspection_standards").delete().eq("inspection_id", id);
    await supabase.from("inspection_standards").insert(
      standards.map((s) => ({ ...s, inspection_id: id }))
    );

        // Save or update summary
        const { data: existingSummary } = await supabase
          .from("inspection_summary")
          .select("id")
          .eq("inspection_id", id)
          .maybeSingle();

        if (existingSummary) {
          await supabase
            .from("inspection_summary")
            .update(summary)
            .eq("inspection_id", id);
        } else {
          await supabase
            .from("inspection_summary")
            .insert({ ...summary, inspection_id: id });
        }

        // Mark as synced
        await saveInspectionOffline({
          ...inspection,
          ...saveData,
          synced_at: new Date().toISOString(),
        });

        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Synced to Supabase');
        }
      } catch (error) {
        console.error('[InspectionForm] Failed to sync to Supabase:', error);
        // Queue for later sync
        await queueOperation('update', id!, saveData);
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Queued for later sync');
        }
      }
    } else {
      // Queue operation when offline
      await queueOperation('update', id!, saveData);
      
      if (import.meta.env.DEV) {
        console.log('[InspectionForm] Queued for sync when online');
      }
    }
  };

  const autoSaveProgress = async () => {
    if (!hasUnsavedChanges || saving || autoSaving) return;
    
    setAutoSaving(true);
    try {
      await performSave();
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      console.log("Auto-saved successfully");
    } catch (error: any) {
      console.error("Auto-save failed:", error);
    } finally {
      setAutoSaving(false);
    }
  };

  const saveProgress = async () => {
    setSaving(true);
    try {
      await performSave();
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      toast.success(isOnline ? "Progress saved" : "Saved offline - will sync when online");
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error("Failed to save progress");
    } finally {
      setSaving(false);
    }
  };

  const completeInspection = async () => {
    await saveProgress();
    try {
      if (isOnline) {
        const { error } = await supabase
          .from("inspections")
          .update({ status: "completed" })
          .eq("id", id);

        if (error) throw error;
        toast.success("Inspection completed!");
      } else {
        // Save completion offline
        const updatedInspection = { ...inspection, status: "completed" };
        await saveInspectionOffline(updatedInspection);
        await queueOperation('update', id!, updatedInspection);
        toast.success("Inspection completed offline - will sync when online");
      }
      navigate("/dashboard");
    } catch (error: any) {
      toast.error("Failed to complete inspection");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Loading inspection...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <img src={ropeWorksLogo} alt="Rope Works" className="h-10 w-auto object-contain absolute left-1/2 transform -translate-x-1/2" />
          <div className="flex items-center gap-3">
            {!isOnline && (
              <Badge variant="secondary" className="gap-2">
                <WifiOff className="w-4 h-4" />
                Offline Mode
              </Badge>
            )}
            <SyncStatusIndicator />
            <div className="text-xs text-muted-foreground">
              {autoSaving && (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Auto-saving...
                </span>
              )}
              {!autoSaving && lastSaved && (
                <span>Last saved: {formatTime(lastSaved)}</span>
              )}
              {!autoSaving && !lastSaved && hasUnsavedChanges && (
                <span className="text-yellow-600">Unsaved changes</span>
              )}
            </div>
            <Button variant="outline" onClick={saveProgress} disabled={saving || autoSaving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : "Save Progress"}
            </Button>
            <Button onClick={completeInspection} disabled={saving || autoSaving}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Complete
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <InspectionHeader inspection={inspection} />

        <Tabs defaultValue="details" className="space-y-6 mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details">Zip Lines & Systems</TabsTrigger>
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
            <TabsTrigger value="standards">Standards</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-6">
            <OperatingSystemsTable systems={systems} onUpdate={setSystems} />
            <ZiplinesTable ziplines={ziplines} onUpdate={setZiplines} />
          </TabsContent>

          <TabsContent value="equipment" className="space-y-6">
            <EquipmentTable
              category="harnesses"
              displayName="Harnesses"
              equipment={equipment}
              onUpdate={setEquipment}
            />
            <EquipmentTable
              category="helmets"
              displayName="Helmets"
              equipment={equipment}
              onUpdate={setEquipment}
            />
            <EquipmentTable
              category="lanyards"
              displayName="Lanyards"
              equipment={equipment}
              onUpdate={setEquipment}
            />
            <EquipmentTable
              category="connectors"
              displayName="Connectors (Carabiners & Quicklinks)"
              equipment={equipment}
              onUpdate={setEquipment}
            />
            <EquipmentTable
              category="rope"
              displayName="Kernmantle Rope"
              equipment={equipment}
              onUpdate={setEquipment}
            />
            <EquipmentTable
              category="belay"
              displayName="Belay/Descent Device"
              equipment={equipment}
              onUpdate={setEquipment}
            />
            <EquipmentTable
              category="trolleys"
              displayName="Trolleys and Pulleys"
              equipment={equipment}
              onUpdate={setEquipment}
            />
            <EquipmentTable
              category="other"
              displayName="Other Equipment"
              equipment={equipment}
              onUpdate={setEquipment}
            />
          </TabsContent>

          <TabsContent value="standards" className="space-y-4">
            <StandardsTable standards={standards} onUpdate={setStandards} />
          </TabsContent>

          <TabsContent value="summary" className="space-y-4">
            <SummarySection summary={summary} onUpdate={setSummary} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
