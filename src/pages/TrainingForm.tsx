import { useEffect, useState, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isLocalDataNewer } from "@/lib/local-data-guards";
import { useParams, useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { emitSyncComplete, markPendingDashboardRefresh } from "@/lib/sync-events";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, FileDown, FileText, ChevronLeft, WifiOff, Wifi, Mail, CheckCircle, Info, Users, Settings, AlertTriangle, ClipboardCheck, FileCheck, LogOut, User, CloudOff, ArrowLeft, Camera, RefreshCw, HardDrive } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutoSaveIndicator } from "@/components/AutoSaveIndicator";
import { useActiveTimer } from "@/hooks/useActiveTimer";
import { ActiveTimerDisplay } from "@/components/ActiveTimerDisplay";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import TrainingHeader from "@/components/training/TrainingHeader";
import DeliveryApproachSection from "@/components/training/DeliveryApproachSection";
import OperatingSystemsSection from "@/components/training/OperatingSystemsSection";
import ImmediateAttentionSection from "@/components/training/ImmediateAttentionSection";
import VerifiableItemsSection from "@/components/training/VerifiableItemsSection";
import TrainingSummarySection from "@/components/training/TrainingSummarySection";
import PhotoCapture from "@/components/PhotoCapture";
import PhotoGallery from "@/components/PhotoGallery";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useStorageHealthCheck } from "@/hooks/useStorageHealthCheck";
import { format } from "date-fns";
import { 
  getOfflineTraining, 
  saveTrainingOffline, 
  getTrainingDataOffline,
  saveTrainingDataOffline,
  queueTrainingOperation 
} from "@/lib/offline-storage";
import { HtmlReportViewer } from "@/components/HtmlReportViewer";
import { openHtmlReport } from "@/lib/html-report-viewer";
import { triggerCompletionConfetti } from "@/lib/confetti";
import { triggerHaptic } from "@/lib/haptics";
import { useReportSync } from "@/hooks/useReportSync";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SwipeBackIndicator } from "@/components/SwipeBackIndicator";
// UserProfileDropdown moved to AuthenticatedHeader (global)
import { useQuery } from "@tanstack/react-query";

import { Check } from "lucide-react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useSaveShortcut } from "@/hooks/useKeyboardShortcuts";
import { useReportEditPermission } from "@/hooks/useReportEditPermission";
import { CompletionLockDialog } from "@/components/CompletionLockDialog";
import { SaveBeforeLeaveDialog } from "@/components/SaveBeforeLeaveDialog";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { reconcileAllChildTables } from "@/lib/sync-reconciliation";
import { useEmergencySave } from "@/hooks/useEmergencySave";
import { saveReportSnapshot, getReportSnapshot, markSnapshotSynced, downloadReportBackup } from "@/lib/local-backup-ledger";
import { onCloudBackupError } from "@/lib/cloud-backup";
import { appendVersion } from "@/lib/report-version-manager";
import { showHardSavedToast } from "@/lib/toast-helpers";
import { DataIntegrityBadge, type IntegrityStatus } from "@/components/ui/data-integrity-badge";
import { VersionHistoryPanel } from "@/components/admin/VersionHistoryPanel";
import { Shield as ShieldIcon } from "lucide-react";

