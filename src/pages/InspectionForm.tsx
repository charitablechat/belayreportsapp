import { useEffect, useState, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Save, CheckCircle, Loader2, WifiOff, CloudOff, LogOut, User, FileText, Settings, Package, ClipboardList, FileCheck, RefreshCw } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AutoSaveIndicator } from "@/components/AutoSaveIndicator";
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
import { cn } from "@/lib/utils";
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
import { SwipeBackIndicator } from "@/components/SwipeBackIndicator";

import { Check } from "lucide-react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useSaveShortcut } from "@/hooks/useKeyboardShortcuts";
import { useEmptyReportCleanup } from "@/hooks/useEmptyReportCleanup";

export default function InspectionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const { triggerSync, isSyncing } = usePWA();
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
  const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wasOfflineRef = useRef(!isOnline);
  const autoRetryingRef = useRef(false);
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
  
  // Swipe navigation for mobile (swipe right on first tab navigates back)
  const isFirstTab = currentTab === tabOrder[0];
  const { containerRef: swipeContainerRef, swipeState } = useSwipeNavigation({
    enabled: isMobileView,
    isFirstTab,
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
      } else if (currentIndex === 0) {
        navigate('/dashboard');
      }
    },
  });

  // Unsaved changes protection
  const { isBlocked, confirmNavigation, cancelNavigation } = useUnsavedChanges({
    hasUnsavedChanges,
    message: "You have unsaved changes to this inspection. Are you sure you want to leave?",
  });

  // Empty report cleanup
  const { cleanupEmptyReport } = useEmptyReportCleanup({
    type: 'inspection',
    id,
    status: inspection?.status,
    data: inspection,
    relatedData: {
      systems,
      ziplines,
      equipment,
      standards,
      summary,
    }
  });

  // Cleanup empty reports on unmount
  useEffect(() => {
    return () => {
      if (inspection?.status === 'draft') {
        cleanupEmptyReport();
      }
    };
  }, [inspection?.status, cleanupEmptyReport]);

  // Auto-retry sync when network reconnects after a failure
  // Use a ref for the retry function to avoid stale closures
  const autoRetrySyncRef = useRef<(() => Promise<void>) | null>(null);
  
  useEffect(() => {
    // Track if we were offline
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }
    
    // If we just came back online and there's a pending save error, auto-retry
    if (wasOfflineRef.current && saveError && !autoRetryingRef.current && !saving && !autoSaving) {
      wasOfflineRef.current = false;
      autoRetryingRef.current = true;
      
      console.log('[InspectionForm] Network reconnected, auto-retrying sync...');
      
      // Small delay to let network stabilize
      const retryTimeout = setTimeout(async () => {
        try {
          await triggerSync();
          
          // Call the ref'd retry function if available
          if (autoRetrySyncRef.current) {
            await autoRetrySyncRef.current();
          }
          
          toast({
            title: "Auto-sync successful",
            description: "Your changes have been synced after reconnecting.",
          });
        } catch (err) {
          console.error('[InspectionForm] Auto-retry sync failed:', err);
          // Keep the error state, user can manually retry
        } finally {
          autoRetryingRef.current = false;
        }
      }, 2000);
      
      return () => clearTimeout(retryTimeout);
    }
  }, [isOnline, saveError, saving, autoSaving, triggerSync]);

  const saveRef = useRef<(() => void) | null>(null);
  useSaveShortcut(() => saveRef.current?.(), hasUnsavedChanges && !saving);
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
      
      // Clear existing debounce timer using ref
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
      
      // Set new debounce timer for 3 seconds
      saveDebounceTimerRef.current = setTimeout(() => {
        autoSaveProgress();
      }, 3000);
    }
  }, [systems, ziplines, equipment, standards, summary]);

  // Auto-save interval (every 10 seconds as backup)
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      if (hasUnsavedChanges && !saving && !autoSaving) {
        autoSaveProgress();
      }
    }, 10000);

    return () => {
      clearInterval(autoSaveInterval);
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
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
          .select("*, inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name, avatar_url)")
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
      // Verify user is authenticated before saving
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }
      
      // Preserve original inspector_id - only update timestamp
      const inspectionToSave = {
        ...inspection,
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

      // Timeout wrapper for offline storage operations
      const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
          )
        ]);
      };

      // Save to offline storage with timeout protection
      try {
        await withTimeout(
          Promise.all([
            saveInspectionOffline(inspectionToSave),
            saveRelatedDataOffline('systems', id!, validSystems),
            saveRelatedDataOffline('ziplines', id!, validZiplines),
            saveRelatedDataOffline('equipment', id!, validEquipment),
            saveRelatedDataOffline('standards', id!, standards),
            saveRelatedDataOffline('summary', id!, [summary]),
          ]),
          5000,
          'Offline storage save'
        );
        setInspection(inspectionToSave);
        console.log('[InspectionForm Save] Offline storage completed');
      } catch (offlineError) {
        console.warn('[InspectionForm Save] Offline storage failed or timed out:', offlineError);
        // Continue with online save - don't block
        setInspection(inspectionToSave);
      }

      if (import.meta.env.DEV) {
        console.log('[InspectionForm] Saved all data to offline storage');
      }
      
      // Clear any previous save errors
      setSaveError(null);

      // If online, sync to Supabase with retry logic
      if (isOnline) {
        const syncWithRetry = async (retries = 2): Promise<void> => {
          try {
            // Sanitize inspection data - remove joined/computed fields and handle nulls
            const sanitizeInspection = (insp: any) => {
              const { id, inspector, ...rest } = insp; // Remove id and inspector (joined relation)
              return {
                ...rest,
                previous_inspection_date: rest.previous_inspection_date === "" ? null : rest.previous_inspection_date,
              };
            };

            // Update main inspection record
            const { error: inspectionError } = await supabase
              .from("inspections")
              .update(sanitizeInspection(inspectionToSave))
              .eq("id", id);
            
            if (inspectionError) {
              console.error('[InspectionForm Sync] Failed to update inspection:', inspectionError);
              throw inspectionError;
            }
            
            // Batch upsert systems - separate new items from existing
            const existingSystems = validSystems.filter(s => s.id && !s.id.startsWith('temp-'));
            const newSystems = validSystems.filter(s => !s.id || s.id.startsWith('temp-'));
            
            if (existingSystems.length > 0) {
              const { error: systemsError } = await supabase
                .from("inspection_systems")
                .upsert(existingSystems.map(s => ({ ...s, inspection_id: id })), { onConflict: 'id' });
              if (systemsError) {
                console.error('[InspectionForm Sync] Failed to upsert systems:', systemsError);
                throw systemsError;
              }
            }
            
            if (newSystems.length > 0) {
              const { data: insertedSystems, error: newSystemsError } = await supabase
                .from("inspection_systems")
                .insert(newSystems.map(s => {
                  const { id: tempId, ...systemData } = s;
                  return { ...systemData, inspection_id: id };
                }))
                .select();
              
              if (newSystemsError) {
                console.error('[InspectionForm Sync] Failed to insert new systems:', newSystemsError);
                throw newSystemsError;
              }
              
              // Update local state with new IDs
              if (insertedSystems) {
                setSystems(prev => {
                  const updated = [...prev];
                  newSystems.forEach((oldSystem, index) => {
                    const newId = insertedSystems[index]?.id;
                    if (newId) {
                      const foundIndex = updated.findIndex(s => s.id === oldSystem.id);
                      if (foundIndex !== -1) {
                        updated[foundIndex] = { ...updated[foundIndex], id: newId };
                      }
                    }
                  });
                  return updated;
                });
              }
            }

            // Batch upsert ziplines - separate new items from existing
            const existingZiplines = validZiplines.filter(z => z.id && !z.id.startsWith('temp-'));
            const newZiplines = validZiplines.filter(z => !z.id || z.id.startsWith('temp-'));
            
            if (existingZiplines.length > 0) {
              const { error: ziplinesError } = await supabase
                .from("inspection_ziplines")
                .upsert(existingZiplines.map(z => ({ ...z, inspection_id: id })), { onConflict: 'id' });
              if (ziplinesError) {
                console.error('[InspectionForm Sync] Failed to upsert ziplines:', ziplinesError);
                throw ziplinesError;
              }
            }
            
            if (newZiplines.length > 0) {
              const { data: insertedZiplines, error: newZiplinesError } = await supabase
                .from("inspection_ziplines")
                .insert(newZiplines.map(z => {
                  const { id: tempId, ...ziplineData } = z;
                  return { ...ziplineData, inspection_id: id };
                }))
                .select();
              
              if (newZiplinesError) {
                console.error('[InspectionForm Sync] Failed to insert new ziplines:', newZiplinesError);
                throw newZiplinesError;
              }
              
              if (insertedZiplines) {
                setZiplines(prev => {
                  const updated = [...prev];
                  newZiplines.forEach((oldZipline, index) => {
                    const newId = insertedZiplines[index]?.id;
                    if (newId) {
                      const foundIndex = updated.findIndex(z => z.id === oldZipline.id);
                      if (foundIndex !== -1) {
                        updated[foundIndex] = { ...updated[foundIndex], id: newId };
                      }
                    }
                  });
                  return updated;
                });
              }
            }

            // Batch upsert equipment - separate new items from existing
            const existingEquipment = validEquipment.filter(e => e.id && !e.id.startsWith('temp-'));
            const newEquipment = validEquipment.filter(e => !e.id || e.id.startsWith('temp-'));
            
            if (existingEquipment.length > 0) {
              const { error: equipmentError } = await supabase
                .from("inspection_equipment")
                .upsert(existingEquipment.map(e => ({ ...e, inspection_id: id })), { onConflict: 'id' });
              if (equipmentError) {
                console.error('[InspectionForm Sync] Failed to upsert equipment:', equipmentError);
                throw equipmentError;
              }
            }
            
            if (newEquipment.length > 0) {
              const { data: insertedEquipment, error: newEquipmentError } = await supabase
                .from("inspection_equipment")
                .insert(newEquipment.map(e => {
                  const { id: tempId, ...equipmentData } = e;
                  return { ...equipmentData, inspection_id: id };
                }))
                .select();
              
              if (newEquipmentError) {
                console.error('[InspectionForm Sync] Failed to insert new equipment:', newEquipmentError);
                throw newEquipmentError;
              }
              
              if (insertedEquipment) {
                setEquipment(prev => {
                  const updated = [...prev];
                  newEquipment.forEach((oldEquip, index) => {
                    const newId = insertedEquipment[index]?.id;
                    if (newId) {
                      const foundIndex = updated.findIndex(e => e.id === oldEquip.id);
                      if (foundIndex !== -1) {
                        updated[foundIndex] = { ...updated[foundIndex], id: newId };
                      }
                    }
                  });
                  return updated;
                });
              }
            }

            // Upsert standards - delete old then insert new
            await supabase.from("inspection_standards").delete().eq("inspection_id", id);
            const standardsToInsert = standards.map(s => {
              const { id: stdId, ...standardData } = s;
              return { ...standardData, inspection_id: id };
            });
            const { error: standardsError } = await supabase
              .from("inspection_standards")
              .insert(standardsToInsert);
            if (standardsError) {
              console.error('[InspectionForm Sync] Failed to save standards:', standardsError);
              throw standardsError;
            }

            // Save or update summary
            const sanitizeSummary = (sum: any) => ({
              ...sum,
              next_inspection_date: sum.next_inspection_date === "" ? null : sum.next_inspection_date
            });

            const { error: summaryError } = await supabase
              .from("inspection_summary")
              .upsert(sanitizeSummary({ ...summary, inspection_id: id }), { onConflict: 'inspection_id' });
            
            if (summaryError) {
              console.error('[InspectionForm Sync] Failed to save summary:', summaryError);
              throw summaryError;
            }

            // Mark as synced
            await saveInspectionOffline({
              ...inspectionToSave,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            console.log('[InspectionForm Sync] Synced all data to Supabase successfully');
          } catch (error: any) {
            // Detect network-related errors for retry
            const isNetworkError = 
              error?.message?.toLowerCase().includes('network') ||
              error?.message?.toLowerCase().includes('fetch') ||
              error?.message?.toLowerCase().includes('failed to fetch') ||
              error?.message?.toLowerCase().includes('connection') ||
              error?.message?.toLowerCase().includes('timeout') ||
              error?.code === 'NETWORK_ERROR' ||
              error?.code === 'ECONNREFUSED' ||
              error?.name === 'TypeError' || // Often thrown on network failures
              !navigator.onLine;
            
            if (retries > 0 && isNetworkError) {
              const delay = Math.pow(2, 3 - retries) * 1000; // Exponential backoff: 2s, 4s
              console.log(`[InspectionForm Sync] Network error, retrying in ${delay}ms... (${retries} attempts left)`);
              await new Promise(resolve => setTimeout(resolve, delay));
              return syncWithRetry(retries - 1);
            }
            throw error;
          }
        };

        try {
          await syncWithRetry(3); // 3 retries with exponential backoff
        } catch (error: any) {
          console.error('[InspectionForm Sync] Failed after retries:', error);
          setSaveError('Failed to sync online - saved locally');
          // Queue for later sync
          await queueOperation('update', id!, saveData);
          console.log('[InspectionForm Sync] Queued for later sync');
          
          // Show toast for network failures with auto-retry hint
          toast({
            title: "Sync queued",
            description: "Changes saved locally. Will auto-retry when connection improves.",
            variant: "default",
          });
        }
      } else {
        // Queue operation when offline
        await queueOperation('update', id!, saveData);
        console.log('[InspectionForm Sync] Queued for sync when online');
      }
    } catch (error: any) {
      console.error('[InspectionForm] Save error:', error);
      setSaveError(error.message || 'Failed to save');
      throw error;
    }
  };

  const triggerImmediateSave = async () => {
    if (saving || autoSaving) return;
    
    // Clear existing debounce timer using ref
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
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

  // Track if save is in progress to prevent duplicate calls
  const saveInProgressRef = useRef(false);

  const saveProgress = async () => {
    // Prevent duplicate save calls
    if (saveInProgressRef.current) {
      console.log('[InspectionForm] Save already in progress, skipping');
      return;
    }

    console.log('[InspectionForm] Starting save...');
    saveInProgressRef.current = true;
    setSaving(true);
    setSaveError(null);

    // Safety timeout - ensure saving state is cleared after max 30 seconds
    const safetyTimeout = setTimeout(() => {
      console.warn('[InspectionForm] Safety timeout reached, forcing save state reset');
      setSaving(false);
      saveInProgressRef.current = false;
    }, 30000);

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
      clearTimeout(safetyTimeout);
      console.log('[InspectionForm] Completed, setting saving to false');
      setSaving(false);
      saveInProgressRef.current = false;
    }
  };

  // Set save ref for keyboard shortcut
  useEffect(() => {
    saveRef.current = saveProgress;
  });

  // Set auto-retry sync function ref for network reconnection
  useEffect(() => {
    autoRetrySyncRef.current = async () => {
      setSaveError(null);
      setAutoSaving(true);
      try {
        await performSave(true);
        setLastSaved(new Date());
        setHasUnsavedChanges(false);
      } finally {
        setAutoSaving(false);
      }
    };
  });

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
    <>
      <UnsavedChangesDialog
        isOpen={isBlocked}
        onConfirm={confirmNavigation}
        onCancel={cancelNavigation}
        message="You have unsaved changes to this inspection. Are you sure you want to leave?"
      />
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
              {saveError && isOnline && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setSaveError(null);
                    try {
                      await triggerSync();
                      await saveProgress();
                      toast({
                        title: "Sync successful",
                        description: "Your changes have been synced to the server.",
                      });
                    } catch (err) {
                      console.error('[InspectionForm] Manual sync failed:', err);
                      toast({
                        title: "Sync failed",
                        description: "Please try again or check your connection.",
                        variant: "destructive",
                      });
                    }
                  }}
                  disabled={saving || autoSaving || isSyncing}
                  className="gap-1.5 text-xs h-7 bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-900/40"
                >
                  <RefreshCw className={cn("w-3 h-3", isSyncing && "animate-spin")} />
                  <span className="hidden sm:inline">Sync Now</span>
                </Button>
              )}
              <SyncStatusIndicator />
              <AutoSaveIndicator
                lastSaved={lastSaved}
                isSaving={autoSaving}
                hasUnsavedChanges={hasUnsavedChanges}
                error={saveError}
                className="hidden sm:flex"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size={isMobileView ? "default" : "sm"} 
                onClick={saveProgress} 
                disabled={saving || autoSaving}
              >
                <Save className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                {isMobileView ? (saving ? "..." : "Save") : (saving ? "Saving..." : isOnline ? "Save Progress" : "Save Locally")}
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button 
                        size={isMobileView ? "default" : "sm"} 
                        onClick={completeInspection} 
                        disabled={saving || autoSaving || !isOnline}
                        className={isMobileView ? "min-w-[100px] h-10 text-sm font-medium" : ""}
                      >
                        <CheckCircle className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4"} />
                        <span className={isMobileView ? "inline" : "hidden md:inline md:ml-2"}>Complete</span>
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

        {/* Swipe back indicator for mobile */}
        {isMobileView && isFirstTab && (
          <SwipeBackIndicator 
            progress={swipeState.swipeProgress} 
            isActive={swipeState.isSwipingBack} 
          />
        )}

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-6 mt-6">
          <div ref={swipeContainerRef}>
            <TabsList className="grid grid-cols-2 lg:grid-cols-4 w-full gap-1 lg:gap-0 h-auto p-1.5 lg:p-1">
              <TabsTrigger value="details" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                <span>{isMobileView ? "Systems" : "Systems - Ziplines"}</span>
              </TabsTrigger>
              <TabsTrigger value="equipment" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Package className="h-3.5 w-3.5" />
                <span>Equipment</span>
              </TabsTrigger>
              <TabsTrigger value="standards" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" />
                <span>{isMobileView ? "Criteria" : "Operations Criteria"}</span>
              </TabsTrigger>
              <TabsTrigger value="summary" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <FileCheck className="h-3.5 w-3.5" />
                <span>Summary</span>
              </TabsTrigger>
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

      </div>
    </>
  );
}
