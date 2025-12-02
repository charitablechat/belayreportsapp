import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Save, CheckCircle, Loader2, WifiOff, CloudOff, LogOut, User, FileText } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { usePWA } from "@/hooks/usePWA";
import { convertCircleBulletsToHtml } from "@/lib/bullet-converter";
import { getUserWithCache } from "@/lib/cached-auth";
import { HtmlReportViewer } from "@/components/HtmlReportViewer";
import { openHtmlReport } from "@/lib/html-report-viewer";
import { useKeyboardAvoidance } from "@/hooks/useKeyboardAvoidance";
import { useScrollBoundaryDetection } from "@/hooks/useScrollBoundaryDetection";
import { isMobile } from "@/lib/mobile-detection";
import { triggerCompletionConfetti } from "@/lib/confetti";
import { triggerHaptic } from "@/lib/haptics";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { FloatingActionButton } from "@/components/ui/floating-action-button";
import { Check } from "lucide-react";

export default function InspectionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const { triggerSync } = usePWA();
  const isMobileView = useIsMobile();
  
  // Enable keyboard avoidance for mobile
  useKeyboardAvoidance();
  
  // Enable scroll boundary detection with haptic feedback (mobile only)
  const isMobileDevice = isMobile();
  useScrollBoundaryDetection(isMobileDevice);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [generatingHtml, setGeneratingHtml] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDebounceTimer, setSaveDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [htmlViewerOpen, setHtmlViewerOpen] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>('');
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

  // Track if auto-population has run for this inspection
  const autoPopulatedRef = useRef<string | null>(null);
  
  // Tab navigation state
  const [currentTab, setCurrentTab] = useState("details");
  const tabOrder = ["details", "equipment", "standards", "summary"];
  
  // Swipe navigation for mobile
  const swipeContainerRef = useSwipeNavigation({
    enabled: isMobileView,
    onSwipeLeft: () => {
      const currentIndex = tabOrder.indexOf(currentTab);
      if (currentIndex < tabOrder.length - 1) {
        setCurrentTab(tabOrder[currentIndex + 1]);
      }
    },
    onSwipeRight: () => {
      const currentIndex = tabOrder.indexOf(currentTab);
      if (currentIndex > 0) {
        setCurrentTab(tabOrder[currentIndex - 1]);
      }
    },
  });

  // Auto-generate summary content from inspection results
  const generateSummaryFromInspection = () => {
    const criticalActions: string[] = [];
    const repairsPerformed: string[] = [];

    // Process Equipment
    equipment.forEach(item => {
      if (!item.equipment_type) return;
      
      const details = [
        item.equipment_type,
        item.production_year ? `Year: ${item.production_year}` : null,
        item.quantity ? `Qty: ${item.quantity}` : null
      ].filter(Boolean).join(', ');
      
      const entry = `○   ${item.equipment_category || 'Equipment'}- ${details}${item.comments ? ': ' + item.comments : ''}`;
      
      if (item.result === 'fail') {
        criticalActions.push(entry);
      } else if (item.result === 'pass w/provisions') {
        repairsPerformed.push(entry);
      }
    });

    // Process Operating Systems
    systems.forEach(system => {
      if (!system.system_name) return;
      
      const name = system.name ? ` (${system.name})` : '';
      const entry = `○   Operating System- ${system.system_name}${name}${system.comments ? ': ' + system.comments : ''}`;
      
      if (system.result === 'fail') {
        criticalActions.push(entry);
      } else if (system.result === 'pass w/provisions') {
        repairsPerformed.push(entry);
      }
    });

    // Process Ziplines
    ziplines.forEach(zipline => {
      if (!zipline.zipline_name) return;
      
      const issues: string[] = [];
      
      // Check each component
      if (zipline.cable_result === 'fail') {
        issues.push('Cable: FAIL');
      } else if (zipline.cable_result === 'pass w/provisions') {
        issues.push('Cable: Pass w/Provisions');
      }
      
      if (zipline.braking_result === 'fail') {
        issues.push('Braking: FAIL');
      } else if (zipline.braking_result === 'pass w/provisions') {
        issues.push('Braking: Pass w/Provisions');
      }
      
      if (zipline.ead_result === 'fail') {
        issues.push('EAD: FAIL');
      } else if (zipline.ead_result === 'pass w/provisions') {
        issues.push('EAD: Pass w/Provisions');
      }
      
      // Check overall result
      const hasFail = zipline.result === 'fail' || zipline.cable_result === 'fail' || 
                      zipline.braking_result === 'fail' || zipline.ead_result === 'fail';
      const hasProvisions = zipline.result === 'pass w/provisions' || 
                            zipline.cable_result === 'pass w/provisions' || 
                            zipline.braking_result === 'pass w/provisions' || 
                            zipline.ead_result === 'pass w/provisions';
      
      if (issues.length > 0) {
        const entry = `○   Zipline- ${zipline.zipline_name} [${issues.join(', ')}]${zipline.comments ? ': ' + zipline.comments : ''}`;
        
        if (hasFail) {
          criticalActions.push(entry);
        } else if (hasProvisions) {
          repairsPerformed.push(entry);
        }
      }
    });

    return {
      criticalActions: criticalActions.length > 0 
        ? criticalActions.join('\n')
        : '',
      repairsPerformed: repairsPerformed.length > 0 
        ? repairsPerformed.join('\n')
        : ''
    };
  };

  useEffect(() => {
    loadInspection();
    
    // Fetch current user - works offline with cache!
    const fetchUser = async () => {
      const user = await getUserWithCache();
      setCurrentUser(user);
      
      // Fetch user profile if online
      if (user && navigator.onLine) {
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

  // Auto-populate ACCT# from user profile
  useEffect(() => {
    if (inspection && userProfile && !inspection.acct_number && userProfile.acct_number) {
      handleHeaderUpdate('acct_number', userProfile.acct_number);
    }
  }, [userProfile, inspection?.id]);

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

  // Auto-populate summary ONCE when inspection loads (only if fields are empty)
  useEffect(() => {
    if (!inspection || loading) return;
    
    // Only auto-populate once per inspection
    if (autoPopulatedRef.current === inspection.id) return;
    
    const autoGenerated = generateSummaryFromInspection();
    
    // Only populate if fields are empty
    if (autoGenerated.criticalActions || autoGenerated.repairsPerformed) {
      setSummary(prev => {
        const newSummary = { ...prev };
        
        // Only set if field is empty (don't merge/append)
        if (!prev.critical_actions?.trim() && autoGenerated.criticalActions) {
          newSummary.critical_actions = convertCircleBulletsToHtml(autoGenerated.criticalActions);
        }
        
        if (!prev.repairs_performed?.trim() && autoGenerated.repairsPerformed) {
          newSummary.repairs_performed = convertCircleBulletsToHtml(autoGenerated.repairsPerformed);
        }
        
        return newSummary;
      });
      
      autoPopulatedRef.current = inspection.id;
    }
  }, [inspection?.id, loading]);

  // Manual regenerate function for summary section
  const handleRegenerateSummary = () => {
    const autoGenerated = generateSummaryFromInspection();
    
    setSummary(prev => ({
      ...prev,
      critical_actions: convertCircleBulletsToHtml(autoGenerated.criticalActions),
      repairs_performed: convertCircleBulletsToHtml(autoGenerated.repairsPerformed),
    }));
  };

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
    // No longer auto-populating repairs from "pass w/ repair" status
    // Users will manually enter repair information
    return '';
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
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Header field updated:', field, value);
        }
      } else {
        // Queue for later sync
        await queueOperation('update', id!, updatedInspection);
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Header field queued for sync:', field, value);
        }
      }

      setHasUnsavedChanges(false);
    } catch (error: any) {
      console.error("Error updating field:", error);
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
        // Update last_opened_at timestamp
        const now = new Date().toISOString();
        await supabase
          .from("inspections")
          .update({ last_opened_at: now })
          .eq("id", id);

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
        
        // Only log for manual saves, not auto-saves
        if (!silent && import.meta.env.DEV) {
          console.log('[InspectionForm] Validation warnings (saving anyway):', validation.errors.map(formatValidationError));
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

  const triggerImmediateSave = async () => {
    if (saving || autoSaving) return;
    
    // Clear existing debounce timer
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      setSaveDebounceTimer(null);
    }
    
    setAutoSaving(true);
    try {
      await performSave(true); // Silent immediate save
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      if (import.meta.env.DEV) {
        console.log("Immediate save triggered at", new Date().toLocaleTimeString());
      }
      // Trigger sync after successful save
      if (isOnline) {
        triggerSync().catch(err => console.error("Immediate sync failed:", err));
      }
    } catch (error: any) {
      console.error("Immediate save failed:", error);
      setSaveError(error.message || 'Immediate save failed');
    } finally {
      setAutoSaving(false);
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
      // Trigger sync after successful save
      if (isOnline) {
        triggerSync().catch(err => console.error("Auto-sync failed:", err));
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
      if (import.meta.env.DEV) {
        console.log('[InspectionForm] Progress saved:', isOnline ? 'online' : 'offline');
      }
      // Trigger sync after successful save
      if (isOnline) {
        await triggerSync();
      }
    } catch (error: any) {
      console.error("Save error:", error);
      const errorMsg = error.message || "Failed to save progress";
      setSaveError(errorMsg);
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
      
      if (import.meta.env.DEV) {
        console.error('[InspectionForm] Cannot complete - validation errors:', 
          validation.errors.map(formatValidationError));
      }
      return;
    }
    
    await saveProgress();
    try {
      const wasAlreadyCompleted = inspection?.status === "completed";
      
      if (isOnline) {
        const { error } = await supabase
          .from("inspections")
          .update({ status: "completed" })
          .eq("id", id);

        if (error) throw error;
        
        // Update local state to reflect completion
        setInspection({ ...inspection, status: "completed" });
        
        // Trigger celebration on first completion
        if (!wasAlreadyCompleted) {
          triggerCompletionConfetti();
          triggerHaptic('success');
        }
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Inspection completed online');
        }
      } else {
        // Save completion offline
        const updatedInspection = { ...inspection, status: "completed" };
        await saveInspectionOffline(updatedInspection);
        await queueOperation('update', id!, updatedInspection);
        
        // Update local state to reflect completion
        setInspection(updatedInspection);
        
        // Trigger celebration on first completion
        if (!wasAlreadyCompleted) {
          triggerCompletionConfetti();
          triggerHaptic('success');
        }
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Inspection completed offline');
        }
      }
      // Stay on the inspection page - don't navigate away
    } catch (error: any) {
      console.error('[InspectionForm] Failed to complete inspection:', error);
    }
  };

  const handleGeneratePDF = async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[PDF Generation] STARTING');
    console.log('[PDF Generation] Inspection ID:', id);
    console.log('[PDF Generation] Inspection Status:', inspection?.status);
    console.log('[PDF Generation] Organization:', inspection?.organization);
    console.log('[PDF Generation] Location:', inspection?.location);
    console.log('[PDF Generation] Online Status:', isOnline);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Validation checks
    if (!id) {
      console.error('[PDF Generation] FAILED: No inspection ID provided');
      return;
    }
    
    if (inspection?.status !== 'completed') {
      console.error('[PDF Generation] FAILED: Inspection not completed', {
        currentStatus: inspection?.status,
        requiredStatus: 'completed'
      });
      return;
    }

    setGeneratingPdf(true);
    console.log('[PDF Generation] State updated: generatingPdf = true');

    try {
      console.log('[PDF Generation] Invoking edge function...');
      console.log('[PDF Generation] Request payload:', { 
        inspectionId: id,
        timestamp: new Date().toISOString()
      });
      
      const startTime = performance.now();
      
      const { data, error } = await supabase.functions.invoke(
        'generate-inspection-pdf',
        {
          body: { inspectionId: id, regenerate: true }
        }
      );
      
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      
      console.log('[PDF Generation] Edge function response received');
      console.log('[PDF Generation] Response time:', duration + 'ms');
      console.log('[PDF Generation] Response data:', {
        hasData: !!data,
        hasError: !!error,
        dataKeys: data ? Object.keys(data) : [],
      });

      if (error) {
        console.error('[PDF Generation] Edge function returned error:', {
          message: error.message,
          status: error.status,
          statusText: error.statusText,
          details: error
        });
        
        // Handle rate limiting
        if (error.message?.includes('Rate limit exceeded')) {
          const minutes = Math.ceil((error.retryAfter || 3600) / 60);
          console.error(`[PDF Generation] Rate limited. Retry after ${minutes} minutes`);
          return;
        }
        
        // Specific error handling based on error type
        if (error.message?.toLowerCase().includes('failed to fetch') ||
            error.message?.toLowerCase().includes('network')) {
          throw new Error('NETWORK_ERROR: Unable to reach PDF generation service. Please check your internet connection and try again.');
        } else if (error.message?.toLowerCase().includes('unauthorized') || 
                   error.message?.toLowerCase().includes('auth') ||
                   error.status === 401 || error.status === 403) {
          throw new Error('AUTH_ERROR: Authentication failed. Please log out and log in again.');
        } else if (error.status === 500) {
          throw new Error('SERVER_ERROR: PDF generation service is experiencing issues. Please try again in a few moments.');
        } else if (error.status === 404) {
          throw new Error('NOT_FOUND: Inspection data not found. Please refresh and try again.');
        } else {
          throw new Error(`FUNCTION_ERROR: ${error.message || 'Unknown edge function error'}`);
        }
      }

      if (!data) {
        console.error('[PDF Generation] No data returned from edge function');
        throw new Error('RESPONSE_ERROR: No response data received from PDF generation service');
      }

      // Determine which format was returned and create blob URL for preview
      let blobUrl = '';
      let fileName = '';
      
      if (data.pdfData) {
        console.log('[PDF Generation] Processing pdfData format (base64)');
        console.log('[PDF Generation] Base64 string length:', data.pdfData.length);
        console.log('[PDF Generation] Estimated PDF size:', Math.round(data.pdfData.length * 0.75 / 1024) + ' KB');
        console.log('[PDF Generation] Filename:', data.fileName);
        
        fileName = data.fileName || `inspection-${inspection.organization}-${Date.now()}.pdf`;
        
        try {
          console.log('[PDF Generation] Decoding base64 to binary...');
          const byteCharacters = atob(data.pdfData);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          console.log('[PDF Generation] Binary array created:', byteArray.length, 'bytes');
          
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          console.log('[PDF Generation] Blob created:', blob.size, 'bytes,', blob.type);
          
          blobUrl = URL.createObjectURL(blob);
          console.log('[PDF Generation] Blob URL created for preview:', blobUrl);
          
        } catch (decodeError: any) {
          console.error('[PDF Generation] Base64 decode error:', decodeError);
          throw new Error('DECODE_ERROR: Failed to decode PDF data. The file may be corrupted.');
        }
        
      } else if (data.pdfUrl) {
        console.log('[PDF Generation] Processing pdfUrl format (storage URL)');
        console.log('[PDF Generation] PDF URL:', data.pdfUrl);
        
        fileName = `inspection-${inspection.organization}-${Date.now()}.pdf`;
        
        try {
          console.log('[PDF Generation] Fetching PDF from storage...');
          const response = await fetch(data.pdfUrl);
          console.log('[PDF Generation] Fetch response:', {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            contentLength: response.headers.get('content-length')
          });
          
          if (!response.ok) {
            throw new Error(`FETCH_ERROR: Failed to download PDF (${response.status} ${response.statusText})`);
          }
          
          const blob = await response.blob();
          console.log('[PDF Generation] Blob received:', blob.size, 'bytes,', blob.type);
          
          if (blob.size === 0) {
            throw new Error('EMPTY_FILE: Downloaded PDF file is empty');
          }
          
          blobUrl = URL.createObjectURL(blob);
          console.log('[PDF Generation] Blob URL created for preview:', blobUrl);
          
        } catch (fetchError: any) {
          console.error('[PDF Generation] Storage fetch error:', fetchError);
          throw new Error(`STORAGE_ERROR: ${fetchError.message}`);
        }
        
      } else {
        console.error('[PDF Generation] Invalid response format:', {
          hasData: !!data,
          hasPdfData: !!data.pdfData,
          hasPdfUrl: !!data.pdfUrl,
          dataKeys: Object.keys(data)
        });
        throw new Error('FORMAT_ERROR: Invalid response format from PDF service. Expected pdfData or pdfUrl.');
      }

      // Trigger download directly
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.download = fileName;
      downloadLink.style.display = 'none';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Clean up blob URL after download
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        console.log('[PDF Generation] Blob URL cleaned up');
      }, 1000);
      
      console.log('[PDF Generation] ✅ SUCCESS - PDF downloaded');

    } catch (error: any) {
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('[PDF Generation] ❌ FAILED');
      console.error('[PDF Generation] Error type:', error.constructor.name);
      console.error('[PDF Generation] Error message:', error.message);
      console.error('[PDF Generation] Full error:', error);
      console.error('[PDF Generation] Stack trace:', error.stack);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Log detailed error information for debugging
      if (import.meta.env.DEV) {
        console.error('[PDF Generation] Detailed error:', {
          message: error.message,
          type: error.constructor.name
        });
      }
    } finally {
      setGeneratingPdf(false);
      console.log('[PDF Generation] State updated: generatingPdf = false');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
  };

  const handleGenerateHTML = async () => {
    if (!id) {
      console.error('[HTML Generation] No inspection ID provided');
      return;
    }
    
    if (inspection?.status !== 'completed') {
      console.error('[HTML Generation] Inspection not completed:', inspection?.status);
      return;
    }

    setGeneratingHtml(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        'generate-inspection-html',
        {
          body: { inspectionId: id }
        }
      );

      if (error) {
        throw new Error(error.message || 'Failed to generate HTML');
      }

      if (!data?.html) {
        throw new Error('No HTML content received');
      }

      const html = data.html;
      const filename = `inspection-report-${inspection?.organization || 'report'}-${new Date().toISOString().split('T')[0]}.html`;
      const title = `Inspection Report - ${inspection?.organization || 'Report'}`;

      // Try to open in new window (desktop)
      const opened = openHtmlReport({ html, filename, title });

      // If failed (mobile/PWA/popup blocked), use in-app viewer
      if (!opened) {
        setReportHtml(html);
        setHtmlViewerOpen(true);
      } else if (import.meta.env.DEV) {
        console.log('[HTML Generation] Report opened successfully');
      }
    } catch (error: any) {
      console.error('HTML generation error:', error);
    } finally {
      setGeneratingHtml(false);
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
      {/* Offline Mode Banner */}
      {!isOnline && (
        <div className="bg-orange-500/10 border-b border-orange-500/20">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <CloudOff className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-orange-900 dark:text-orange-100">
                  You're working offline
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">
                  Changes will be saved locally and synced when you're back online
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      
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
                <Save className={isMobileView ? "w-4 h-4" : "w-4 h-4 mr-2"} />
                {!isMobileView && (saving ? "Saving..." : isOnline ? "Save Progress" : "Save Locally")}
                {isMobileView && saving && "..."}
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
              {inspection?.status === 'completed' && (
                <>
                  {/* PDF Button - Hidden but code preserved for future use
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleGeneratePDF} 
                            disabled={generatingPdf || !isOnline}
                          >
                            {generatingPdf ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="hidden md:inline ml-2">Generating...</span>
                              </>
                            ) : (
                              <>
                                <FileText className="w-4 h-4" />
                                <span className="hidden md:inline ml-2">Generate PDF</span>
                              </>
                            )}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!isOnline && (
                        <TooltipContent>Must be online to generate PDF</TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                  */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleGenerateHTML} 
                            disabled={generatingHtml || !isOnline}
                          >
                            {generatingHtml ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="hidden md:inline ml-2">Generating...</span>
                              </>
                            ) : (
                              <>
                                <FileText className="w-4 h-4" />
                                <span className="hidden md:inline ml-2">Generate Report</span>
                              </>
                            )}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!isOnline && (
                        <TooltipContent>Must be online to generate report</TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {!isOnline && (
          <Alert className="mb-6 border-warning bg-warning/10">
            <CloudOff className="h-4 w-4 text-warning" />
            <AlertDescription className="text-gray-900 dark:text-gray-100">
              📴 Working offline - data will sync when online
            </AlertDescription>
          </Alert>
        )}

        <InspectionHeader 
          inspection={inspection}
          userProfile={userProfile}
          onUpdate={handleHeaderUpdate} 
          onImmediateSave={triggerImmediateSave} 
        />

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-6 mt-6">
          <div ref={swipeContainerRef}>
            <TabsList className="grid grid-cols-2 lg:grid-cols-4 w-full gap-2 h-auto p-2">
              <TabsTrigger value="details" className="h-11">{isMobileView ? "Systems" : "Systems - Ziplines"}</TabsTrigger>
              <TabsTrigger value="equipment" className="h-11">Equipment</TabsTrigger>
              <TabsTrigger value="standards" className="h-11">{isMobileView ? "Criteria" : "Operations Criteria"}</TabsTrigger>
              <TabsTrigger value="summary" className="h-11">Summary</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="details" className="space-y-6">
            <OperatingSystemsTable systems={systems} onUpdate={setSystems} onImmediateSave={triggerImmediateSave} />
            <ZiplinesTable ziplines={ziplines} onUpdate={setZiplines} onImmediateSave={triggerImmediateSave} />
            
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
              onImmediateSave={triggerImmediateSave}
            />
            <EquipmentTable
              category="helmets"
              displayName="Helmets"
              equipment={equipment}
              onUpdate={setEquipment}
              onImmediateSave={triggerImmediateSave}
            />
            <EquipmentTable
              category="lanyards"
              displayName="Lanyards"
              equipment={equipment}
              onUpdate={setEquipment}
              onImmediateSave={triggerImmediateSave}
            />
            <EquipmentTable
              category="connectors"
              displayName="Connectors (Carabiners & Quicklinks)"
              equipment={equipment}
              onUpdate={setEquipment}
              onImmediateSave={triggerImmediateSave}
            />
            <EquipmentTable
              category="rope"
              displayName="Kernmantle Rope"
              equipment={equipment}
              onUpdate={setEquipment}
              onImmediateSave={triggerImmediateSave}
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
            <SummarySection 
              summary={summary} 
              onUpdate={setSummary} 
              onImmediateSave={triggerImmediateSave}
              onRegenerate={handleRegenerateSummary}
            />
            
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

      <HtmlReportViewer
        html={reportHtml}
        title={`Inspection Report - ${inspection?.organization || 'Report'}`}
        filename={`inspection-report-${inspection?.organization || 'report'}-${new Date().toISOString().split('T')[0]}.html`}
        isOpen={htmlViewerOpen}
        onClose={() => setHtmlViewerOpen(false)}
      />

      {/* Mobile FAB */}
      <FloatingActionButton
        primaryAction={{
          icon: <Save className="h-6 w-6" />,
          label: "Save",
          onClick: saveProgress,
          loading: saving,
          disabled: saving,
        }}
        secondaryActions={
          isOnline && !saving
            ? [
                {
                  icon: <Check className="h-5 w-5" />,
                  label: "Complete",
                  onClick: completeInspection,
                  disabled: saving,
                  variant: "success" as const,
                },
              ]
            : []
        }
      />
    </div>
  );
}