export default function TrainingForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const isMobile = useIsMobile();
  const { syncReport } = useReportSync(id, 'training');
  const storageUnavailable = useStorageHealthCheck();
  
  // Check edit permissions - Super Admins are view-only, only owners can edit
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const { canEdit, isReadOnly, isOwner, isSuperAdmin, readOnlyReason } = useReportEditPermission({
    inspectorId,
    reportType: 'training'
  });
  
  // Completion lock: prevent accidental edits to completed reports
  const [completionLockOverridden, setCompletionLockOverridden] = useState(false);
  const [showCompletionLockDialog, setShowCompletionLockDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const leavingRef = useRef(false);
  const [isSavingBeforeLeave, setIsSavingBeforeLeave] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isGeneratingHTML, setIsGeneratingHTML] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [lastManuallySaved, setLastManuallySaved] = useState<Date | null>(null);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailForm, setEmailForm] = useState({
    recipientEmail: '',
    recipientName: '',
    message: ''
  });
  const [training, setTraining] = useState<any>(null);
  const [deliveryApproaches, setDeliveryApproaches] = useState<any[]>([]);
  const [operatingSystems, setOperatingSystems] = useState<any[]>([]);
  const [immediateAttention, setImmediateAttention] = useState<any[]>([]);
  const [verifiableItems, setVerifiableItems] = useState<any[]>([]);
  const [systemsInPlace, setSystemsInPlace] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  // Completion lock derived values (after report state is declared)
  const isCompletionLocked = training?.status === 'completed' && !completionLockOverridden;
  // Active-usage timer: only tracks time when user is actively editing
  // DISABLED: Timer fully disabled — set enabled: false to stop all background tracking
  const { elapsedSeconds, isActive: timerActive, isPaused: timerPaused, getElapsedSeconds } = useActiveTimer({
    initialSeconds: training?.active_duration_seconds || 0,
    enabled: false, // was: canEdit && !isReadOnly && !isCompletionLocked && !isSuperAdmin
  });

  const effectiveReadOnly = isReadOnly || isCompletionLocked;
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [lastVersionNumber, setLastVersionNumber] = useState<number | undefined>(undefined);
  const [lastFieldCount, setLastFieldCount] = useState<number | undefined>(undefined);

  // Field-level click interception for locked reports (allow-list: only block editable elements)
  const handleLockedFieldClick = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    if (!isCompletionLocked) return;
    const target = e.target as HTMLElement;

    // Only intercept clicks on editable/interactive form elements
    const isEditable = target.closest(
      'input, textarea, select, [contenteditable="true"], ' +
      '[role="combobox"], [role="listbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], ' +
      'button, .tiptap, .ProseMirror'
    );

    // Allow tab navigation in locked mode
    const isTabTrigger = target.closest('[role="tab"]');
    if (!isEditable || isTabTrigger) return; // Allow all non-editable interactions (scroll, expand, copy, navigate)

    e.preventDefault();
    e.stopPropagation();
    setShowCompletionLockDialog(true);
  }, [isCompletionLocked]);

  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const isInternalUpdateRef = useRef(false);
  const summaryAutoPopulatedRef = useRef(false);

  // Track which child data types loaded successfully (not from timeout fallback)
  const childDataLoadedRef = useRef<Record<string, boolean>>({
    delivery_approaches: false,
    operating_systems: false,
    immediate_attention: false,
    verifiable_items: false,
    systems_in_place: false,
    summary: false,
  });
  const [htmlViewerOpen, setHtmlViewerOpen] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [inspectorProfile, setInspectorProfile] = useState<any>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [modifiedByProfile, setModifiedByProfile] = useState<any>(null);
  // signingOut removed — sign-out handled by global AuthenticatedHeader
  
  // Tab navigation state
  const [currentTab, setCurrentTab] = useState("info");
  const tabOrder = ["info", "delivery", "systems", "attention", "verifiable", "summary", "photos"];
  
  // Swipe navigation for mobile (swipe right on first tab navigates back)
  const isFirstTab = currentTab === tabOrder[0];
  const { containerRef: swipeContainerRef, swipeState } = useSwipeNavigation({
    enabled: isMobile,
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
        setShowLeaveDialog(true);
      }
    },
  });

  // Save-before-leave handler: flushes debounce and performs immediate save
  // Use a ref for the save function to avoid stale closure in useCallback([], [])
  const saveTrainingRef = useRef<() => Promise<void>>();
  const saveBeforeLeaveRef = useRef<(() => Promise<void>) | null>(null);
  const handleSaveAndLeave = useCallback(async () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    try {
      await saveTrainingRef.current?.();
      setHasUnsavedChanges(false);
      console.log('[TrainingForm] Save-before-leave completed');
    } catch (e) {
      console.warn('[TrainingForm] Save-before-leave failed:', e);
    }
  }, []);
  saveBeforeLeaveRef.current = handleSaveAndLeave;

  // Unsaved changes protection
  const { isBlocked, confirmNavigation, cancelNavigation, saveAndLeave } = useUnsavedChanges({
    hasUnsavedChanges: hasUnsavedChanges && (training?.status !== 'completed' || completionLockOverridden) && !leavingRef.current,
    message: "You have unsaved changes to this training report. Are you sure you want to leave?",
    onSaveAndLeave: async () => { await saveBeforeLeaveRef.current?.(); },
  });

  // Emergency save on page hide/refresh (Vector 1: zero-data-loss)
  // Note: uses autoSaveTimer (declared above) since saveDebounceTimerRef is declared later
  useEmergencySave({
    hasUnsavedChanges,
    saving: isSaving,
    saveDebounceTimerRef: autoSaveTimer,
    performSaveRef: saveTrainingRef as React.MutableRefObject<((silent?: boolean) => Promise<void>) | undefined>,
    formName: 'TrainingForm',
    onEmergencySnapshot: () => {
      if (training && id) {
        // Include photo metadata (IDs, captions) but NOT blobs
        import('@/lib/offline-storage').then(({ getOfflinePhotos }) => {
          getOfflinePhotos(id).then(photos => {
            const photoMeta = photos.map((p: any) => ({
              id: p.id,
              caption: p.caption,
              photo_section: p.section,
              display_order: p.display_order,
              uploaded: p.uploaded,
            }));
            saveReportSnapshot('training', id, training, {
              delivery_approaches: deliveryApproaches,
              operating_systems: operatingSystems,
              immediate_attention: immediateAttention,
              verifiable_items: verifiableItems,
              systems_in_place: systemsInPlace,
              summary: summary ? [summary] : [],
            }, !!training.synced_at, photoMeta);
          }).catch(() => {
            saveReportSnapshot('training', id, training, {
              delivery_approaches: deliveryApproaches,
              operating_systems: operatingSystems,
              immediate_attention: immediateAttention,
              verifiable_items: verifiableItems,
              systems_in_place: systemsInPlace,
              summary: summary ? [summary] : [],
            }, !!training.synced_at);
          });
        });
      }
    },
  });

  // Auto-retry on network reconnect is now handled by useAutoSync hook

  // Fetch current user with offline fallback
  useEffect(() => {
    const fetchUser = async () => {
      let user = await getUserWithCache();
      if (!user && !navigator.onLine) {
        const offlineId = getOfflineUserId();
        if (offlineId) user = { id: offlineId } as any;
      }
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  // Fetch inspector profile (the report owner, not current user)
  useEffect(() => {
    const fetchInspectorProfile = async () => {
      if (!inspectorId || !navigator.onLine) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_url, first_name, last_name')
        .eq('id', inspectorId)
        .single();
      setInspectorProfile(profile);
    };
    fetchInspectorProfile();
  }, [inspectorId]);

  // Fetch current logged-in user's profile (for avatar dropdown)
  useEffect(() => {
    const fetchCurrentUserProfile = async () => {
      if (!currentUser?.id || !navigator.onLine) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', currentUser.id)
        .maybeSingle();
      
      setCurrentUserProfile(profile);
    };
    
    fetchCurrentUserProfile();
  }, [currentUser?.id]);

  // Fetch modified-by profile (who last modified the report, if different from owner)
  useEffect(() => {
    const fetchModifiedByProfile = async () => {
      if (!training?.last_modified_by || !navigator.onLine) return;
      // Only fetch if modifier is different from the owner
      if (training.last_modified_by === training.inspector_id) {
        setModifiedByProfile(null);
        return;
      }
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', training.last_modified_by)
        .maybeSingle();
      
      setModifiedByProfile(profile);
    };
    
    fetchModifiedByProfile();
  }, [training?.last_modified_by, training?.inspector_id]);

  // handleSignOut removed — sign-out handled by global AuthenticatedHeader
  // Emergency save via useEmergencySave handles data preservation on navigation

  // Keyboard shortcut for save (Ctrl/Cmd+S)
  useSaveShortcut(() => saveTraining(), hasUnsavedChanges && !isSaving);

  // Auto-populate person submitting (from report creator) and submission date
  useEffect(() => {
    if (!summary || isLoading || !inspectorProfile || summaryAutoPopulatedRef.current) return;

    const updates: any = {};

    if (!summary.person_submitting) {
      const fullName = [inspectorProfile.first_name, inspectorProfile.last_name]
        .filter(Boolean)
        .join(' ');
      if (fullName) {
        updates.person_submitting = fullName;
      }
    }

    if (!summary.submission_date) {
      updates.submission_date = format(new Date(), 'yyyy-MM-dd');
    }

    if (Object.keys(updates).length > 0) {
      isInternalUpdateRef.current = true;
      setSummary({ ...summary, ...updates });
    }

    summaryAutoPopulatedRef.current = true;
  }, [summary?.id, isLoading, inspectorProfile]);

  // Load training data
  useEffect(() => {
    const loadTraining = async () => {
      if (!id) return;

      try {
        // Try loading from offline storage first
        const offlineTraining = await getOfflineTraining(id);
        const [
          delivery_approaches,
          operating_systems,
          immediate_attention,
          verifiable_items,
          systems_in_place,
          summaryData
        ] = await Promise.all([
          getTrainingDataOffline('delivery_approaches', id),
          getTrainingDataOffline('operating_systems', id),
          getTrainingDataOffline('immediate_attention', id),
          getTrainingDataOffline('verifiable_items', id),
          getTrainingDataOffline('systems_in_place', id),
          getTrainingDataOffline('summary', id).then(d => d[0])
        ]);

        if (offlineTraining) {
          isInternalUpdateRef.current = true;
          setTraining(offlineTraining);
          setInspectorId(offlineTraining.inspector_id);
          // Track successful loads — arrays with data came from real IndexedDB reads
          if (delivery_approaches && delivery_approaches.length > 0) childDataLoadedRef.current.delivery_approaches = true;
          if (operating_systems && operating_systems.length > 0) childDataLoadedRef.current.operating_systems = true;
          if (immediate_attention && immediate_attention.length > 0) childDataLoadedRef.current.immediate_attention = true;
          if (verifiable_items && verifiable_items.length > 0) childDataLoadedRef.current.verifiable_items = true;
          if (systems_in_place && systems_in_place.length > 0) childDataLoadedRef.current.systems_in_place = true;
          if (summaryData) childDataLoadedRef.current.summary = true;
          setDeliveryApproaches(delivery_approaches || []);
          setOperatingSystems(operating_systems || []);
          setImmediateAttention(immediate_attention || []);
          setVerifiableItems(verifiable_items || []);
          setSystemsInPlace(systems_in_place || []);
          // Initialize summary with a proper UUID if not exists
          setSummary(summaryData || { 
            id: crypto.randomUUID(),
            training_id: id 
          });
        } else if (!id.startsWith('temp-')) {
          // Finding 6: Auto-restore from localStorage backup if IndexedDB was evicted
          const backup = getReportSnapshot('training', id);
          if (backup) {
            console.log('[TrainingForm] IndexedDB empty but localStorage backup found — auto-restoring');
            isInternalUpdateRef.current = true;
            const { saveTrainingOffline, saveTrainingDataOffline } = await import('@/lib/offline-storage');
            saveTrainingOffline(backup.parent).catch(() => {});
            setTraining(backup.parent);
            setInspectorId(backup.parent.inspector_id);
            if (backup.children) {
              for (const [childType, childData] of Object.entries(backup.children)) {
                if (Array.isArray(childData) && childData.length > 0) {
                  saveTrainingDataOffline(childType as any, id, childData).catch(() => {});
                  if (childType in childDataLoadedRef.current) {
                    childDataLoadedRef.current[childType] = true;
                  }
                }
              }
              setDeliveryApproaches(backup.children.delivery_approaches || []);
              setOperatingSystems(backup.children.operating_systems || []);
              setImmediateAttention(backup.children.immediate_attention || []);
              setVerifiableItems(backup.children.verifiable_items || []);
              setSystemsInPlace(backup.children.systems_in_place || []);
              const summaryArr = backup.children.summary;
              setSummary(summaryArr?.[0] || { id: crypto.randomUUID(), training_id: id });
            }
            toast.info("Restored from local backup", {
              description: backup.photoMetadata?.some(p => !p.uploaded)
                ? "Some photos may need to be re-captured."
                : "Your data has been recovered.",
            });
          }
        }

        // If online and not a temp-ID, fetch from Supabase and update offline storage
        if (isOnline && !id.startsWith('temp-')) {
          const { data: trainingData, error: trainingError } = await supabase
            .from('trainings')
            .select('*')
            .eq('id', id)
            .maybeSingle();

          // Handle training not found - redirect to dashboard
          if (!trainingData && !offlineTraining) {
            console.warn('[TrainingForm] Training not found:', id);
            toast.error("Training not found", {
              description: "This training may have been deleted or doesn't exist.",
            });
            navigate('/dashboard');
            return;
          }

          if (trainingError) throw trainingError;
          
          // Determine if local data should take priority
          const localIsNewer = isLocalDataNewer(offlineTraining, trainingData);

          if (localIsNewer) {
            // Local data is newer - preserve local state, only accept server metadata
            // Skip ALL server child data fetches to prevent overwriting local edits
            if (import.meta.env.DEV) console.log('[TrainingForm] Local data is newer -- preserving local state (parent + child)');
            if (trainingData) {
              setTraining(prev => ({ ...prev, status: trainingData.status }));
              setInspectorId(trainingData.inspector_id);
            }
          } else if (trainingData) {
            setTraining(trainingData);
            setInspectorId(trainingData.inspector_id);
            // Non-blocking cache update - don't await to prevent loading freeze
            saveTrainingOffline({ ...trainingData, synced_at: trainingData.synced_at || new Date().toISOString() }).catch(e =>
              console.warn('[TrainingForm] Non-critical: failed to cache training', e)
            );

            // Load all related data
            const [
              { data: approachData },
              { data: systemData },
              { data: attentionData },
              { data: verifiableData },
              { data: systemsPlaceData },
              { data: summaryResult }
            ] = await Promise.all([
              supabase.from('training_delivery_approaches').select('*').eq('training_id', id),
              supabase.from('training_operating_systems').select('*').eq('training_id', id),
              supabase.from('training_immediate_attention').select('*').eq('training_id', id),
              supabase.from('training_verifiable_items').select('*').eq('training_id', id),
              supabase.from('training_systems_in_place').select('*').eq('training_id', id),
              supabase.from('training_summary').select('*').eq('training_id', id).maybeSingle()
            ]);

            // Vector 2: Non-regression guard — don't overwrite local data with empty server arrays
            isInternalUpdateRef.current = true;
            // Mark all child types as loaded when server data is applied
            childDataLoadedRef.current.delivery_approaches = true;
            childDataLoadedRef.current.operating_systems = true;
            childDataLoadedRef.current.immediate_attention = true;
            childDataLoadedRef.current.verifiable_items = true;
            childDataLoadedRef.current.systems_in_place = true;
            childDataLoadedRef.current.summary = true;
            if (approachData && approachData.length > 0) {
              setDeliveryApproaches(approachData);
              saveTrainingDataOffline('delivery_approaches', id, approachData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache delivery_approaches', e));
            } else if (delivery_approaches.length > 0) {
              console.warn('[TrainingForm] Server returned empty delivery_approaches but local has data -- preserving local');
            }
            if (systemData && systemData.length > 0) {
              setOperatingSystems(systemData);
              saveTrainingDataOffline('operating_systems', id, systemData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache operating_systems', e));
            } else if (operating_systems.length > 0) {
              console.warn('[TrainingForm] Server returned empty operating_systems but local has data -- preserving local');
            }
            if (attentionData && attentionData.length > 0) {
              setImmediateAttention(attentionData);
              saveTrainingDataOffline('immediate_attention', id, attentionData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache immediate_attention', e));
            } else if (immediate_attention.length > 0) {
              console.warn('[TrainingForm] Server returned empty immediate_attention but local has data -- preserving local');
            }
            if (verifiableData && verifiableData.length > 0) {
              setVerifiableItems(verifiableData);
              saveTrainingDataOffline('verifiable_items', id, verifiableData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache verifiable_items', e));
            } else if (verifiable_items.length > 0) {
              console.warn('[TrainingForm] Server returned empty verifiable_items but local has data -- preserving local');
            }
            if (systemsPlaceData && systemsPlaceData.length > 0) {
              setSystemsInPlace(systemsPlaceData);
              saveTrainingDataOffline('systems_in_place', id, systemsPlaceData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache systems_in_place', e));
            } else if (systems_in_place.length > 0) {
              console.warn('[TrainingForm] Server returned empty systems_in_place but local has data -- preserving local');
            }
            // Summary: always take server data if available, otherwise keep local
            if (summaryResult) {
              setSummary(summaryResult);
              saveTrainingDataOffline('summary', id, summaryResult).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache summary', e));
            } else if (!summaryData) {
              // Initialize summary with a proper UUID if not exists anywhere
              setSummary({ id: crypto.randomUUID(), training_id: id });
            }
          }
        } else if (!offlineTraining) {
          // Offline and no cached data
          toast.error("Training not available offline", {
            description: "Please connect to the internet to load this training.",
          });
          navigate('/dashboard');
          return;
        }
      } catch (error) {
        console.error('Error loading training:', error);
        toast.error("Failed to load training", {
          description: "An error occurred while loading the training.",
        });
        navigate('/dashboard');
      } finally {
        setIsLoading(false);
      }
    };

    loadTraining();
  }, [id, isOnline, navigate]);

  // Track if save is in progress to prevent duplicate calls
  const saveInProgressRef = useRef(false);

  // Auto-save functionality with safety timeout and duplicate prevention
  const saveTraining = useCallback(async () => {
    // Block all writes in Lovable preview to protect production data
    if ((await import('@/lib/environment')).isLovablePreview()) return;
    if (!training || !id) return;

    // Prevent duplicate save calls
    if (saveInProgressRef.current) {
      if (import.meta.env.DEV) console.log('[Training Save] Save already in progress, skipping');
      return;
    }

    if (import.meta.env.DEV) console.log('[Training Save] Starting save...');
    saveInProgressRef.current = true;
    setIsSaving(true);

    // Safety timeout - ensure saving state is cleared after max 8 seconds (reduced from 30)
    const safetyTimeout = setTimeout(() => {
      console.warn('[Training Save] Safety timeout reached, forcing save state reset');
      setIsSaving(false);
      saveInProgressRef.current = false;
    }, 8000);

    try {
      const updatedTraining = {
        ...training,
        updated_at: new Date().toISOString(),
        // DISABLED: active_duration_seconds: getElapsedSeconds(),
        // Track who modified the report if current user is not the owner
        ...(currentUser?.id && currentUser.id !== training.inspector_id 
          ? { last_modified_by: currentUser.id } 
          : {}),
      };

      // Save offline (fire-and-forget for UI responsiveness)
      // Guard: Only write child data if it was successfully loaded OR has items
      const childOps: Promise<any>[] = [saveTrainingOffline(updatedTraining)];
      if (deliveryApproaches.length > 0 || childDataLoadedRef.current.delivery_approaches) {
        childOps.push(saveTrainingDataOffline('delivery_approaches', id, deliveryApproaches));
      } else {
        console.warn('[Training Save] Skipping delivery_approaches save — empty array not confirmed as loaded');
      }
      if (operatingSystems.length > 0 || childDataLoadedRef.current.operating_systems) {
        childOps.push(saveTrainingDataOffline('operating_systems', id, operatingSystems));
      } else {
        console.warn('[Training Save] Skipping operating_systems save — empty array not confirmed as loaded');
      }
      if (immediateAttention.length > 0 || childDataLoadedRef.current.immediate_attention) {
        childOps.push(saveTrainingDataOffline('immediate_attention', id, immediateAttention));
      } else {
        console.warn('[Training Save] Skipping immediate_attention save — empty array not confirmed as loaded');
      }
      if (verifiableItems.length > 0 || childDataLoadedRef.current.verifiable_items) {
        childOps.push(saveTrainingDataOffline('verifiable_items', id, verifiableItems));
      } else {
        console.warn('[Training Save] Skipping verifiable_items save — empty array not confirmed as loaded');
      }
      if (systemsInPlace.length > 0 || childDataLoadedRef.current.systems_in_place) {
        childOps.push(saveTrainingDataOffline('systems_in_place', id, systemsInPlace));
      } else {
        console.warn('[Training Save] Skipping systems_in_place save — empty array not confirmed as loaded');
      }
      if (summary && (childDataLoadedRef.current.summary || summary.observations || summary.recommendations)) {
        childOps.push(saveTrainingDataOffline('summary', id, summary));
      }
      // Layer 1: localStorage snapshot backup FIRST (before IndexedDB writes)
      try {
        saveReportSnapshot('training', id, updatedTraining, {
          delivery_approaches: deliveryApproaches,
          operating_systems: operatingSystems,
          immediate_attention: immediateAttention,
          verifiable_items: verifiableItems,
          systems_in_place: systemsInPlace,
          summary: summary ? [summary] : [],
        }, false);
      } catch {}

      Promise.all(childOps).then(() => {
        if (import.meta.env.DEV) console.log('[Training Save] Offline storage completed');

        // Layer 2: Append-only version history
        appendVersion('training', id, updatedTraining, {
          delivery_approaches: deliveryApproaches,
          operating_systems: operatingSystems,
          immediate_attention: immediateAttention,
          verifiable_items: verifiableItems,
          systems_in_place: systemsInPlace,
          summary: summary ? [summary] : [],
        }, 'auto_save').then((v) => {
          if (v) {
            setLastVersionNumber(v.versionNumber);
            setLastFieldCount(v.fieldCount);
          }
        }).catch(() => {});
      }).catch((offlineError) => {
        console.warn('[Training Save] Offline storage failed:', offlineError);
      });

      // If online, try to sync to Supabase
      if (isOnline) {
        // Pre-edit snapshot: capture server state before admin overwrites it
        if (currentUser?.id && training?.inspector_id && currentUser.id !== training.inspector_id) {
          const { capturePreEditSnapshot } = await import('@/lib/admin-edit-snapshot');
          capturePreEditSnapshot('training', id!, training.inspector_id, currentUser.id);
        }
        try {
          // Update main training record WITHOUT synced_at (deferred pattern)
          const { data: updateResult, error: trainingError } = await supabase
            .from('trainings')
            .update(updatedTraining)
            .eq('id', id)
            .select('id');

          if (trainingError) throw trainingError;
          
          // Verification: If 0 rows updated, record may not exist on server — use upsert
          if (!updateResult || updateResult.length === 0) {
            console.warn('[Training Save] Update returned 0 rows — falling back to upsert');
            const { error: upsertError } = await supabase
              .from('trainings')
              .upsert({ id, ...updatedTraining });
            if (upsertError) throw upsertError;
          }

          // OPTIMIZED: Pre-generate UUIDs and run ALL operations in parallel
          // Prepare all data with proper IDs upfront
          const prepareItems = <T extends { id?: string }>(items: T[], foreignKey: string) => 
            items.map(item => ({
              ...item,
              id: item.id?.startsWith('temp-') ? crypto.randomUUID() : (item.id || crypto.randomUUID()),
              [foreignKey]: id
            }));

          const preparedApproaches = prepareItems(deliveryApproaches, 'training_id');
          const preparedSystems = prepareItems(operatingSystems, 'training_id');
          const preparedAttention = prepareItems(immediateAttention, 'training_id');
          const preparedVerifiable = prepareItems(verifiableItems, 'training_id');
          const preparedSystemsPlace = prepareItems(systemsInPlace, 'training_id');

          // Execute all upserts in parallel (single batch operation)
          const parallelOps: Promise<void>[] = [];

          // RECONCILE: Delete server rows removed locally before upserting
          const user = await getUserWithCache();
          if (user) {
            await reconcileAllChildTables(
              [
                { childTable: 'training_delivery_approaches', parentIdColumn: 'training_id', localItems: deliveryApproaches },
                { childTable: 'training_operating_systems', parentIdColumn: 'training_id', localItems: operatingSystems },
                { childTable: 'training_immediate_attention', parentIdColumn: 'training_id', localItems: immediateAttention },
                { childTable: 'training_verifiable_items', parentIdColumn: 'training_id', localItems: verifiableItems },
                { childTable: 'training_systems_in_place', parentIdColumn: 'training_id', localItems: systemsInPlace },
                { childTable: 'training_summary', parentIdColumn: 'training_id', localItems: summary ? [summary] : [] },
              ],
              id!,
              'training',
              user.id,
            );
          }
          
          // Helper to convert PromiseLike to proper Promise
          const dbOp = async (operation: PromiseLike<{ error: any }>) => {
            const { error } = await operation;
            if (error) throw error;
          };

          if (preparedApproaches.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_delivery_approaches').upsert(preparedApproaches, { onConflict: 'id' }))
            );
          }

          if (preparedSystems.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_operating_systems').upsert(preparedSystems, { onConflict: 'id' }))
            );
          }

          if (preparedAttention.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_immediate_attention').upsert(preparedAttention, { onConflict: 'id' }))
            );
          }

          if (preparedVerifiable.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_verifiable_items').upsert(preparedVerifiable, { onConflict: 'id' }))
            );
          }

          if (preparedSystemsPlace.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_systems_in_place').upsert(preparedSystemsPlace, { onConflict: 'id' }))
            );
          }

          // Summary - use upsert for atomic operation
          if (summary) {
            const preparedSummary = {
              ...summary,
              id: summary.id || crypto.randomUUID(),
              training_id: id
            };
            parallelOps.push(
              dbOp(supabase.from('training_summary').upsert(preparedSummary, { onConflict: 'training_id' }))
            );
          }

          // Execute all in parallel
          await Promise.all(parallelOps);

          // DEFERRED: Set synced_at ONLY after all child data committed successfully
          const syncTimestamp = new Date().toISOString();
          const { data: verifyData, error: finalSyncError } = await supabase
            .from('trainings')
            .update({ synced_at: syncTimestamp })
            .eq('id', id)
            .select('id, synced_at');
          
          if (finalSyncError || !verifyData?.length) {
            console.error('[Training Save] Post-sync verification failed:', finalSyncError);
            throw new Error("Sync verification failed: server did not confirm synced_at update");
          }

          // Only mark local as synced after server confirmation
          await saveTrainingOffline({
            ...updatedTraining,
            synced_at: syncTimestamp
          });
          markSnapshotSynced('training', id);
          if (import.meta.env.DEV) console.log('[Training Save] Synced to database (verified)');
        } catch (error) {
          if (import.meta.env.DEV) console.log('[Training Save] Failed to sync, queuing operation:', error);
          try {
            await Promise.race([
              queueTrainingOperation('update', id, updatedTraining),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
            ]);
          } catch (e) {
            console.warn('[TrainingForm] Queue operation failed/timed out:', e);
          }
        }
      } else {
        // Queue for later sync
        if (import.meta.env.DEV) console.log('[Training Save] Offline - queuing for sync');
        try {
          await Promise.race([
            queueTrainingOperation('update', id, updatedTraining),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
          ]);
        } catch (e) {
          console.warn('[TrainingForm] Queue operation failed/timed out:', e);
        }
      }

      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('[Training Save] Error saving training:', error);
    } finally {
      clearTimeout(safetyTimeout);
      if (import.meta.env.DEV) console.log('[Training Save] Completed, setting isSaving to false');
      setIsSaving(false);
      saveInProgressRef.current = false;
    }
  }, [training, id, deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, isOnline]);

  // Keep saveTrainingRef pointing to the latest saveTraining on every render
  saveTrainingRef.current = saveTraining;

  // Auto-save/sync retry is now handled by useAutoSync hook

  // Debounce timer for 3-second auto-save after field changes
  const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced auto-save on data changes (3-second debounce) - immediate persistence
  useEffect(() => {
    if (isLoading || !training || !isOwner) return;
    
    // Skip internal/programmatic updates (initial load, server hydration, auto-populate)
    if (isInternalUpdateRef.current) return;
    
    // Mark as having unsaved changes
    setHasUnsavedChanges(true);
    
    // Clear existing debounce timer
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
    }
    
    // Set new debounce timer - 1.5 seconds after last change (optimized for near-instant feel)
    saveDebounceTimerRef.current = setTimeout(() => {
      if (!isSaving) {
        if (import.meta.env.DEV) {
          console.log('[Training AutoSave] Debounced save triggered');
        }
        saveTraining();
      }
    }, 1500);
    
    return () => {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
    };
  }, [deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, isOwner]);

  // Reset internal update ref after the change tracker skips
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
    }
  }, [deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary]);

  // Backup auto-save interval (every 30 seconds) - fallback only
  useEffect(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }

    autoSaveTimer.current = setInterval(() => {
      if (hasUnsavedChanges && !isSaving && !isLoading && training && isOwner) {
        if (import.meta.env.DEV) console.log('[Training AutoSave] Interval save triggered');
        saveTraining();
      }
    }, 30000);

    return () => {
      if (autoSaveTimer.current) {
        clearInterval(autoSaveTimer.current);
      }
    };
  }, [hasUnsavedChanges, isSaving, isLoading, training, isOwner]);

  const handleGeneratePDF = async () => {
    if (!id) return;
    
    setIsGeneratingPDF(true);
    
    try {
      // First save any pending changes
      await saveTraining();
      
      // Generate the PDF
      const { data, error } = await supabase.functions.invoke('generate-training-pdf', {
        body: { trainingId: id }
      });
      
      if (error) {
        throw error;
      }

      // Handle rate limiting
      if (data?.error && data.error.includes('Rate limit exceeded')) {
        const retryMinutes = Math.ceil((data.retryAfter || 3600) / 60);
        return;
      }
      
      // Download the PDF
      if (data?.pdfUrl) {
        const link = document.createElement('a');
        link.href = data.pdfUrl;
        link.download = `training-report-${training?.organization || 'report'}-${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Show email dialog after a short delay
        setTimeout(() => setShowEmailDialog(true), 500);
      }
    } catch (error: any) {
      console.error('Error generating PDF:', error);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleSendEmail = async () => {
    if (!id) return;
    
    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailForm.recipientEmail) {
      return;
    }
    
    if (!emailRegex.test(emailForm.recipientEmail)) {
      return;
    }
    
    setIsSendingEmail(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('send-training-pdf-email', {
        body: {
          trainingId: id,
          recipientEmail: emailForm.recipientEmail,
          recipientName: emailForm.recipientName || undefined,
          message: emailForm.message || undefined,
        }
      });
      
      if (error) throw error;

      // Handle rate limiting
      if (data?.success === false && data?.error?.includes('Rate limit exceeded')) {
        const retryMinutes = Math.ceil((data.retryAfter || 3600) / 60);
        return;
      }
      
      // Reset form and close dialog
      setEmailForm({ recipientEmail: '', recipientName: '', message: '' });
      setShowEmailDialog(false);
    } catch (error: any) {
      console.error('Error sending email:', error);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleGenerateHTML = async () => {
    if (!id) return;
    
    setIsGeneratingHTML(true);
    
    // Safety timeout - NEVER get stuck in generating state (60 seconds max)
    const GENERATION_TIMEOUT = 60000;
    const safetyTimeoutHandle = setTimeout(() => {
      console.error('[HTML Generation] Safety timeout reached after 60 seconds - force resetting state');
      setIsGeneratingHTML(false);
      toast.error("Report generation timed out", {
        description: "Please check your connection and try again.",
      });
    }, GENERATION_TIMEOUT);
    
    try {
      await saveTraining();
      
      // Wrap the edge function call in a Promise.race with timeout
      const generatePromise = supabase.functions.invoke('generate-training-html', {
        body: { trainingId: id }
      });
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('TIMEOUT: Report generation took too long'));
        }, GENERATION_TIMEOUT - 2000); // 2 seconds before safety timeout
      });
      
      const { data, error } = await Promise.race([generatePromise, timeoutPromise]);
      
      if (error) throw error;
      
      const html = data.html;
      
      // Auto-sync report to database for "latest report" functionality
      await syncReport(html);
      
      const filename = `training-report-${training?.organization || 'report'}-${new Date().toISOString().split('T')[0]}.html`;
      const title = `Training Report - ${training?.organization || 'Report'}`;

      // Try to open in new window (desktop)
      const opened = openHtmlReport({ html, filename, title });

      // If failed (mobile/PWA/popup blocked), use in-app viewer
      if (!opened) {
        setReportHtml(html);
        setHtmlViewerOpen(true);
      }
    } catch (error: any) {
      console.error('[HTML Generation] Error:', error.message || error);
      
      // Only show error toast if not already shown by safety timeout
      if (!error.message?.includes('TIMEOUT')) {
        toast.error("Failed to generate report", {
          description: error.message || "Please try again.",
        });
      }
    } finally {
      clearTimeout(safetyTimeoutHandle);
      setIsGeneratingHTML(false);
    }
  };

  const completeTraining = useCallback(async () => {
    if (!training || !id) return;

    setIsSaving(true);
    
    // Safety timeout - NEVER get stuck in saving state
    const safetyTimeout = setTimeout(() => {
      console.warn('[Training Complete] Safety timeout reached, forcing save state reset');
      setIsSaving(false);
    }, 10000); // 10 seconds for completion (involves more operations)
    
    try {
      const wasAlreadyCompleted = training?.status === 'completed';
      const completedTraining = {
        ...training,
        status: 'completed',
        updated_at: new Date().toISOString(),
      };

      // Save offline first
      await saveTrainingOffline(completedTraining);
      await Promise.all([
        saveTrainingDataOffline('delivery_approaches', id, deliveryApproaches),
        saveTrainingDataOffline('operating_systems', id, operatingSystems),
        saveTrainingDataOffline('immediate_attention', id, immediateAttention),
        saveTrainingDataOffline('verifiable_items', id, verifiableItems),
        saveTrainingDataOffline('systems_in_place', id, systemsInPlace),
        summary && saveTrainingDataOffline('summary', id, summary)
      ]);

      // If online, try to sync to Supabase
      if (isOnline) {
        try {
          // Update main training record
          const { error: trainingError } = await supabase
            .from('trainings')
            .update({ status: 'completed', updated_at: completedTraining.updated_at })
            .eq('id', id);

          if (trainingError) throw trainingError;

          // Safe upsert pattern (matches saveTraining) - never deletes existing data
          const prepareItems = <T extends { id?: string }>(items: T[], foreignKey: string) => 
            items.map(item => ({
              ...item,
              id: item.id?.startsWith('temp-') ? crypto.randomUUID() : (item.id || crypto.randomUUID()),
              [foreignKey]: id
            }));

          const dbOp = async (operation: PromiseLike<{ error: any }>) => {
            const { error } = await operation;
            if (error) throw error;
          };

          const parallelOps: Promise<void>[] = [];

          if (deliveryApproaches.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_delivery_approaches').upsert(prepareItems(deliveryApproaches, 'training_id'), { onConflict: 'id' }))
            );
          }

          if (operatingSystems.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_operating_systems').upsert(prepareItems(operatingSystems, 'training_id'), { onConflict: 'id' }))
            );
          }

          if (immediateAttention.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_immediate_attention').upsert(prepareItems(immediateAttention, 'training_id'), { onConflict: 'id' }))
            );
          }

          if (verifiableItems.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_verifiable_items').upsert(prepareItems(verifiableItems, 'training_id'), { onConflict: 'id' }))
            );
          }

          if (systemsInPlace.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_systems_in_place').upsert(prepareItems(systemsInPlace, 'training_id'), { onConflict: 'id' }))
            );
          }

          // Summary - use upsert for atomic operation
          if (summary) {
            const preparedSummary = {
              ...summary,
              id: summary.id || crypto.randomUUID(),
              training_id: id
            };
            parallelOps.push(
              dbOp(supabase.from('training_summary').upsert(preparedSummary, { onConflict: 'training_id' }))
            );
          }

          await Promise.all(parallelOps);

          await saveTrainingOffline({
            ...completedTraining,
            synced_at: new Date().toISOString()
          });
          markSnapshotSynced('training', id);
        } catch (error) {
          console.warn('[Offline] Failed to sync, queuing operation');
          try {
            await Promise.race([
              queueTrainingOperation('update', id, completedTraining),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
            ]);
          } catch (e) {
            console.warn('[TrainingForm] Queue operation failed/timed out:', e);
          }
        }
      } else {
        // Queue for later sync
        try {
          await Promise.race([
            queueTrainingOperation('update', id, completedTraining),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
          ]);
        } catch (e) {
          console.warn('[TrainingForm] Queue operation failed/timed out:', e);
        }
      }

      setTraining(completedTraining);
      setLastSaved(new Date());
      
      // Trigger celebration on first completion
      if (!wasAlreadyCompleted) {
        triggerCompletionConfetti();
        triggerHaptic('success');
      }
    } catch (error) {
      console.error('Error completing training:', error);
    } finally {
      clearTimeout(safetyTimeout);
      setIsSaving(false);
    }
  }, [training, id, deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, isOnline]);

  const updateTrainingField = (field: string, value: any) => {
    setTraining({ ...training, [field]: value });
    setHasUnsavedChanges(true);
  };

  const updateSummaryField = (field: string, value: any) => {
    setSummary({ ...summary, [field]: value });
    setHasUnsavedChanges(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <UnsavedChangesDialog
        isOpen={isBlocked}
        onConfirm={confirmNavigation}
        onCancel={cancelNavigation}
        onSaveAndLeave={saveAndLeave}
        message="You have unsaved changes to this training report. Are you sure you want to leave?"
      />
      <CompletionLockDialog
        open={showCompletionLockDialog}
        onOpenChange={setShowCompletionLockDialog}
        onConfirm={() => setCompletionLockOverridden(true)}
      />
      <SaveBeforeLeaveDialog
        open={showLeaveDialog}
        onOpenChange={setShowLeaveDialog}
        onSave={async () => {
          if (isSavingBeforeLeave) return;
          setIsSavingBeforeLeave(true);
          leavingRef.current = true;
          try {
            await Promise.race([
              handleSaveAndLeave(),
              new Promise(resolve => setTimeout(resolve, 8000)),
            ]);
            emitSyncComplete();
            markPendingDashboardRefresh();
            flushSync(() => {
              setShowLeaveDialog(false);
              setHasUnsavedChanges(false);
            });
            navigate('/dashboard');
          } catch (e) {
            console.warn('[TrainingForm] Save-before-leave error:', e);
            flushSync(() => {
              setShowLeaveDialog(false);
              setHasUnsavedChanges(false);
            });
            navigate('/dashboard');
          } finally {
            setIsSavingBeforeLeave(false);
          }
        }}
        onLeave={() => {
          leavingRef.current = true;
          flushSync(() => {
            setShowLeaveDialog(false);
            setHasUnsavedChanges(false);
          });
          markPendingDashboardRefresh();
          navigate('/dashboard');
        }}
        onCancel={() => setShowLeaveDialog(false)}
        isSaving={isSavingBeforeLeave}
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

      {/* Storage Unavailable Banner (Vector A) */}
      {storageUnavailable && (
        <div className="bg-destructive/10 border-b border-destructive/20">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">
                  Local storage unavailable
                </p>
                <p className="text-xs text-destructive/80 mt-0.5">
                  Your changes are at risk. Please stay connected to sync your work.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Offline Empty Data Banner (Vector E) */}
      {!isOnline && !isLoading && deliveryApproaches.length === 0 && operatingSystems.length === 0 &&
        immediateAttention.length === 0 && !childDataLoadedRef.current.delivery_approaches && 
        !childDataLoadedRef.current.operating_systems && !childDataLoadedRef.current.immediate_attention && (
        <div className="bg-muted border-b border-border">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <WifiOff className="w-5 h-5 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">
                Report details not available offline. Connect to the internet to load full data.
              </p>
            </div>
          </div>
        </div>
      )}
      
      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5 sticky top-0 z-20">
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
          {/* Top row - Back button, Logo, User Avatar */}
          <div className="flex items-center justify-between mb-2 sm:mb-0">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setShowLeaveDialog(true)}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <img src={ropeWorksLogo} alt="Rope Works" className="h-8 sm:h-10 w-auto object-contain" />
            </div>
            
            {/* UserProfileDropdown is now in the global AuthenticatedHeader */}
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
              <AutoSaveIndicator
                lastSaved={lastSaved}
                isSaving={isSaving}
                hasUnsavedChanges={hasUnsavedChanges}
                className="flex"
              />
              {/* DISABLED: Timer display hidden for now
              <ActiveTimerDisplay
                elapsedSeconds={elapsedSeconds}
                isActive={timerActive}
                isPaused={timerPaused}
                isReadOnly={effectiveReadOnly}
              />
              */}
            </div>
            
            <div className="flex items-center gap-2">
              {!effectiveReadOnly && (
              <>
              <Button 
                variant="outline" 
                size={isMobile ? "default" : "sm"} 
                onClick={saveTraining} 
                disabled={isSaving || !isOnline}
              >
                <Save className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                {isMobile ? (isSaving ? "..." : "Save") : (isSaving ? "Saving..." : "Save Progress")}
              </Button>
              {id && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Force Local Backup"
                onClick={() => {
                  if (training && id) {
                    saveReportSnapshot('training', id, training, {
                      delivery_approaches: deliveryApproaches,
                      operating_systems: operatingSystems,
                      immediate_attention: immediateAttention,
                      verifiable_items: verifiableItems,
                      systems_in_place: systemsInPlace,
                      summary: summary ? [summary] : [],
                    }, !!training.synced_at);
                  }
                  const ok = downloadReportBackup('training', id);
                  if (ok) {
                    toast.success('BACKUP SAVED', {
                      description: 'Snapshot downloaded to device',
                      duration: 2000,
                      style: { background: 'hsl(0, 0%, 5%)', color: 'hsl(120, 100%, 56%)', border: '1px solid hsl(120, 100%, 50%, 0.3)', fontFamily: 'monospace', fontSize: '12px' },
                    });
                  } else {
                    toast.warning('No snapshot available to download');
                  }
                }}
              >
                <HardDrive className="w-4 h-4" />
              </Button>
              )}
              <Button 
                size={isMobile ? "default" : "sm"} 
                onClick={() => setShowCompleteDialog(true)} 
                disabled={isSaving || !isOnline}
                className={isMobile ? "min-w-[100px] h-10 text-sm font-medium" : ""}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                    <span>{isMobile ? "Complete" : "Complete"}</span>
                  </>
                )}
              </Button>
              </>
              )}
              {training?.status === 'completed' && (
                <>
                {isMobile && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleGenerateHTML}
                    disabled={isGeneratingHTML || !isOnline}
                    className="h-9 w-9"
                  >
                    <RefreshCw className={cn("w-4 h-4", isGeneratingHTML && "animate-spin")} />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size={isMobile ? "default" : "sm"}
                  onClick={handleGenerateHTML}
                  disabled={isGeneratingHTML || !isOnline}
                >
                  {isGeneratingHTML ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <FileText className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                      {isMobile ? "" : "Generate Report"}
                    </>
                  )}
                </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div onClickCapture={handleLockedFieldClick} onPointerDownCapture={handleLockedFieldClick} className={cn("container mx-auto px-4 py-8", isCompletionLocked && "completion-locked")}>
        {isCompletionLocked && (
          <div className="border-2 border-green-500/60 bg-black/90 text-green-500 font-mono text-xs px-4 py-2 flex items-center gap-2 mb-4 rounded">
            <Lock className="h-3.5 w-3.5" />
            <span>LOCKED — Click any field to unlock for editing</span>
          </div>
        )}
        {/* Swipe back indicator for mobile */}
        {isMobile && isFirstTab && (
          <SwipeBackIndicator 
            progress={swipeState.swipeProgress} 
            isActive={swipeState.isSwipingBack} 
          />
        )}

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-6">
          <div ref={swipeContainerRef} className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm pb-1">
            <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7 gap-1 lg:gap-0 h-auto p-1.5 lg:p-1">
              <TabsTrigger value="info" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Info className="h-3.5 w-3.5" />
                <span>Info</span>
              </TabsTrigger>
              <TabsTrigger value="delivery" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Users className="h-3.5 w-3.5" />
                <span>{isMobile ? "Delivery" : "Delivery Approach"}</span>
              </TabsTrigger>
              <TabsTrigger value="systems" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                <span>{isMobile ? "Systems" : "Trained OS"}</span>
              </TabsTrigger>
              <TabsTrigger value="attention" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{isMobile ? "Actions" : "Required Actions"}</span>
              </TabsTrigger>
              <TabsTrigger value="verifiable" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5" />
                <span>{isMobile ? "Verified" : "Verified During Training"}</span>
              </TabsTrigger>
              <TabsTrigger value="summary" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <FileCheck className="h-3.5 w-3.5" />
                <span>Summary</span>
              </TabsTrigger>
              <TabsTrigger value="photos" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                <span>Photos</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div>
              <TabsContent value="info" className="space-y-6">
                <TrainingHeader 
                  training={training} 
                  onUpdate={effectiveReadOnly ? () => {} : updateTrainingField} 
                  isReadOnly={effectiveReadOnly}
                  userProfile={inspectorProfile}
                  modifiedByProfile={modifiedByProfile}
                />
              </TabsContent>

              <TabsContent value="delivery" className="space-y-6">
                <DeliveryApproachSection 
                  approaches={deliveryApproaches} 
                  onUpdate={setDeliveryApproaches} 
                />
              </TabsContent>

              <TabsContent value="systems" className="space-y-6">
                <OperatingSystemsSection 
                  systems={operatingSystems} 
                  onUpdate={setOperatingSystems} 
                />
              </TabsContent>

              <TabsContent value="attention" className="space-y-6">
                <ImmediateAttentionSection 
                  items={immediateAttention} 
                  onUpdate={setImmediateAttention} 
                />
              </TabsContent>

              <TabsContent value="verifiable" className="space-y-6">
                <VerifiableItemsSection 
                  items={verifiableItems} 
                  onUpdate={setVerifiableItems}
                  systemsInPlace={systemsInPlace}
                  onUpdateSystemsInPlace={setSystemsInPlace}
                />
              </TabsContent>

              <TabsContent value="summary" className="space-y-6">
                <TrainingSummarySection 
                  summary={summary} 
                  onUpdate={updateSummaryField} 
                />
              </TabsContent>

              <TabsContent value="photos" className="space-y-6">
                <div className="space-y-6">
                  <div className="border-2 border-foreground/20 bg-background p-6 rounded-md">
                    <h3 className="text-lg font-semibold font-mono tracking-tight mb-4">Training Photos</h3>
                    {!effectiveReadOnly && (
                      <div className="mb-4">
                        <PhotoCapture
                          inspectionId={id!}
                          section="training"
                          onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
                          tableName="training_photos"
                          foreignKeyColumn="training_id"
                          storageBucket="training-photos"
                        />
                      </div>
                    )}
                    <PhotoGallery
                      key={`training-${photoRefreshKey}`}
                      inspectionId={id!}
                      section="training"
                      readOnly={effectiveReadOnly}
                      tableName="training_photos"
                      foreignKeyColumn="training_id"
                      storageBucket="training-photos"
                    />
                  </div>
                </div>
              </TabsContent>
          </div>
        </Tabs>
      </div>
      

      {/* Email Dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Email Training Report</DialogTitle>
            <DialogDescription>
              Send the PDF training report to an email address. The recipient will receive a download link valid for 7 days.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="recipientEmail">
                Recipient Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="recipientEmail"
                type="email"
                placeholder="recipient@example.com"
                value={emailForm.recipientEmail}
                onChange={(e) => setEmailForm({ ...emailForm, recipientEmail: e.target.value })}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="recipientName">Recipient Name (Optional)</Label>
              <Input
                id="recipientName"
                type="text"
                placeholder="John Doe"
                value={emailForm.recipientName}
                onChange={(e) => setEmailForm({ ...emailForm, recipientName: e.target.value })}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message">Message (Optional)</Label>
              <Textarea
                id="message"
                placeholder="Add a personal message..."
                value={emailForm.message}
                onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })}
                rows={4}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                {emailForm.message.length}/500 characters
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEmailDialog(false)}
              disabled={isSendingEmail}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendEmail}
              disabled={isSendingEmail || !emailForm.recipientEmail}
            >
              {isSendingEmail ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HtmlReportViewer
        html={reportHtml}
        title={`Training Report - ${training?.organization || 'Report'}`}
        filename={`training-report-${training?.organization || 'report'}-${new Date().toISOString().split('T')[0]}.html`}
        isOpen={htmlViewerOpen}
        onClose={() => setHtmlViewerOpen(false)}
         reportType="training"
         organization={training?.organization}
         date={training?.start_date}
      />

      </div>

      <AlertDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Training Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark this training as complete? This will lock the report. You can still edit it afterward if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={completeTraining}>
              Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
