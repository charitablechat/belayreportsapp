import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Save, CheckCircle, Loader2, WifiOff, CloudOff } from "lucide-react";
import { toast } from "sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import InspectionHeader from "@/components/inspection/InspectionHeader";
import OperatingSystemsTable from "@/components/inspection/OperatingSystemsTable";
import ZiplinesTable from "@/components/inspection/ZiplinesTable";
import EquipmentTable from "@/components/inspection/EquipmentTable";
import StandardsTable from "@/components/inspection/StandardsTable";
import SummarySection from "@/components/inspection/SummarySection";
import { 
  saveInspectionOffline, 
  getOfflineInspection, 
  queueOperation,
  saveRelatedDataOffline,
  getRelatedDataOffline
} from "@/lib/offline-storage";
import { validateInspectionPackage } from "@/lib/validation-schemas";
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDebounceTimer, setSaveDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [inspection, setInspection] = useState<any>(null);
  const [systems, setSystems] = useState<any[]>([]);
  const [ziplines, setZiplines] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [standards, setStandards] = useState<any[]>([
    { id: crypto.randomUUID(), standard_name: "Local Written Operations Procedures", has_documentation: false },
    { id: crypto.randomUUID(), standard_name: "Local Written Emergency Action Plan", has_documentation: false },
    { id: crypto.randomUUID(), standard_name: "Minimum Annual Training", has_documentation: false },
    { id: crypto.randomUUID(), standard_name: "Written Pre-Use Inspection in Use", has_documentation: false },
    { id: crypto.randomUUID(), standard_name: "Inventory Tracking System in Use", has_documentation: false },
    { id: crypto.randomUUID(), standard_name: "Operational Review Every 5 Years", has_documentation: false },
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

  // Track changes to inspection data and trigger debounced auto-save
  useEffect(() => {
    if (!loading) {
      setHasUnsavedChanges(true);
      
      // Clear existing debounce timer
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
      }
      
      // Set new debounce timer for 3 seconds
      const timer = setTimeout(() => {
        autoSaveProgress();
      }, 3000);
      
      setSaveDebounceTimer(timer);
    }
  }, [systems, ziplines, equipment, standards, summary]);

  // Auto-save interval (every 10 seconds as backup)
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      if (hasUnsavedChanges && !saving && !autoSaving) {
        autoSaveProgress();
      }
    }, 10000); // 10 seconds = 10,000 ms

    return () => {
      clearInterval(autoSaveInterval);
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
      }
    };
  }, [hasUnsavedChanges, saving, autoSaving]);

  const normalizeResultValue = (value: string | null | undefined): string => {
    if (!value) return 'pass';
    return value.toLowerCase();
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const handleHeaderUpdate = async (field: string, value: string) => {
    try {
      const updatedInspection = {
        ...inspection,
        [field]: value,
        updated_at: new Date().toISOString(),
      };

      setInspection(updatedInspection);

      // Save offline
      await saveInspectionOffline(updatedInspection);

      if (isOnline) {
        // Update in Supabase
        const { error } = await supabase
          .from("inspections")
          .update({ [field]: value, updated_at: new Date().toISOString() })
          .eq("id", id);

        if (error) throw error;
        
        toast.success("Field updated successfully");
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Header field updated:', field, value);
        }
      } else {
        // Queue for later sync
        await queueOperation('update', id!, updatedInspection);
        toast.success("Field updated offline - will sync when online");
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Header field queued for sync:', field, value);
        }
      }

      setHasUnsavedChanges(false);
    } catch (error: any) {
      console.error("Error updating field:", error);
      toast.error("Failed to update field");
    }
  };

  const loadInspection = async () => {
    try {
      // Load inspection header from offline first
      const offlineData = await getOfflineInspection(id!);
      
      if (offlineData) {
        setInspection(offlineData);
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Loaded inspection from offline storage');
        }
      }

      // Load all related data from offline storage first
      const [
        offlineSystems,
        offlineZiplines,
        offlineEquipment,
        offlineStandards,
        offlineSummary
      ] = await Promise.all([
        getRelatedDataOffline('systems', id!),
        getRelatedDataOffline('ziplines', id!),
        getRelatedDataOffline('equipment', id!),
        getRelatedDataOffline('standards', id!),
        getRelatedDataOffline('summary', id!)
      ]);

      if (offlineSystems.length > 0) {
        const normalizedSystems = offlineSystems.map(item => ({
          ...item,
          result: normalizeResultValue(item.result)
        }));
        setSystems(normalizedSystems);
      }
      if (offlineZiplines.length > 0) {
        const normalizedZiplines = offlineZiplines.map(item => ({
          ...item,
          result: normalizeResultValue(item.result),
          cable_result: normalizeResultValue(item.cable_result),
          braking_result: normalizeResultValue(item.braking_result),
          ead_result: normalizeResultValue(item.ead_result)
        }));
        setZiplines(normalizedZiplines);
      }
      if (offlineEquipment.length > 0) {
        const normalizedEquipment = offlineEquipment.map(item => ({
          ...item,
          result: normalizeResultValue(item.result)
        }));
        setEquipment(normalizedEquipment);
      }
      if (offlineStandards.length > 0) setStandards(offlineStandards);
      if (offlineSummary.length > 0) setSummary(offlineSummary[0]);

      if (import.meta.env.DEV) {
        console.log('[InspectionForm] Loaded related data from offline storage');
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
            console.log('[InspectionForm] Updated inspection from Supabase');
          }
        }

        // Fetch and cache all related data
        const { data: systemsData } = await supabase
          .from("inspection_systems")
          .select("*")
          .eq("inspection_id", id);
        if (systemsData) {
          const normalizedSystems = systemsData.map(item => ({
            ...item,
            result: normalizeResultValue(item.result)
          }));
          setSystems(normalizedSystems);
          await saveRelatedDataOffline('systems', id!, normalizedSystems);
        }

        const { data: ziplinesData } = await supabase
          .from("inspection_ziplines")
          .select("*")
          .eq("inspection_id", id);
        if (ziplinesData) {
          const normalizedZiplines = ziplinesData.map(item => ({
            ...item,
            result: normalizeResultValue(item.result),
            cable_result: normalizeResultValue(item.cable_result),
            braking_result: normalizeResultValue(item.braking_result),
            ead_result: normalizeResultValue(item.ead_result)
          }));
          setZiplines(normalizedZiplines);
          await saveRelatedDataOffline('ziplines', id!, normalizedZiplines);
        }

        const { data: equipmentData } = await supabase
          .from("inspection_equipment")
          .select("*")
          .eq("inspection_id", id);
        if (equipmentData) {
          const normalizedEquipment = equipmentData.map(item => ({
            ...item,
            result: normalizeResultValue(item.result)
          }));
          setEquipment(normalizedEquipment);
          await saveRelatedDataOffline('equipment', id!, normalizedEquipment);
        }

        const { data: standardsData } = await supabase
          .from("inspection_standards")
          .select("*")
          .eq("inspection_id", id);
        if (standardsData && standardsData.length > 0) {
          setStandards(standardsData);
          await saveRelatedDataOffline('standards', id!, standardsData);
        }

        const { data: summaryData } = await supabase
          .from("inspection_summary")
          .select("*")
          .eq("inspection_id", id)
          .maybeSingle();
        if (summaryData) {
          setSummary(summaryData);
          await saveRelatedDataOffline('summary', id!, [summaryData]);
        }

        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Synced and cached all data from Supabase');
        }
      } else if (!offlineData) {
        throw new Error("No offline data available");
      }
    } catch (error: any) {
      console.error("Error loading inspection:", error);
      toast.error("Failed to load inspection");
    } finally {
      setLoading(false);
    }
  };

  const performSave = async () => {
    try {
      // Fix inspector_id mismatch before saving
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }
      
      // Ensure inspector_id matches current user
      const inspectionToSave = {
        ...inspection,
        inspector_id: user.id,
        updated_at: new Date().toISOString(),
      };
      
      // Validate before saving
      const validation = validateInspectionPackage({
        inspection: inspectionToSave,
        systems,
        ziplines,
        equipment,
        standards,
        summary: summary.next_inspection_date || summary.repairs_performed ? summary : null,
      });
      
      if (!validation.success) {
        const errorMsg = `Validation failed: ${validation.errors[0].message}`;
        setSaveError(errorMsg);
        toast.error(errorMsg);
        console.error('[InspectionForm] Validation errors:', validation.errors);
        throw new Error('Validation failed');
      }
      
      if (import.meta.env.DEV) {
        console.log('[InspectionForm] Validation passed');
      }

      const saveData = {
        systems,
        ziplines,
        equipment,
        standards,
        summary,
        updated_at: new Date().toISOString(),
      };

      // Always save to offline storage first - this is IMMEDIATE and never fails
      await saveInspectionOffline(inspectionToSave);
      setInspection(inspectionToSave);

      // Save all related data to offline storage
      await Promise.all([
        saveRelatedDataOffline('systems', id!, systems),
        saveRelatedDataOffline('ziplines', id!, ziplines),
        saveRelatedDataOffline('equipment', id!, equipment),
        saveRelatedDataOffline('standards', id!, standards),
        saveRelatedDataOffline('summary', id!, [summary]),
      ]);

      if (import.meta.env.DEV) {
        console.log('[InspectionForm] Saved all data to offline storage');
      }
      
      // Clear any previous save errors
      setSaveError(null);

      // If online, sync to Supabase
      if (isOnline) {
        try {
          // Update inspection with correct inspector_id
          const { error: inspectionError } = await supabase
            .from("inspections")
            .update({
              ...inspectionToSave,
              id: undefined, // Remove id from update
            })
            .eq("id", id);
          
          if (inspectionError) {
            console.error('[InspectionForm] Failed to update inspection:', inspectionError);
            throw inspectionError;
          }
          
          // Save systems
        for (const system of systems) {
          if (system.id && system.id.includes('-')) {
            // Temporary offline ID - insert as new
            const { id: tempId, ...systemData } = system;
            await supabase
              .from("inspection_systems")
              .insert({ ...systemData, inspection_id: id });
          } else if (system.id) {
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
          if (zipline.id && zipline.id.includes('-')) {
            const { id: tempId, ...ziplineData } = zipline;
            await supabase
              .from("inspection_ziplines")
              .insert({ ...ziplineData, inspection_id: id });
          } else if (zipline.id) {
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
          if (item.id && item.id.includes('-')) {
            const { id: tempId, ...equipmentData } = item;
            await supabase
              .from("inspection_equipment")
              .insert({ ...equipmentData, inspection_id: id });
          } else if (item.id) {
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
        const standardsToInsert = standards.map(s => {
          const { id: stdId, ...standardData } = s;
          return { ...standardData, inspection_id: id };
        });
        await supabase.from("inspection_standards").insert(standardsToInsert);

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
          const { id: sumId, ...summaryData } = summary as any;
          await supabase
            .from("inspection_summary")
            .insert({ ...summaryData, inspection_id: id });
        }

          // Mark as synced
          await saveInspectionOffline({
            ...inspectionToSave,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          if (import.meta.env.DEV) {
            console.log('[InspectionForm] Synced all data to Supabase');
          }
        } catch (error) {
          console.error('[InspectionForm] Failed to sync to Supabase:', error);
          setSaveError('Failed to sync online - saved locally');
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
    } catch (error: any) {
      console.error('[InspectionForm] Save error:', error);
      setSaveError(error.message || 'Failed to save');
      throw error;
    }
  };

  const autoSaveProgress = async () => {
    if (!hasUnsavedChanges || saving || autoSaving) return;
    
    setAutoSaving(true);
    try {
      await performSave();
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      if (import.meta.env.DEV) {
        console.log("Auto-saved successfully at", new Date().toLocaleTimeString());
      }
    } catch (error: any) {
      console.error("Auto-save failed:", error);
      setSaveError(error.message || 'Auto-save failed');
    } finally {
      setAutoSaving(false);
    }
  };

  const saveProgress = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await performSave();
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      toast.success(isOnline ? "Progress saved" : "Saved offline - will sync when online");
    } catch (error: any) {
      console.error("Save error:", error);
      const errorMsg = error.message || "Failed to save progress";
      setSaveError(errorMsg);
      toast.error(errorMsg);
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
      <header className="border-b bg-card sticky top-0 z-20">
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
            <div className="text-xs">
              {saveError && (
                <div className="flex items-center gap-1 text-destructive">
                  <span>⚠️ {saveError}</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-5 px-2 text-xs"
                    onClick={saveProgress}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!saveError && autoSaving && (
                <span className="flex items-center gap-1 text-blue-600">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Saving...
                </span>
              )}
              {!saveError && !autoSaving && lastSaved && (
                <span className="text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Saved {formatTime(lastSaved)}
                </span>
              )}
              {!saveError && !autoSaving && !lastSaved && hasUnsavedChanges && (
                <span className="text-yellow-600">Unsaved changes</span>
              )}
            </div>
            <Button variant="outline" onClick={saveProgress} disabled={saving || autoSaving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : isOnline ? "Save Progress" : "Save Locally"}
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button onClick={completeInspection} disabled={saving || autoSaving || !isOnline}>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Complete
                    </Button>
                  </span>
                </TooltipTrigger>
                {!isOnline && (
                  <TooltipContent>
                    <p>Complete inspection requires internet connection</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {!isOnline && (
          <Alert className="mb-6 border-warning bg-warning/10">
            <CloudOff className="h-4 w-4 text-warning" />
            <AlertDescription className="text-warning-foreground">
              📴 Working offline - data will sync when online
            </AlertDescription>
          </Alert>
        )}

        <InspectionHeader inspection={inspection} onUpdate={handleHeaderUpdate} />

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
