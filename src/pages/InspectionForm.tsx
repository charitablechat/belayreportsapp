import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Save, CheckCircle, Loader2, WifiOff, CloudOff, LogOut, User } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import InspectionHeader from "@/components/inspection/InspectionHeader";
import OperatingSystemsTable from "@/components/inspection/OperatingSystemsTable";
import ZiplinesTable from "@/components/inspection/ZiplinesTable";
import EquipmentTable from "@/components/inspection/EquipmentTable";
import StandardsTable from "@/components/inspection/StandardsTable";
import SummarySection from "@/components/inspection/SummarySection";
import PhotoCapture from "@/components/PhotoCapture";
import PhotoGallery from "@/components/PhotoGallery";
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
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDebounceTimer, setSaveDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
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
    id: '',
    inspection_id: '',
    repairs_performed: "",
    critical_actions: "",
    future_considerations: "",
    next_inspection_date: null,
  });

  useEffect(() => {
    loadInspection();
    
    // Fetch current user
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      
      // Fetch user profile
      if (user) {
        const { data: profile } = await (supabase as any)
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        
        setUserProfile(profile);
      }
    };
    
    fetchUser();
    
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setCurrentUser(session?.user ?? null);
      }
    );
    
    return () => subscription.unsubscribe();
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

  // Auto-populate repairs from "pass w/ repair" items
  useEffect(() => {
    if (!loading) {
      const repairsList = generateRepairsBulletList();
      
      // Only update if the generated list is different from current value
      // This prevents infinite loops and unnecessary updates
      if (repairsList !== summary.repairs_performed) {
        setSummary(prev => ({
          ...prev,
          repairs_performed: repairsList
        }));
      }
    }
  }, [systems, ziplines, equipment, loading]);

  const formatValidationError = (error: { path: string; message: string }) => {
    const pathParts = error.path.split('.');
    
    let fieldName = '';
    
    if (pathParts[0] === 'inspection') {
      fieldName = pathParts[1]?.replace(/_/g, ' ') || 'inspection';
    } else if (pathParts[0] === 'systems') {
      const index = parseInt(pathParts[1]) + 1;
      const field = pathParts[2]?.replace(/_/g, ' ') || 'field';
      fieldName = `Operating System #${index}: ${field}`;
    } else if (pathParts[0] === 'ziplines') {
      const index = parseInt(pathParts[1]) + 1;
      const field = pathParts[2]?.replace(/_/g, ' ') || 'field';
      fieldName = `Zipline #${index}: ${field}`;
    } else if (pathParts[0] === 'equipment') {
      const index = parseInt(pathParts[1]) + 1;
      const field = pathParts[2]?.replace(/_/g, ' ') || 'field';
      fieldName = `Equipment #${index}: ${field}`;
    } else if (pathParts[0] === 'standards') {
      const index = parseInt(pathParts[1]) + 1;
      const field = pathParts[2]?.replace(/_/g, ' ') || 'field';
      fieldName = `Standard #${index}: ${field}`;
    } else if (pathParts[0] === 'summary') {
      const field = pathParts[1]?.replace(/_/g, ' ') || 'field';
      fieldName = `Summary: ${field}`;
    } else {
      fieldName = error.path.replace(/\./g, ' → ');
    }
    
    return `${fieldName} - ${error.message}`;
  };

  const normalizeResultValue = (value: string | null | undefined): string => {
    if (!value) return 'pass';
    return value.toLowerCase();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const generateRepairsBulletList = () => {
    const repairs: string[] = [];
    
    // Collect from Operating Systems
    systems.forEach((system) => {
      if (system.result === 'pass w/ repair') {
        const name = system.system_name || 'Unnamed System';
        const comment = system.comments ? ` - ${system.comments}` : '';
        repairs.push(`• Operating System: ${name}${comment}`);
      }
    });
    
    // Collect from Ziplines (check all result fields)
    ziplines.forEach((zipline) => {
      const name = zipline.zipline_name || 'Unnamed Zipline';
      
      // Overall result
      if (zipline.result === 'pass w/ repair') {
        const comment = zipline.comments ? ` - ${zipline.comments}` : '';
        repairs.push(`• Zipline: ${name} (Overall)${comment}`);
      }
      
      // Cable result
      if (zipline.cable_result === 'pass w/ repair') {
        repairs.push(`• Zipline: ${name} (Cable)`);
      }
      
      // Braking result
      if (zipline.braking_result === 'pass w/ repair') {
        repairs.push(`• Zipline: ${name} (Braking System: ${zipline.braking_system || 'N/A'})`);
      }
      
      // EAD result
      if (zipline.ead_result === 'pass w/ repair') {
        repairs.push(`• Zipline: ${name} (EAD System: ${zipline.ead_system || 'N/A'})`);
      }
    });
    
    // Collect from Equipment
    equipment.forEach((item) => {
      if (item.result === 'pass w/ repair') {
        const type = item.equipment_type || 'Unnamed Equipment';
        const category = item.equipment_category ? ` (${item.equipment_category})` : '';
        const comment = item.comments ? ` - ${item.comments}` : '';
        repairs.push(`• Equipment: ${type}${category}${comment}`);
      }
    });
    
    return repairs.join('\n');
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
      if (offlineSummary.length > 0) {
        setSummary(offlineSummary[0]);
      } else {
        // Initialize summary with required fields if it doesn't exist
        setSummary({
          id: crypto.randomUUID(),
          inspection_id: id!,
          repairs_performed: "",
          critical_actions: "",
          future_considerations: "",
          next_inspection_date: null,
        });
      }

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

  const performSave = async (silent: boolean = false) => {
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
      // Only include summary in validation if it has required fields and content
      const hasSummaryContent = summary.repairs_performed || 
                                summary.critical_actions || 
                                summary.future_considerations || 
                                summary.next_inspection_date;
      const summaryForValidation = (summary.id && summary.inspection_id && hasSummaryContent) 
        ? summary 
        : null;
      
      // Filter out incomplete equipment items before validation (allows saving work-in-progress)
      const completeEquipment = equipment.filter(item => 
        item.equipment_type && item.equipment_type.trim() !== ""
      );
      
      const validation = validateInspectionPackage({
        inspection: inspectionToSave,
        systems,
        ziplines,
        equipment: completeEquipment,
        standards,
        summary: summaryForValidation,
      });
      
      if (!validation.success) {
        // Format the first error with field context
        const firstError = formatValidationError(validation.errors[0]);
        const additionalErrorCount = validation.errors.length - 1;
        const description = additionalErrorCount > 0 
          ? `${additionalErrorCount} more field${additionalErrorCount > 1 ? 's' : ''} need${additionalErrorCount > 1 ? '' : 's'} attention`
          : undefined;
        
        const errorMsg = `Validation warning: ${firstError}`;
        setSaveError(errorMsg);
        
        // Only show toast for manual saves, not auto-saves
        if (!silent) {
          toast.warning("Validation warnings found", {
            description: firstError + (description ? `. ${description}` : ''),
            duration: 6000,
          });
        }
        
        console.warn('[InspectionForm] Validation warnings (saving anyway):', validation.errors);
        // Continue with save despite validation errors
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

      // Filter out empty/invalid records before saving
      const validSystems = systems.filter(s => 
        s.system_name && s.system_name.trim() !== ""
      );
      const validZiplines = ziplines.filter(z => 
        z.zipline_name && z.zipline_name.trim() !== ""
      );
      const validEquipment = equipment.filter(e => 
        e.equipment_type && e.equipment_type.trim() !== ""
      );

      // Save all related data to offline storage
      await Promise.all([
        saveRelatedDataOffline('systems', id!, validSystems),
        saveRelatedDataOffline('ziplines', id!, validZiplines),
        saveRelatedDataOffline('equipment', id!, validEquipment),
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
          // Sanitize inspection data - convert empty strings to null for date fields
          const sanitizeInspection = (insp: any) => ({
            ...insp,
            previous_inspection_date: insp.previous_inspection_date === "" ? null : insp.previous_inspection_date,
            id: undefined, // Remove id from update
          });

          const { error: inspectionError } = await supabase
            .from("inspections")
            .update(sanitizeInspection(inspectionToSave))
            .eq("id", id);
          
          if (inspectionError) {
            console.error('[InspectionForm] Failed to update inspection:', inspectionError);
            throw inspectionError;
          }
          
          // Save systems
        for (const system of validSystems) {
          if (system.id && system.id.startsWith('temp-')) {
            // Temporary offline ID - insert as new
            const { id: tempId, ...systemData } = system;
            const { data, error } = await supabase
              .from("inspection_systems")
              .insert({ ...systemData, inspection_id: id })
              .select()
              .single();
            
            if (data && !error) {
              // Update local state with the new database-generated ID
              setSystems(prev => prev.map(s => 
                s.id === system.id ? { ...s, id: data.id } : s
              ));
            }
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
        for (const zipline of validZiplines) {
          if (zipline.id && zipline.id.startsWith('temp-')) {
            const { id: tempId, ...ziplineData } = zipline;
            const { data, error } = await supabase
              .from("inspection_ziplines")
              .insert({ ...ziplineData, inspection_id: id })
              .select()
              .single();
            
            if (data && !error) {
              // Update local state with the new database-generated ID
              setZiplines(prev => prev.map(z => 
                z.id === zipline.id ? { ...z, id: data.id } : z
              ));
            }
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
        for (const item of validEquipment) {
          if (item.id && item.id.startsWith('temp-')) {
            const { id: tempId, ...equipmentData } = item;
            const { data, error } = await supabase
              .from("inspection_equipment")
              .insert({ ...equipmentData, inspection_id: id })
              .select()
              .single();
            
            if (data && !error) {
              // Update local state with the new database-generated ID
              setEquipment(prev => prev.map(e => 
                e.id === item.id ? { ...e, id: data.id } : e
              ));
            }
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
        // Sanitize summary data - convert empty strings to null for date fields
        const sanitizeSummary = (sum: any) => ({
          ...sum,
          next_inspection_date: sum.next_inspection_date === "" ? null : sum.next_inspection_date
        });

        const { data: existingSummary } = await supabase
          .from("inspection_summary")
          .select("id")
          .eq("inspection_id", id)
          .maybeSingle();

        if (existingSummary) {
          await supabase
            .from("inspection_summary")
            .update(sanitizeSummary(summary))
            .eq("inspection_id", id);
        } else {
          const { id: sumId, ...summaryData } = summary as any;
          await supabase
            .from("inspection_summary")
            .insert(sanitizeSummary({ ...summaryData, inspection_id: id }));
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
      await performSave(true); // Silent auto-save
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
      await performSave(false); // Show warnings on manual save
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
    // Strict validation before completion - require ALL equipment to have types
    const hasSummaryContent = summary.repairs_performed || 
                              summary.critical_actions || 
                              summary.future_considerations || 
                              summary.next_inspection_date;
    const summaryForValidation = (summary.id && summary.inspection_id && hasSummaryContent) 
      ? summary 
      : null;
    
    const validation = validateInspectionPackage({
      inspection: { ...inspection, status: 'completed' },
      systems,
      ziplines,
      equipment, // Use ALL equipment - no filtering
      standards,
      summary: summaryForValidation,
    });
    
    if (!validation.success) {
      // Show first error with field context
      const firstError = formatValidationError(validation.errors[0]);
      const totalErrors = validation.errors.length;
      const additionalCount = totalErrors - 1;
      
      toast.error("Cannot complete inspection", {
        description: firstError + (additionalCount > 0 ? `. ${additionalCount} more field${additionalCount > 1 ? 's' : ''} required` : ''),
        duration: 8000,
        action: totalErrors > 1 ? {
          label: `View all ${totalErrors} errors`,
          onClick: () => {
            console.table(validation.errors.map(formatValidationError));
            toast.info("Check console for full error list");
          }
        } : undefined
      });
      
      console.error('[InspectionForm] Completion validation errors:', 
        validation.errors.map(formatValidationError));
      return;
    }
    
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
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
          {/* Top row - Back button, Logo, User Avatar */}
          <div className="flex items-center justify-between mb-2 sm:mb-0">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <img src={ropeWorksLogo} alt="Rope Works" className="h-8 sm:h-10 w-auto object-contain" />
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <UserAvatar 
                    userEmail={currentUser?.email ?? null}
                    avatarUrl={userProfile?.avatar_url ?? null}
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">Account</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {currentUser?.email || 'user@example.com'}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          
          {/* Bottom row - Status indicators and action buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {!isOnline && (
                <Badge variant="secondary" className="gap-2 text-xs">
                  <WifiOff className="w-3 h-3" />
                  <span className="hidden sm:inline">Offline Mode</span>
                </Badge>
              )}
              <SyncStatusIndicator />
              <div className="text-xs hidden sm:block">
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
            </div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={saveProgress} disabled={saving || autoSaving}>
                <Save className="w-4 h-4" />
                <span className="hidden md:inline ml-2">{saving ? "Saving..." : isOnline ? "Save Progress" : "Save Locally"}</span>
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button size="sm" onClick={completeInspection} disabled={saving || autoSaving || !isOnline}>
                        <CheckCircle className="w-4 h-4" />
                        <span className="hidden md:inline ml-2">Complete</span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!isOnline && (
                    <TooltipContent>Must be online to complete inspection</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
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
          <TabsList className="grid grid-cols-2 lg:grid-cols-4 w-full gap-1">
            <TabsTrigger value="details">Zip Lines & Systems</TabsTrigger>
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
            <TabsTrigger value="standards">Standards</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-6">
            <OperatingSystemsTable systems={systems} onUpdate={setSystems} />
            <ZiplinesTable ziplines={ziplines} onUpdate={setZiplines} />
            
            <div className="mt-8 border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Photos - Systems & Ziplines</h3>
              <PhotoCapture
                inspectionId={id!}
                section="systems"
                onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
              />
              <div className="mt-4">
                <PhotoGallery
                  key={`systems-${photoRefreshKey}`}
                  inspectionId={id!}
                  section="systems"
                />
              </div>
            </div>
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
            
            <div className="mt-8 border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Photos - Equipment</h3>
              <PhotoCapture
                inspectionId={id!}
                section="equipment"
                onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
              />
              <div className="mt-4">
                <PhotoGallery
                  key={`equipment-${photoRefreshKey}`}
                  inspectionId={id!}
                  section="equipment"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="standards" className="space-y-4">
            <StandardsTable standards={standards} onUpdate={setStandards} />
            
            <div className="mt-8 border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Photos - Standards</h3>
              <PhotoCapture
                inspectionId={id!}
                section="standards"
                onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
              />
              <div className="mt-4">
                <PhotoGallery
                  key={`standards-${photoRefreshKey}`}
                  inspectionId={id!}
                  section="standards"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="summary" className="space-y-4">
            <SummarySection summary={summary} onUpdate={setSummary} />
            
            <div className="mt-8 border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Photos - Summary</h3>
              <PhotoCapture
                inspectionId={id!}
                section="summary"
                onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
              />
              <div className="mt-4">
                <PhotoGallery
                  key={`summary-${photoRefreshKey}`}
                  inspectionId={id!}
                  section="summary"
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
