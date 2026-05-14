import { useEffect, useState, useCallback, useRef } from "react";
import { formatReportFilename, formatReportTitle } from "@/lib/report-naming";
import { useReportTabHistory } from "@/hooks/useReportTabHistory";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isLocalDataNewer } from "@/lib/local-data-guards";
import { applyTrackedFieldWrite, mergeRecordFields, TRACKED_FIELDS } from "@/lib/field-merge";
import { checkRequiredHeaderFields, formatMissingFieldLabels } from "@/lib/header-required-fields";
import { useParams, useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { markPendingDashboardRefresh, markDashboardStaleTimestamp, registerActiveFormRecord, unregisterActiveFormRecord, onPendingRemoteUpdate, isRecentSelfWrite } from "@/lib/sync-events";
import { useFormRecordRealtime } from "@/hooks/useFormRecordRealtime";
import { supabase } from "@/integrations/supabase/client";
import type { PostgrestError, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";
import type { CachedUser } from "@/lib/cached-auth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, FileDown, FileText, ChevronLeft, WifiOff, Wifi, Mail, CheckCircle, Info, Users, Settings, AlertTriangle, ClipboardCheck, FileCheck, LogOut, User, CloudOff, ArrowLeft, Camera, RefreshCw, HardDrive } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutoSaveIndicator } from "@/components/AutoSaveIndicator";
import { SaveFailureBanner } from "@/components/SaveFailureBanner";
import { useActiveTimer } from "@/hooks/useActiveTimer";
import { ActiveTimerDisplay } from "@/components/ActiveTimerDisplay";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import TrainingHeader from "@/components/training/TrainingHeader";
import { getMissingTrainingFields, formatMissingDescription, type MissingField } from "@/lib/required-fields";
import { CollaboratorPresence } from "@/components/CollaboratorPresence";
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
  queueTrainingOperation,
  type DbRow,
} from "@/lib/offline-storage";

// `saveTrainingDataOffline` accepts a fixed set of section keys.
// Derived from its first parameter so the union stays in sync with offline-storage.
type TrainingDataKey = Parameters<typeof saveTrainingDataOffline>[0];

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}
import { HtmlReportViewer } from "@/components/HtmlReportViewer";
import { AttestationDialog } from "@/components/AttestationDialog";
import { useUserProfile } from "@/hooks/useUserProfile";
import type { AttestationPayload } from "@/lib/attestation";
import { APP_VERSION_FULL } from "@/lib/attestation";

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
import { reconcileAllChildTables, restoreReconciledDeletions, type ReconciledTableDelete } from "@/lib/sync-reconciliation";
import { useEmergencySave } from "@/hooks/useEmergencySave";
import { saveReportSnapshot, getReportSnapshot, markSnapshotSynced, downloadReportBackup } from "@/lib/local-backup-ledger";
import { capturePreEditSnapshot } from "@/lib/admin-edit-snapshot";
import { logError } from "@/lib/log-error";
import { onCloudBackupError } from "@/lib/cloud-backup";
import { appendVersion } from "@/lib/report-version-manager";
import { showHardSavedToast } from "@/lib/toast-helpers";
import { DataIntegrityBadge, type IntegrityStatus } from "@/components/ui/data-integrity-badge";
import { VersionHistoryPanel } from "@/components/admin/VersionHistoryPanel";
import { Shield as ShieldIcon, Receipt } from "lucide-react";
import { useInvoicedStatus } from "@/hooks/useInvoicedStatus";

export default function TrainingForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const isMobile = useIsMobile();
  const { syncReport, getLatestReport } = useReportSync(id, 'training');
  const { storageUnavailable } = useStorageHealthCheck();
  
  // Check edit permissions - Super Admins are view-only, only owners can edit
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const { canEdit, isReadOnly, isOwner, isSuperAdmin, isAdmin, readOnlyReason } = useReportEditPermission({
    inspectorId,
    reportType: 'training'
  });
  
  
  // Completion lock: prevent accidental edits to completed reports
  const [completionLockOverridden, setCompletionLockOverridden] = useState(false);
  const [showCompletionLockDialog, setShowCompletionLockDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [showAttestationDialog, setShowAttestationDialog] = useState(false);
  const { fullName: signerFullName } = useUserProfile();
  const [isSavingBeforeLeave, setIsSavingBeforeLeave] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveError, setSaveError] = useState<import("@/components/SaveFailureBanner").SaveErrorState>(null);
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
  const [training, setTraining] = useState<DbRow | null>(null);
  const { isInvoiced, toggling: invoiceToggling, toggleInvoiced } = useInvoicedStatus({
    reportId: id,
    reportType: 'training',
    enabled: isAdmin && training?.status === 'completed',
  });
  const [deliveryApproaches, setDeliveryApproaches] = useState<DbRow[]>([]);
  const [operatingSystems, setOperatingSystems] = useState<DbRow[]>([]);
  const [immediateAttention, setImmediateAttention] = useState<DbRow[]>([]);
  const [verifiableItems, setVerifiableItems] = useState<DbRow[]>([]);
  const [systemsInPlace, setSystemsInPlace] = useState<DbRow[]>([]);
  const [summary, setSummary] = useState<DbRow | null>(null);
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

  const [missingRequiredFields, setMissingRequiredFields] = useState<MissingField[]>([]);
  useEffect(() => {
    if (!missingRequiredFields.length) return;
    const stillMissing = getMissingTrainingFields(training);
    if (!stillMissing.length) {
      toast.dismiss(`completion-blocked-${id}`);
      setMissingRequiredFields([]);
    } else if (stillMissing.length !== missingRequiredFields.length) {
      setMissingRequiredFields(stillMissing);
    }
  }, [training?.organization, training?.start_date, training?.end_date, missingRequiredFields.length, id]);

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
    const isLightboxTrigger = target.closest('[data-lightbox-trigger]');
    const isInsideDialog = target.closest('[role="dialog"]');
    if (!isEditable || isTabTrigger || isLightboxTrigger || isInsideDialog) return; // Allow all non-editable interactions (scroll, expand, copy, navigate, view photos, dialog interactions)

    e.preventDefault();
    e.stopPropagation();
    setShowCompletionLockDialog(true);
  }, [isCompletionLocked]);

  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const isInternalUpdateRef = useRef(false);
  const summaryAutoPopulatedRef = useRef(false);
  const hasUnsavedRef = useRef(false);

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
  const [currentUser, setCurrentUser] = useState<CachedUser | null>(null);
  const [inspectorProfile, setInspectorProfile] = useState<DbRow | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<DbRow | null>(null);
  const [modifiedByProfile, setModifiedByProfile] = useState<DbRow | null>(null);
  // signingOut removed — sign-out handled by global AuthenticatedHeader
  
  // Tab navigation state
  const [currentTab, setCurrentTab] = useState("info");
  const tabOrder = ["info", "delivery", "systems", "attention", "verifiable", "summary", "photos"];
  
  // Hardware back button → navigate tabs on mobile
  const { handleTabChange } = useReportTabHistory(
    currentTab, setCurrentTab, tabOrder,
    useCallback(() => setShowLeaveDialog(true), []),
  );
  
  // Swipe navigation for mobile (swipe right on first tab navigates back)
  const isFirstTab = currentTab === tabOrder[0];
  const { containerRef: swipeContainerRef, swipeState } = useSwipeNavigation({
    enabled: isMobile,
    isFirstTab,
    onSwipeLeft: () => {
      const currentIndex = tabOrder.indexOf(currentTab);
      if (currentIndex < tabOrder.length - 1) {
        handleTabChange(tabOrder[currentIndex + 1]);
      }
    },
    onSwipeRight: () => {
      const currentIndex = tabOrder.indexOf(currentTab);
      if (currentIndex > 0) {
        handleTabChange(tabOrder[currentIndex - 1]);
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
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      console.log('[TrainingForm] Save-before-leave completed');
    } catch (e) {
      console.warn('[TrainingForm] Save-before-leave failed:', e);
    }
  }, []);
  saveBeforeLeaveRef.current = handleSaveAndLeave;

  // Stable immediate-save trigger for child fields (e.g. notes onBlur).
  // Flushes pending debounce timer and performs save now so values persist
  // before navigation. Identity is stable to keep React.memo children happy.
  const triggerImmediateSave = useCallback(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    return saveTrainingRef.current?.() ?? Promise.resolve();
  }, []);

  // Unsaved changes protection
  const { isBlocked, confirmNavigation, cancelNavigation, saveAndLeave, bypassAndProceed } = useUnsavedChanges({
    hasUnsavedChanges: hasUnsavedChanges && (training?.status !== 'completed' || completionLockOverridden),
    alwaysBlock: true,
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
            const photoMeta = photos.map((p) => ({
              id: p.id,
              caption: p.caption,
              photo_section: p.section,
              display_order: p.display_order,
              uploaded: Boolean(p.uploaded),
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

  // Fetch current user with offline fallback (non-blocking, matches InspectionForm)
  useEffect(() => {
    const fetchUser = async () => {
      let user = await getUserWithCache();
      if (!user) {
        const offlineId = getOfflineUserId();
        if (offlineId) user = { id: offlineId };
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
  useSaveShortcut(async () => { await saveTraining(); setLastManuallySaved(new Date()); }, hasUnsavedChanges && !isSaving);

  // Auto-populate person submitting (from report creator) and submission date
  useEffect(() => {
    if (!summary || isLoading || !inspectorProfile || summaryAutoPopulatedRef.current) return;

    const updates: Record<string, unknown> = {};

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

  const loadTraining = useCallback(async () => {
      if (!id) return;

      try {
        // Race-fix: flush any pending debounced save into IDB before reading,
        // so the offline read includes the user's most recent edits.
        if (autoSaveTimer.current || hasUnsavedRef.current) {
          try {
            if (autoSaveTimer.current) {
              clearTimeout(autoSaveTimer.current);
              autoSaveTimer.current = null;
            }
            await saveTrainingRef.current?.();
          } catch (e) {
            console.warn('[TrainingForm] Pre-load flush failed (continuing):', e);
          }
        }

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
          setSummary(summaryData || { 
            id: crypto.randomUUID(),
            training_id: id 
          });
        } else if (!id.startsWith('temp-')) {
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
                  saveTrainingDataOffline(childType as TrainingDataKey, id, childData).catch(() => {});
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

        if (isOnline && !id.startsWith('temp-')) {
          const { data: trainingData, error: trainingError } = await supabase
            .from('trainings')
            .select('*')
            .eq('id', id)
            .maybeSingle();

          if (!trainingData && !offlineTraining) {
            const serverInconclusive = !!trainingError || !navigator.onLine;
            const { getCircuitBreakerStatus } = await import('@/lib/offline-storage');
            const idbDegraded = getCircuitBreakerStatus().open;
            if (serverInconclusive || idbDegraded) {
              console.warn('[TrainingForm] Skipping not-found redirect — inconclusive lookup; staying mounted', { serverInconclusive, idbDegraded, id });
              return; // keep form mounted; next refetch/online recovery will reconcile
            }
            console.warn('[TrainingForm] Training not found:', id);
            toast.error("Training not found", {
              description: "This training may have been deleted or doesn't exist.",
            });
            navigate('/dashboard');
            return;
          }

          if (trainingError) throw trainingError;
          
          const localIsNewer = isLocalDataNewer(offlineTraining, trainingData);

          if (localIsNewer) {
            if (import.meta.env.DEV) console.log('[TrainingForm] Local data is newer -- preserving local state (parent + child)');
            if (trainingData) {
              setTraining(prev => ({ ...prev, status: trainingData.status }));
              setInspectorId(trainingData.inspector_id);
            }
          } else if (trainingData) {
            // Race-fix: per-field merge so any locally-newer tracked-field
            // edit survives a refetch even when the server payload doesn't
            // yet reflect that edit.
            setTraining(prev => {
              if (!prev) return trainingData;
              return mergeRecordFields(
                prev as typeof trainingData & { field_timestamps?: Record<string, string> | null },
                trainingData as typeof trainingData & { field_timestamps?: Record<string, string> | null },
                TRACKED_FIELDS.training,
              );
            });
            setInspectorId(trainingData.inspector_id);
            saveTrainingOffline({ ...trainingData, synced_at: trainingData.synced_at || new Date().toISOString() }).catch(e =>
              console.warn('[TrainingForm] Non-critical: failed to cache training', e)
            );

            const [
              { data: approachData },
              { data: systemData },
              { data: attentionData },
              { data: verifiableData },
              { data: systemsPlaceData },
              { data: summaryResult }
            ] = await Promise.all([
              supabase.from('training_delivery_approaches').select('*').eq('training_id', id).order('created_at'),
              supabase.from('training_operating_systems').select('*').eq('training_id', id).order('created_at'),
              supabase.from('training_immediate_attention').select('*').eq('training_id', id).order('created_at'),
              supabase.from('training_verifiable_items').select('*').eq('training_id', id).order('created_at'),
              supabase.from('training_systems_in_place').select('*').eq('training_id', id).order('created_at'),
              supabase.from('training_summary').select('*').eq('training_id', id).maybeSingle()
            ]);

            isInternalUpdateRef.current = true;
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
              setDeliveryApproaches(delivery_approaches);
            }
            if (systemData && systemData.length > 0) {
              setOperatingSystems(systemData);
              saveTrainingDataOffline('operating_systems', id, systemData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache operating_systems', e));
            } else if (operating_systems.length > 0) {
              console.warn('[TrainingForm] Server returned empty operating_systems but local has data -- preserving local');
              setOperatingSystems(operating_systems);
            }
            if (attentionData && attentionData.length > 0) {
              setImmediateAttention(attentionData);
              saveTrainingDataOffline('immediate_attention', id, attentionData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache immediate_attention', e));
            } else if (immediate_attention.length > 0) {
              console.warn('[TrainingForm] Server returned empty immediate_attention but local has data -- preserving local');
              setImmediateAttention(immediate_attention);
            }
            if (verifiableData && verifiableData.length > 0) {
              setVerifiableItems(verifiableData);
              saveTrainingDataOffline('verifiable_items', id, verifiableData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache verifiable_items', e));
            } else if (verifiable_items.length > 0) {
              console.warn('[TrainingForm] Server returned empty verifiable_items but local has data -- preserving local');
              setVerifiableItems(verifiable_items);
            }
            if (systemsPlaceData && systemsPlaceData.length > 0) {
              setSystemsInPlace(systemsPlaceData);
              saveTrainingDataOffline('systems_in_place', id, systemsPlaceData).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache systems_in_place', e));
            } else if (systems_in_place.length > 0) {
              console.warn('[TrainingForm] Server returned empty systems_in_place but local has data -- preserving local');
              setSystemsInPlace(systems_in_place);
            }
            if (summaryResult) {
              setSummary(summaryResult);
              saveTrainingDataOffline('summary', id, summaryResult).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache summary', e));
            } else if (!summaryData) {
              setSummary({ id: crypto.randomUUID(), training_id: id });
            }
          }
        } else if (!offlineTraining) {
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
  }, [id, isOnline, navigate]);

  // Load training data
  useEffect(() => {
    loadTraining();
  }, [loadTraining]);

  // F4: Realtime refresh for THIS training. Suppressed while user has unsaved edits.
  // H5: read `hasUnsavedChanges` and the latest `updated_at` via refs so the
  // channel doesn't churn on every keystroke.
  const lastLoadedUpdatedAtRef = useRef<string | null>(null);
  useEffect(() => {
    const ua = training?.updated_at;
    lastLoadedUpdatedAtRef.current = typeof ua === 'string' ? ua : null;
  }, [training]);
  // Audit H2: see InspectionForm — same Realtime-recovery pattern via shared helper.
  useFormRecordRealtime({
    enabled: !!id && !id.startsWith('temp-'),
    channelName: id ? `training-form-${id}` : '',
    table: 'trainings',
    recordId: id || '',
    logTag: 'TrainingForm',
    onUpdate: (payload: RealtimePostgresChangesPayload<DbRow>) => {
      const newRow = payload.new as Partial<DbRow> | null;
      const remoteUpdated = newRow && typeof newRow.updated_at === 'string' ? newRow.updated_at : null;
      if (!remoteUpdated) return;
      const localUpdated = lastLoadedUpdatedAtRef.current;
      const remoteMs = new Date(remoteUpdated).getTime();
      const localMs = localUpdated ? new Date(localUpdated).getTime() : 0;
      if (remoteMs - localMs <= 5000) return;
      if (hasUnsavedRef.current) {
        if (import.meta.env.DEV) console.log('[TrainingForm] Skipping remote refresh — unsaved local changes');
        return;
      }
      // Defence-in-depth: suppress refreshes for ~15 s after our own
      // atomic-sync writes (S6 self-write registry). See InspectionForm
      // for full rationale.
      if (id && isRecentSelfWrite(id)) {
        if (import.meta.env.DEV) console.log('[TrainingForm] Skipping remote refresh — recent self-write');
        return;
      }
      if (import.meta.env.DEV) console.log('[TrainingForm] Remote update detected — reloading');
      loadTraining();
    },
    onResumeOrDegraded: () => {
      if (hasUnsavedRef.current) return;
      if (id && isRecentSelfWrite(id)) return;
      loadTraining();
    },
  });

  // H3: Register this record as actively edited so the global Realtime IDB
  // writer in useAutoSync doesn't silently overwrite our IDB row while we
  // hold unsaved React state.
  useEffect(() => {
    if (!id || id.startsWith('temp-')) return;
    registerActiveFormRecord('trainings', id);
    const unsub = onPendingRemoteUpdate((p) => {
      if (p.table !== 'trainings' || p.recordId !== id) return;
      if (isRecentSelfWrite(id)) {
        if (import.meta.env.DEV) console.log('[TrainingForm] Suppressing pending-update toast — recent self-write');
        return;
      }
      if (import.meta.env.DEV) console.log('[TrainingForm] Pending remote update — silent reconcile');
      loadTraining();
    });
    return () => {
      unsub();
      unregisterActiveFormRecord(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Listen for JSON import events — reload form state from IndexedDB to prevent
  // stale React state from overwriting imported data on next save
  useEffect(() => {
    const handleReportImported = async (event: Event) => {
      const { reportType, reportId } = (event as CustomEvent).detail;
      if (reportType !== 'training' || reportId !== id) return;

      console.log('[TrainingForm] Detected JSON import — reloading state from IndexedDB');
      try {
        const offlineData = await getOfflineTraining(id!);
        const [da, os, ia, vi, sp, sm] = await Promise.all([
          getTrainingDataOffline('delivery_approaches', id!),
          getTrainingDataOffline('operating_systems', id!),
          getTrainingDataOffline('immediate_attention', id!),
          getTrainingDataOffline('verifiable_items', id!),
          getTrainingDataOffline('systems_in_place', id!),
          getTrainingDataOffline('summary', id!).then(d => d[0]),
        ]);

        isInternalUpdateRef.current = true;
        if (offlineData) {
          setTraining(offlineData);
          setInspectorId(offlineData.inspector_id);
        }
        setDeliveryApproaches(da); childDataLoadedRef.current.delivery_approaches = true;
        setOperatingSystems(os); childDataLoadedRef.current.operating_systems = true;
        setImmediateAttention(ia); childDataLoadedRef.current.immediate_attention = true;
        setVerifiableItems(vi); childDataLoadedRef.current.verifiable_items = true;
        setSystemsInPlace(sp); childDataLoadedRef.current.systems_in_place = true;
        if (sm) { setSummary(sm); }
        childDataLoadedRef.current.summary = true;

        // Refresh photo galleries to pick up any imported photo metadata
        setPhotoRefreshKey(prev => prev + 1);

        hasUnsavedRef.current = true;
        setHasUnsavedChanges(true);
        toast.success("Imported data loaded into form");
      } catch (e) {
        console.warn('[TrainingForm] Failed to reload after import:', e);
      }
    };

    window.addEventListener('report-data-imported', handleReportImported);
    return () => window.removeEventListener('report-data-imported', handleReportImported);
  }, [id]);

  // Track if save is in progress to prevent duplicate calls
  const saveInProgressRef = useRef(false);
  const isManualSaveRef = useRef(false);

  // Auto-save functionality with safety timeout and duplicate prevention
  const saveTraining = useCallback(async (silent = false) => {
    // Block all writes in Lovable preview to protect production data
    if ((await import('@/lib/environment')).isLovablePreview()) return;
    if (!training || !id) return;

    // Required-field gate: mirror the sync-time validator
    // (`training-validation-schemas.ts#trainingSchema`) at save time so the
    // form and the sync engine cannot disagree about which header fields
    // are required. Manual saves surface a toast; auto-saves skip silently
    // so the user isn't spammed every interval while they're still editing.
    const requiredHeaderCheck = checkRequiredHeaderFields(
      training as unknown as Record<string, unknown>,
      'training',
    );
    if (!requiredHeaderCheck.ok) {
      const missingLabels = formatMissingFieldLabels(requiredHeaderCheck.missing);
      if (!silent) {
        toast.error('Cannot save — required fields missing', {
          description: missingLabels,
        });
        setSaveError({
          message: `Required fields missing: ${missingLabels}`,
          code: 'REQUIRED_FIELD_MISSING',
        });
      } else if (import.meta.env.DEV) {
        console.log(`[Training Save] Skipping silent save — required fields missing: ${missingLabels}`);
      }
      return;
    }

    // Prevent duplicate save calls
    if (saveInProgressRef.current) {
      if (import.meta.env.DEV) console.log('[Training Save] Save already in progress, skipping');
      return;
    }

    if (import.meta.env.DEV) console.log('[Training Save] Starting save...');
    saveInProgressRef.current = true;
    setIsSaving(true);
    if (!silent) setSaveError(null);

    // Safety timeout - ensure saving state is cleared after max 8 seconds (reduced from 30).
    //
    // The `safetyTimerFired` flag is captured per-invocation so the finally
    // block can tell whether THIS invocation still owns `saveInProgressRef`
    // when it cleans up. Without it, an 8s+ save would have its mutex
    // released by the safety timer, a concurrent caller would acquire the
    // mutex, and then this invocation's finally block would clear the
    // mutex while the new caller is still mid-flight — opening a window
    // for a third caller to race the second. Same shape as the
    // deadlock-timer ownership race PR #22 fixed in
    // `InspectionForm.performSave` (`deadlockTimerFired`).
    let safetyTimerFired = false;
    const safetyTimeout = setTimeout(() => {
      console.warn('[Training Save] Safety timeout reached, forcing save state reset');
      safetyTimerFired = true;
      setIsSaving(false);
      saveInProgressRef.current = false;
    }, 8000);

    try {
      const baseUpdatedTraining = {
        ...training,
        updated_at: new Date().toISOString(),
        // DISABLED: active_duration_seconds: getElapsedSeconds(),
        // Track who modified the report if current user is not the owner
        ...(currentUser?.id && currentUser.id !== training.inspector_id 
          ? { last_modified_by: currentUser.id } 
          : {}),
      };

      // S9: Reconcile user-clear intent across all child collections + summary.
      const summaryHasContent = !!(summary && (
        summary.observations || summary.recommendations
      ));
      const totalChildCount =
        deliveryApproaches.length + operatingSystems.length +
        immediateAttention.length + verifiableItems.length +
        systemsInPlace.length + (summaryHasContent ? 1 : 0);
      const { reconcileClearIntent } = await import('@/lib/clear-intent');
      const updatedTraining = reconcileClearIntent(
        baseUpdatedTraining,
        totalChildCount,
        !!baseUpdatedTraining.synced_at,
      );

      // Save offline (fire-and-forget for UI responsiveness)
      // Guard: Only write child data if it was successfully loaded OR has items
      const childOps: Promise<unknown>[] = [saveTrainingOffline(updatedTraining, { childCountHint: totalChildCount })];
      if (deliveryApproaches.length > 0 || childDataLoadedRef.current.delivery_approaches) {
        childOps.push(saveTrainingDataOffline('delivery_approaches', id, deliveryApproaches, { allowEmpty: true }));
      } else {
        console.warn('[Training Save] Skipping delivery_approaches save — empty array not confirmed as loaded');
      }
      if (operatingSystems.length > 0 || childDataLoadedRef.current.operating_systems) {
        childOps.push(saveTrainingDataOffline('operating_systems', id, operatingSystems, { allowEmpty: true }));
      } else {
        console.warn('[Training Save] Skipping operating_systems save — empty array not confirmed as loaded');
      }
      if (immediateAttention.length > 0 || childDataLoadedRef.current.immediate_attention) {
        childOps.push(saveTrainingDataOffline('immediate_attention', id, immediateAttention, { allowEmpty: true }));
      } else {
        console.warn('[Training Save] Skipping immediate_attention save — empty array not confirmed as loaded');
      }
      if (verifiableItems.length > 0 || childDataLoadedRef.current.verifiable_items) {
        childOps.push(saveTrainingDataOffline('verifiable_items', id, verifiableItems, { allowEmpty: true }));
      } else {
        console.warn('[Training Save] Skipping verifiable_items save — empty array not confirmed as loaded');
      }
      if (systemsInPlace.length > 0 || childDataLoadedRef.current.systems_in_place) {
        childOps.push(saveTrainingDataOffline('systems_in_place', id, systemsInPlace, { allowEmpty: true }));
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

      // Show hard-saved toast immediately after localStorage snapshot (always reliable)
      if (!silent) showHardSavedToast(lastVersionNumber ? lastVersionNumber + 1 : undefined, undefined);

      let localSaveSucceeded = false;
      try {
        await Promise.all(childOps);
        localSaveSucceeded = true;
        if (import.meta.env.DEV) console.log('[Training Save] Offline storage completed');

        // Layer 2: Append-only version history (metadata only)
        appendVersion('training', id, updatedTraining, {
          delivery_approaches: deliveryApproaches,
          operating_systems: operatingSystems,
          immediate_attention: immediateAttention,
          verifiable_items: verifiableItems,
          systems_in_place: systemsInPlace,
          summary: summary ? [summary] : [],
        }, silent ? 'auto_save' : 'manual_save').then((v) => {
          if (v) {
            setLastVersionNumber(v.versionNumber);
            setLastFieldCount(v.fieldCount);
          }
        }).catch(() => {});
      } catch (offlineError) {
        console.warn('[Training Save] Offline storage failed:', offlineError);
        // Gap 2.1: re-throw IdbSaveError so the outer save handler keeps the dirty flag set
        const { isIdbSaveError } = await import('@/lib/offline-storage');
        if (isIdbSaveError(offlineError)) {
          setSaveError({
            message: 'Local save failed — your changes are NOT stored. Tap to retry.',
            code: offlineError.code,
          });
          toast.error("Save failed — your changes are NOT stored", {
            description: "Tap Save again to retry. Do not close this page.",
            duration: 8000,
          });
          throw offlineError;
        }
        toast.warning("Saved to backup — retrying storage", {
          description: "Your data is safe. Extended storage is slow on this device.",
          duration: 4000,
        });
      }

      // H10: Pre-edit snapshot: capture server state before admin overwrites it.
      // Fires regardless of online state — capturePreEditSnapshot internally
      // routes to a local queue when offline so the audit trail is never lost.
      if (localSaveSucceeded && currentUser?.id && training?.inspector_id && currentUser.id !== training.inspector_id) {
        capturePreEditSnapshot('training', id!, training.inspector_id, currentUser.id);
      }

      // If online AND local save succeeded, try to sync to Supabase
      if (isOnline && localSaveSucceeded) {
        try {
          // Strip IDB-only fields (`child_count_hint`, `dirty`) — `saveTrainingOffline`
          // MUTATES the training object in place to stamp these (S30 / C3), so by
          // the time we reach the remote write `updatedTraining` carries them.
          // Sending them to Supabase fails with PGRST204 ("Could not find the
          // 'child_count_hint' column …") which silently no-ops the cloud write.
          // Also drop `id` and `created_at`: the upsert fallback supplies its own
          // `id` and we never want to overwrite the server's original creation
          // timestamp with a (possibly skewed) local clock value. Mirrors the
          // strip list in `atomic-sync-manager.ts:LOCAL_ONLY_REMOTE_UPSERT_FIELDS`
          // and the equivalent helper in `InspectionForm.performSave` — keep all
          // three lists in sync when adding new IDB-only flags.
          const sanitizeTraining = (t: Record<string, unknown>) => {
            const {
              id: _id,
              created_at: _created_at,
              child_count_hint: _child_count_hint,
              dirty: _dirty,
              ...rest
            } = t as Record<string, unknown>;
            void _id; void _created_at; void _child_count_hint; void _dirty;
            return rest;
          };
          const sanitizedTraining = sanitizeTraining(updatedTraining as Record<string, unknown>);

          // Update main training record WITHOUT synced_at (deferred pattern)
          const { data: updateResult, error: trainingError } = await supabase
            .from('trainings')
            .update(sanitizedTraining as never)
            .eq('id', id)
            .select('id');

          if (trainingError) throw trainingError;
          
          // Verification: If 0 rows updated, record may not exist on server — use upsert
          if (!updateResult || updateResult.length === 0) {
            console.warn('[Training Save] Update returned 0 rows — falling back to upsert');
            const { error: upsertError } = await supabase
              .from('trainings')
              .upsert({ id, ...sanitizedTraining } as never);
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
          // C4: capture pre-images for restore-on-failure.
          let trainingReconciledDeletes: ReconciledTableDelete[] = [];
          const user = await getUserWithCache();
          if (user) {
            const reconcileResult = await reconcileAllChildTables(
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
            trainingReconciledDeletes = reconcileResult.deletedByTable;
          }
          
          // Helper to convert PromiseLike to proper Promise
          const dbOp = async (operation: PromiseLike<{ error: PostgrestError | null }>) => {
            const { error } = await operation;
            if (error) throw error;
          };

          if (preparedApproaches.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_delivery_approaches').upsert(preparedApproaches as never, { onConflict: 'id' }))
            );
          }

          if (preparedSystems.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_operating_systems').upsert(preparedSystems as never, { onConflict: 'id' }))
            );
          }

          if (preparedAttention.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_immediate_attention').upsert(preparedAttention as never, { onConflict: 'id' }))
            );
          }

          if (preparedVerifiable.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_verifiable_items').upsert(preparedVerifiable as never, { onConflict: 'id' }))
            );
          }

          if (preparedSystemsPlace.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_systems_in_place').upsert(preparedSystemsPlace as never, { onConflict: 'id' }))
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
              dbOp(supabase.from('training_summary').upsert(preparedSummary as never, { onConflict: 'training_id' }))
            );
          }

          // Execute all in parallel
          try {
            await Promise.all(parallelOps);
          } catch (parErr) {
            // C4: parallel upsert(s) failed — restore the rows reconcile already deleted.
            if (trainingReconciledDeletes.length > 0) {
              try {
                await restoreReconciledDeletions(trainingReconciledDeletes, id!);
              } catch (restoreErr) {
                console.error('[C4] TrainingForm: restoreReconciledDeletions threw', restoreErr);
              }
            }
            throw parErr;
          }

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
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      setSaveError(null);
    } catch (error) {
      console.error('[Training Save] Error saving training:', error);
      logError(error, { scope: 'TrainingForm.saveTraining' });
      const { isIdbSaveError } = await import('@/lib/offline-storage');
      if (isIdbSaveError(error)) {
        setSaveError({ message: error.message || 'Save failed', code: error.code });
      }
    } finally {
      clearTimeout(safetyTimeout);
      if (import.meta.env.DEV) console.log('[Training Save] Completed, setting isSaving to false');
      setIsSaving(false);
      // Only release the mutex if this invocation still owns it. If the
      // safety timer already fired, a concurrent caller has acquired the
      // mutex and we must not stomp on it.
      if (!safetyTimerFired) {
        saveInProgressRef.current = false;
      }
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
    
    // Mark as having unsaved changes (ref-guarded to avoid redundant re-renders)
    if (!hasUnsavedRef.current) {
      hasUnsavedRef.current = true;
      setHasUnsavedChanges(true);
    }
    
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
        saveTraining(true);
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
        saveTraining(true);
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
    
    const GENERATION_TIMEOUT = 120000;
    const safetyTimeout = setTimeout(() => {
      console.warn('[Training PDF] Safety timeout reached (120s) — force-releasing spinner');
      setIsGeneratingPDF(false);
      toast.error('PDF generation timed out', {
        description: 'The service is taking too long. Please try again.',
      });
    }, GENERATION_TIMEOUT);
    
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
      
      // Download the PDF — fetch as blob so we can enforce the filename
      if (data?.pdfUrl) {
        try {
          const pdfResp = await fetch(data.pdfUrl);
          if (pdfResp.ok) {
            const blob = await pdfResp.blob();
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = formatReportFilename(training?.organization, 'training', 'pdf');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
          }
        } catch (dlErr) {
          console.warn('[Training PDF] Blob download failed, falling back to direct link', dlErr);
          const link = document.createElement('a');
          link.href = data.pdfUrl;
          link.download = formatReportFilename(training?.organization, 'training', 'pdf');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        
        // Show email dialog after a short delay
        setTimeout(() => setShowEmailDialog(true), 500);
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF', {
        description: errorMessage(error, 'Please try again.'),
      });
    } finally {
      clearTimeout(safetyTimeout);
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
    } catch (error) {
      console.error('Error sending email:', error);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleGenerateHTML = async () => {
    if (!id) return;
    
    setIsGeneratingHTML(true);
    const progressToastId = toast.loading("Generating report...");
    
    // Safety timeout - NEVER get stuck in generating state (60 seconds max)
    const GENERATION_TIMEOUT = 120000;
    const safetyTimeoutHandle = setTimeout(() => {
      console.error('[HTML Generation] Safety timeout reached after 60 seconds - force resetting state');
      setIsGeneratingHTML(false);
      toast.dismiss(progressToastId);
      toast.error("Report generation timed out", {
        description: "Please check your connection and try again.",
      });
    }, GENERATION_TIMEOUT);
    
    try {
      // OPTIMIZATION: Client-side cache check — if report was already generated after last update
      if (training?.latest_report_generated_at && training?.updated_at) {
        const generatedAt = new Date(training.latest_report_generated_at).getTime();
        const updatedAt = new Date(training.updated_at).getTime();
        
        if (generatedAt >= updatedAt) {
          console.log('[HTML Generation] Client-side cache HIT — fetching cached report from DB');
          toast.loading("Loading cached report...", { id: progressToastId });
          const cachedHtml = await getLatestReport();
          if (cachedHtml) {
            clearTimeout(safetyTimeoutHandle);
            toast.dismiss(progressToastId);
            setReportHtml(cachedHtml);
            setHtmlViewerOpen(true);
            setIsGeneratingHTML(false);
            return;
          }
          console.log('[HTML Generation] Cache returned empty, falling through to generation');
        }
      }

      toast.loading("Saving changes first...", { id: progressToastId });
      await saveTraining();
      toast.loading("Generating report...", { id: progressToastId });
      
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
      
      // Backend now returns a signed URL instead of raw HTML
      let html: string;
      
      if (data?.htmlUrl) {
        console.log('[HTML Generation] Fetching HTML from signed URL...');
        const htmlResponse = await fetch(data.htmlUrl);
        if (!htmlResponse.ok) {
          throw new Error(`Failed to fetch report: ${htmlResponse.status} ${htmlResponse.statusText}`);
        }
        html = await htmlResponse.text();
      } else if (data?.html) {
        html = data.html;
      } else {
        throw new Error('No HTML content or URL received from server');
      }
      
      // Auto-sync report to database for "latest report" functionality
      await syncReport(html);
      
      const filename = formatReportFilename(training?.organization, 'training', 'html');
      const title = formatReportTitle(training?.organization, 'training');

      // Always use in-app viewer for consistent Save PDF + Close buttons
      toast.dismiss(progressToastId);
      setReportHtml(html);
      setHtmlViewerOpen(true);
    } catch (error) {
      toast.dismiss(progressToastId);
      const msg = errorMessage(error, '');
      console.error('[HTML Generation] Error:', msg || error);

      if (msg.includes('TIMEOUT')) {
        toast.error("Report generation timed out", {
          description: "Please check your connection and try again.",
        });
      } else {
        toast.error("Failed to generate report", {
          description: msg || "Please try again.",
        });
      }
    } finally {
      clearTimeout(safetyTimeoutHandle);
      setIsGeneratingHTML(false);
    }
  };

  const completeTraining = useCallback(async (attestation?: AttestationPayload) => {
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
        app_version_at_completion: APP_VERSION_FULL,
        ...(attestation || {}),
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
          // Update main training record (include attestation + version when present)
          const trainingUpdate: Record<string, unknown> = {
            status: 'completed',
            updated_at: completedTraining.updated_at,
            app_version_at_completion: APP_VERSION_FULL,
          };
          if (attestation) Object.assign(trainingUpdate, attestation);
          const { error: trainingError } = await supabase
            .from('trainings')
            .update(trainingUpdate as never)
            .eq('id', id);

          if (trainingError) throw trainingError;

          // Safe upsert pattern (matches saveTraining) - never deletes existing data
          const prepareItems = <T extends { id?: string }>(items: T[], foreignKey: string) => 
            items.map(item => ({
              ...item,
              id: item.id?.startsWith('temp-') ? crypto.randomUUID() : (item.id || crypto.randomUUID()),
              [foreignKey]: id
            }));

          const dbOp = async (operation: PromiseLike<{ error: PostgrestError | null }>) => {
            const { error } = await operation;
            if (error) throw error;
          };

          const parallelOps: Promise<void>[] = [];

          if (deliveryApproaches.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_delivery_approaches').upsert(prepareItems(deliveryApproaches, 'training_id') as never, { onConflict: 'id' }))
            );
          }

          if (operatingSystems.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_operating_systems').upsert(prepareItems(operatingSystems, 'training_id') as never, { onConflict: 'id' }))
            );
          }

          if (immediateAttention.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_immediate_attention').upsert(prepareItems(immediateAttention, 'training_id') as never, { onConflict: 'id' }))
            );
          }

          if (verifiableItems.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_verifiable_items').upsert(prepareItems(verifiableItems, 'training_id') as never, { onConflict: 'id' }))
            );
          }

          if (systemsInPlace.length > 0) {
            parallelOps.push(
              dbOp(supabase.from('training_systems_in_place').upsert(prepareItems(systemsInPlace, 'training_id') as never, { onConflict: 'id' }))
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
              dbOp(supabase.from('training_summary').upsert(preparedSummary as never, { onConflict: 'training_id' }))
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

  const updateTrainingField = (field: string, value: unknown) => {
    // PR-A: route every header-field write through `applyTrackedFieldWrite`
    // so tracked fields populate `field_timestamps` for cross-device merge.
    //
    // Sync-mirror the unsaved flag onto the ref BEFORE setTraining so the
    // form-scoped Realtime UPDATE handler sees the in-flight edit. The
    // change-tracker `useEffect` is keyed on child-data deps only, so a
    // header-only edit (e.g. `trainer_name`) wouldn't otherwise flip
    // `hasUnsavedRef` until a child-data change happened. Without this,
    // atomic-sync's `refetchTrainingPackage` round-trip can fire a Realtime
    // UPDATE inside the debounce window and clobber the in-memory edit.
    hasUnsavedRef.current = true;
    if (!hasUnsavedChanges) setHasUnsavedChanges(true);
    setTraining(applyTrackedFieldWrite(training, 'training', field, value));
  };

  const updateSummaryField = (field: string, value: unknown) => {
    setSummary({ ...summary, [field]: value });
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
        hasUnsavedChanges={hasUnsavedChanges && (training?.status !== 'completed' || completionLockOverridden)}
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
          try {
            await Promise.race([
              handleSaveAndLeave(),
              new Promise(resolve => setTimeout(resolve, 8000)),
            ]);
            // emitSyncComplete removed — save-before-leave is not a real sync
            markPendingDashboardRefresh();
            markDashboardStaleTimestamp();
          } catch (e) {
            console.warn('[TrainingForm] Save-before-leave error:', e);
          } finally {
            setIsSavingBeforeLeave(false);
          }
          setShowLeaveDialog(false);
          bypassAndProceed();
          navigate('/dashboard');
        }}
        onLeave={() => {
          markPendingDashboardRefresh();
          markDashboardStaleTimestamp();
          setShowLeaveDialog(false);
          bypassAndProceed();
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
                lastSaved={lastManuallySaved}
                isSaving={isSaving}
                hasUnsavedChanges={hasUnsavedChanges}
                error={saveError}
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
                onClick={async () => { await saveTraining(); setLastManuallySaved(new Date()); }} 
                disabled={isSaving}
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
                onClick={async () => {
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
                  const ok = await downloadReportBackup('training', id);
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
              {id && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Refresh Report Data"
                disabled={refreshing || isSaving}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await loadTraining();
                    toast.success("Report refreshed", { description: "Latest data loaded successfully." });
                  } catch {
                    toast.error("Refresh failed");
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              </Button>
              )}
              {training?.status !== 'completed' && (
              <Button 
                size={isMobile ? "default" : "sm"} 
                onClick={() => {
                  const missing = getMissingTrainingFields(training);
                  if (missing.length) {
                    setMissingRequiredFields(missing);
                    toast.error('Cannot complete report', {
                      id: `completion-blocked-${id}`,
                      description: formatMissingDescription(missing),
                      duration: Infinity,
                      className: 'border border-destructive-foreground/20',
                      style: {
                        background: 'hsl(var(--destructive))',
                        color: 'hsl(var(--destructive-foreground))',
                      },
                    });
                    document.getElementById(`field-${missing[0].key}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                  }
                  toast.dismiss(`completion-blocked-${id}`);
                  setMissingRequiredFields([]);
                  if (training?.attestation_signed_at) {
                    setShowCompleteDialog(true);
                  } else {
                    setShowAttestationDialog(true);
                  }
                }}
                disabled={isSaving}
                className={isMobile ? "min-w-[100px] h-10 text-sm font-medium" : ""}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                    <span>Complete</span>
                  </>
                )}
              </Button>
              )}
              {training?.status === 'completed' && (
                <Button disabled variant="outline" size={isMobile ? "default" : "sm"} className="opacity-70 cursor-default">
                  <CheckCircle className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                  <span>Completed</span>
                </Button>
              )}
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
                {isAdmin && training?.status === 'completed' && (
                  <Button
                    variant="outline"
                    size={isMobile ? "default" : "sm"}
                    onClick={toggleInvoiced}
                    disabled={invoiceToggling}
                    className={cn("bg-emerald-500/10 backdrop-blur-md border-emerald-400/30 text-emerald-600 dark:text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.15)] hover:bg-emerald-500/20 hover:text-emerald-700 dark:hover:text-emerald-300", isInvoiced && "bg-emerald-500/25 shadow-[0_0_16px_rgba(16,185,129,0.3)] animate-pulse-calm")}
                  >
                    <Receipt className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                    {isMobile ? "" : (isInvoiced ? "Invoiced ✓" : "Invoice")}
                  </Button>
                )}
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <SaveFailureBanner
        saveError={saveError}
        onRetry={() => saveTrainingRef.current?.() ?? Promise.resolve()}
        onExportDraft={() => ({
          training,
          delivery_approaches: deliveryApproaches,
          operating_systems: operatingSystems,
          immediate_attention: immediateAttention,
          verifiable_items: verifiableItems,
          systems_in_place: systemsInPlace,
          summary,
          exported_at: new Date().toISOString(),
        })}
        reportType="training"
        reportId={id}
      />

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

        {(() => {
          const requiredHeaderCheck = checkRequiredHeaderFields(
            training as unknown as Record<string, unknown>,
            'training',
          );
          if (requiredHeaderCheck.ok) return null;
          const missingLabels = formatMissingFieldLabels(requiredHeaderCheck.missing);
          return (
            <div
              role="alert"
              className="border-2 border-red-500/60 bg-red-950/30 text-red-400 font-mono text-xs px-4 py-3 rounded flex items-start gap-2 mb-4"
              data-testid="required-fields-banner"
            >
              <Lock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">SAVING DISABLED — required fields missing</div>
                <div>
                  Fill in <span className="text-red-200">{missingLabels}</span> to resume saving. Edits to other fields stay visible in the form but will not persist until the required fields are filled.
                </div>
              </div>
            </div>
          );
        })()}

        <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-6">
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
                  userProfile={inspectorProfile as { first_name?: string; last_name?: string } | null}
                  modifiedByProfile={modifiedByProfile as { first_name?: string; last_name?: string } | null}
                  missingFieldKeys={missingRequiredFields.map(m => m.key)}
                />
                {id && currentUser?.id && (
                  <CollaboratorPresence
                    reportId={id}
                    reportType="training"
                    currentUserId={currentUser.id}
                    currentUserName={signerFullName || currentUser?.email || 'Someone'}
                  />
                )}
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
                  onImmediateSave={triggerImmediateSave}
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
        title={formatReportTitle(training?.organization, 'training')}
        filename={formatReportFilename(training?.organization, 'training', 'html')}
        isOpen={htmlViewerOpen}
        onClose={() => setHtmlViewerOpen(false)}
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
            <AlertDialogAction onClick={() => completeTraining()}>
              Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AttestationDialog
        open={showAttestationDialog}
        onOpenChange={setShowAttestationDialog}
        kind="training"
        signerName={signerFullName}
        signerId={training?.trainer_id ?? null}
        organization={training?.organization || ''}
        reportDate={training?.training_date || new Date().toISOString().slice(0, 10)}
        onSigned={(payload) => completeTraining(payload)}
      />
    </>
  );
}
