import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { trackChildDeletions } from "@/lib/track-child-deletions";
import { formatReportFilename, formatReportTitle } from "@/lib/report-naming";
import { useReportTabHistory } from "@/hooks/useReportTabHistory";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isLocalDataNewer } from "@/lib/local-data-guards";
import { applyTrackedFieldWrite, mergeRecordFields, mergeChildArray, TRACKED_FIELDS, TRAINING_SUMMARY_FIELDS } from "@/lib/field-merge";
import { isFieldActivelyEdited, recordActiveEditSkip } from "@/lib/active-edit-guard";
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
import { TrainingHeaderSection } from "@/components/training/TrainingHeaderSection";
import { loadTrainingFromOffline, fetchTrainingParentFromServer, fetchTrainingChildrenFromServer } from "@/lib/form-loaders/trainingLoader";
import { persistTrainingToOffline, pushTrainingToRemote } from "@/lib/form-savers/trainingSaver";
import { getMissingTrainingFields, formatMissingDescription, type MissingField } from "@/lib/required-fields";
import { shouldUseCachedTrainingReport } from "@/lib/training-report-cache-decision";
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

import { summaryFieldTimestampMs, isEmptyPlaceholderSummary } from "@/lib/training-summary-merge";

function logTrainingSummaryAutosave(event: string, meta: Record<string, unknown> = {}) {
  if (typeof console === 'undefined') return;
  console.info('[TrainingSummaryAutosave]', { event, at: new Date().toISOString(), ...meta });
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
  const trainingRef = useRef<DbRow | null>(null);
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

  // ── Deletion-aware merge tracking ────────────────────────────────────────
  // See InspectionForm for full rationale. Sets are populated only when the
  // user removes a non-temp row via the table UI (the wrapped tracked setter
  // below), and are auto-pruned per-id by `mergeChildArray` when the server
  // snapshot confirms the row is gone. Wholesale clear happens only on
  // confirmed sync success or component unmount.
  const deletedDeliveryIdsRef = useRef<Set<string>>(new Set());
  const deletedOperatingSystemIdsRef = useRef<Set<string>>(new Set());
  const deletedImmediateAttentionIdsRef = useRef<Set<string>>(new Set());
  const deletedVerifiableIdsRef = useRef<Set<string>>(new Set());
  const deletedSystemsInPlaceIdsRef = useRef<Set<string>>(new Set());
  const setDeliveryApproachesTracked = useMemo(
    () => trackChildDeletions(setDeliveryApproaches, deletedDeliveryIdsRef), [],
  );
  const setOperatingSystemsTracked = useMemo(
    () => trackChildDeletions(setOperatingSystems, deletedOperatingSystemIdsRef), [],
  );
  const setImmediateAttentionTracked = useMemo(
    () => trackChildDeletions(setImmediateAttention, deletedImmediateAttentionIdsRef), [],
  );
  const setVerifiableItemsTracked = useMemo(
    () => trackChildDeletions(setVerifiableItems, deletedVerifiableIdsRef), [],
  );
  const setSystemsInPlaceTracked = useMemo(
    () => trackChildDeletions(setSystemsInPlace, deletedSystemsInPlaceIdsRef), [],
  );
  const trainingDeletedIdsByTable: Record<string, React.MutableRefObject<Set<string>>> = useMemo(() => ({
    delivery_approaches: deletedDeliveryIdsRef,
    operating_systems: deletedOperatingSystemIdsRef,
    immediate_attention: deletedImmediateAttentionIdsRef,
    verifiable_items: deletedVerifiableIdsRef,
    systems_in_place: deletedSystemsInPlaceIdsRef,
  }), []);
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
  const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInternalUpdateRef = useRef(false);
  const summaryAutoPopulatedRef = useRef(false);
  const hasUnsavedRef = useRef(false);
  const summaryRef = useRef<DbRow | null>(null);
  const pendingSummaryFieldsRef = useRef<Record<string, string>>({});
  const summaryLocalSnapshotRef = useRef<DbRow | null>(null);

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

  useEffect(() => {
    trainingRef.current = training;
    summaryRef.current = summary;
  }, [training, summary]);
  
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
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
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
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
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
  useEmergencySave({
    hasUnsavedChanges,
    saving: isSaving,
    saveDebounceTimerRef,
    performSaveRef: saveTrainingRef as React.MutableRefObject<((silent?: boolean) => Promise<void>) | undefined>,
    formName: 'TrainingForm',
    onEmergencySnapshot: () => {
      const latestTraining = trainingRef.current;
      const latestSummary = summaryRef.current;
      if (latestTraining && id) {
        logTrainingSummaryAutosave('visibility-hidden-snapshot', { pendingFields: Object.keys(pendingSummaryFieldsRef.current), hasSummary: !!latestSummary, summaryUpdatedAt: latestSummary?.updated_at ?? null });
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
            saveReportSnapshot('training', id, latestTraining, {
              delivery_approaches: deliveryApproaches,
              operating_systems: operatingSystems,
              immediate_attention: immediateAttention,
              verifiable_items: verifiableItems,
              systems_in_place: systemsInPlace,
              summary: latestSummary ? [latestSummary] : [],
            }, !!latestTraining.synced_at, photoMeta);
          }).catch(() => {
            saveReportSnapshot('training', id, latestTraining, {
              delivery_approaches: deliveryApproaches,
              operating_systems: operatingSystems,
              immediate_attention: immediateAttention,
              verifiable_items: verifiableItems,
              systems_in_place: systemsInPlace,
              summary: latestSummary ? [latestSummary] : [],
            }, !!latestTraining.synced_at);
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
        .select('avatar_url, first_name, last_name')
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

  // Auto-populate Person Submitting (current logged-in user, NOT report creator)
  // and Submission Date (today's local date) on first load when blank. Manual
  // values are always preserved. Skipped in read-only/locked reports.
  useEffect(() => {
    if (!summary || isLoading || summaryAutoPopulatedRef.current) return;
    if (effectiveReadOnly) return;

    const updates = computeSummaryAutofill({
      summary,
      currentUser,
      currentUserProfile,
      today: format(new Date(), 'yyyy-MM-dd'),
    });

    if (Object.keys(updates).length > 0) {
      setSummary({ ...summary, ...updates });
      // Persist autofill through the normal autosave path so values survive reload.
      setTimeout(() => { triggerImmediateSave(); }, 0);
    }

    summaryAutoPopulatedRef.current = true;
  }, [summary?.id, isLoading, currentUser?.id, currentUserProfile, effectiveReadOnly, triggerImmediateSave]);


  const loadTraining = useCallback(async () => {
      if (!id) return;

      try {
        // Race-fix: flush any pending debounced save into IDB before reading,
        // so the offline read includes the user's most recent edits.
        if (saveDebounceTimerRef.current || hasUnsavedRef.current) {
          try {
            if (saveDebounceTimerRef.current) {
              clearTimeout(saveDebounceTimerRef.current);
              saveDebounceTimerRef.current = null;
            }
            logTrainingSummaryAutosave('pre-load-flush-start', { pendingFields: Object.keys(pendingSummaryFieldsRef.current), hasUnsaved: hasUnsavedRef.current });
            await saveTrainingRef.current?.();
          } catch (e) {
            console.warn('[TrainingForm] Pre-load flush failed (continuing):', e);
          }
        }

        // Try loading from offline storage first (delegated to pure loader)
        const {
          training: offlineTraining,
          delivery_approaches,
          operating_systems,
          immediate_attention,
          verifiable_items,
          systems_in_place,
          summary: summaryData,
        } = await loadTrainingFromOffline(id);

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
          setSummary(prev => {
            const incoming = summaryData || { id: crypto.randomUUID(), training_id: id };
            const local = summaryRef.current ?? prev;
            const dirtyFields = pendingSummaryFieldsRef.current;
            const dirtyNames = Object.keys(dirtyFields);
            if (!local || dirtyNames.length === 0) return incoming;
            // Empty placeholder must never beat a populated server summary.
            if (isEmptyPlaceholderSummary(local)) return incoming;
            const unresolved = dirtyNames.filter(field => summaryFieldTimestampMs(incoming, field) < new Date(dirtyFields[field]).getTime());
            if (unresolved.length === 0) return incoming;
            recordActiveEditSkip({ form: 'training', table: 'summary', rowId: incoming.id ?? null, field: unresolved.join(','), reason: 'dirty', source: 'load' });
            logTrainingSummaryAutosave('offline-summary-local-won', { source: 'load', fields: unresolved, pendingFields: dirtyNames, incomingUpdatedAt: incoming.updated_at ?? null });
            return mergeRecordFields(local as DbRow & { field_timestamps?: Record<string, string> | null }, incoming as DbRow & { field_timestamps?: Record<string, string> | null }, [...TRAINING_SUMMARY_FIELDS]);
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
          const { training: trainingData, error: trainingError } = await fetchTrainingParentFromServer(id);

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

          // Parent row: respect localIsNewer to preserve in-flight parent edits.
          if (localIsNewer) {
            if (import.meta.env.DEV) console.log('[TrainingForm] Local parent is newer -- preserving local parent state (children still refresh)');
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
            saveTrainingOffline(
              { ...trainingData, synced_at: trainingData.synced_at || new Date().toISOString() },
              { markDirty: false, explicitUserSave: false, dispatchSyncEvent: false },
            ).catch(e =>
              console.warn('[TrainingForm] Non-critical: failed to cache training', e)
            );
          }

          // Children: always fetch + merge from server when parent exists
          // server-side. Decoupled from `localIsNewer` so observations,
          // recommendations, and other child rows that were added/edited on
          // another device (or never cached locally — e.g. admin opening a
          // foreign report) become visible in the editor, matching what the
          // generator/exporter already reads.
          if (trainingData) {
            const {
              delivery_approaches: approachData,
              operating_systems: systemData,
              immediate_attention: attentionData,
              verifiable_items: verifiableData,
              systems_in_place: systemsPlaceData,
              summary: summaryResult,
            } = await fetchTrainingChildrenFromServer(id);

            isInternalUpdateRef.current = true;
            childDataLoadedRef.current.delivery_approaches = true;
            childDataLoadedRef.current.operating_systems = true;
            childDataLoadedRef.current.immediate_attention = true;
            childDataLoadedRef.current.verifiable_items = true;
            childDataLoadedRef.current.systems_in_place = true;
            childDataLoadedRef.current.summary = true;

            // Active-edit guard: if user is mid-edit, prefer per-row merge
            // (mergeChildArray already preserves local-only + temp-* rows;
            // for the singleton summary row we keep local entirely on focus).
            const childGuard = isFieldActivelyEdited({
              hasUnsavedRef,
              debounceTimerRef: saveDebounceTimerRef,
              focusContainerSelector: '[data-form-section="training-summary"]',
            });

            const applyChild = (
              table: string,
              localRows: DbRow[],
              serverRows: DbRow[] | null | undefined,
              setter: (rows: DbRow[]) => void,
              persist: (rows: DbRow[]) => Promise<void>,
            ) => {
              if (serverRows && serverRows.length > 0) {
                const local = localRows.filter(r => typeof r.id === 'string') as (DbRow & { id: string; display_order?: number | null })[];
                const server = serverRows.filter(r => typeof r.id === 'string') as (DbRow & { id: string; display_order?: number | null })[];
                const deletedRef = trainingDeletedIdsByTable[table];
                const merged = mergeChildArray(local, server, {
                  table,
                  deletedIds: deletedRef?.current,
                  onDeletedIdConfirmed: deletedRef ? (rid: string) => { deletedRef.current.delete(rid); } : undefined,
                }) as unknown as DbRow[];
                setter(merged);
                persist(serverRows).catch(e =>
                  console.warn(`[TrainingForm] Non-critical: failed to cache ${table}`, e));
                if (merged.length !== serverRows.length) {
                  recordActiveEditSkip({ form: 'training', table, reason: childGuard.reason ?? 'dirty', source: 'load' });
                }
              } else if (localRows.length > 0) {
                console.warn(`[TrainingForm] Server returned empty ${table} but local has data -- preserving local`);
                if (childGuard.active) {
                  recordActiveEditSkip({ form: 'training', table, reason: childGuard.reason!, source: 'load' });
                }
              }
            };

            applyChild('delivery_approaches', deliveryApproaches, approachData, setDeliveryApproaches, (r) => saveTrainingDataOffline('delivery_approaches', id, r));
            applyChild('operating_systems', operatingSystems, systemData, setOperatingSystems, (r) => saveTrainingDataOffline('operating_systems', id, r));
            applyChild('immediate_attention', immediateAttention, attentionData, setImmediateAttention, (r) => saveTrainingDataOffline('immediate_attention', id, r));
            applyChild('verifiable_items', verifiableItems, verifiableData, setVerifiableItems, (r) => saveTrainingDataOffline('verifiable_items', id, r));
            applyChild('systems_in_place', systemsInPlace, systemsPlaceData, setSystemsInPlace, (r) => saveTrainingDataOffline('systems_in_place', id, r));

            // Summary singleton: dirty-field merge. Local Summary edits stay
            // authoritative until the same/newer field timestamp is observed
            // from the incoming row; focus/debounce windows are not enough for
            // app-return after 1–2 minutes.
            if (summaryResult) {
              const dirtyFields = pendingSummaryFieldsRef.current;
              const dirtyNames = Object.keys(dirtyFields);
              setSummary(prev => {
                if (!prev) return summaryResult as DbRow;
                // Empty placeholder must never beat a populated server summary.
                if (isEmptyPlaceholderSummary(prev)) {
                  summaryRef.current = summaryResult as DbRow;
                  return summaryResult as DbRow;
                }
                let next = mergeRecordFields(
                  prev as DbRow & { field_timestamps?: Record<string, string> | null },
                  summaryResult as DbRow & { field_timestamps?: Record<string, string> | null },
                  [...TRAINING_SUMMARY_FIELDS],
                ) as DbRow;
                const unresolved = dirtyNames.filter(field => {
                  const dirtyMs = new Date(dirtyFields[field]).getTime();
                  const incomingMs = summaryFieldTimestampMs(summaryResult as DbRow, field);
                  return !Number.isFinite(dirtyMs) || incomingMs < dirtyMs;
                });
                if (unresolved.length > 0) {
                  next = { ...next, ...Object.fromEntries(unresolved.map(field => [field, prev[field]])) } as DbRow;
                  next.field_timestamps = { ...((next.field_timestamps as Record<string, string> | null) ?? {}), ...Object.fromEntries(unresolved.map(field => [field, dirtyFields[field]])) };
                  next.updated_at = prev.updated_at || next.updated_at;
                  recordActiveEditSkip({ form: 'training', table: 'summary', rowId: (summaryResult as DbRow).id ?? null, field: unresolved.join(','), reason: childGuard.reason ?? 'dirty', source: 'load' });
                  logTrainingSummaryAutosave('incoming-summary-merged-local-won', { source: 'load', fields: unresolved, pendingFields: dirtyNames, incomingUpdatedAt: summaryResult.updated_at ?? null });
                } else if (dirtyNames.length > 0) {
                  pendingSummaryFieldsRef.current = {};
                  summaryLocalSnapshotRef.current = null;
                  logTrainingSummaryAutosave('incoming-summary-confirmed', { source: 'load', fields: dirtyNames, incomingUpdatedAt: summaryResult.updated_at ?? null });
                } else {
                  logTrainingSummaryAutosave('incoming-summary-applied', { source: 'load', incomingUpdatedAt: summaryResult.updated_at ?? null });
                }
                summaryRef.current = next;
                return next;
              });
              saveTrainingDataOffline('summary', id, summaryResult).catch(e =>
                console.warn('[TrainingForm] Non-critical: failed to cache summary', e));
            } else if (!summaryData) {
              setSummary({ id: crypto.randomUUID(), training_id: id });
            }

            if (import.meta.env.DEV) {
              try {
                const obs = (summaryResult as DbRow | null | undefined)?.observations as string | null | undefined;
                const rec = (summaryResult as DbRow | null | undefined)?.recommendations as string | null | undefined;
                console.debug('[training-editor.load.parity]', {
                  trainingId: id,
                  source: 'editor',
                  summary: {
                    id: (summaryResult as DbRow | null | undefined)?.id ?? null,
                    hasObservations: !!obs,
                    hasRecommendations: !!rec,
                    obsLen: typeof obs === 'string' ? obs.length : 0,
                    recLen: typeof rec === 'string' ? rec.length : 0,
                  },
                  counts: {
                    delivery: (approachData || []).length,
                    operating_systems: (systemData || []).length,
                    immediate_attention: (attentionData || []).length,
                    verifiable: (verifiableData || []).length,
                    systems_in_place: (systemsPlaceData || []).length,
                  },
                });
              } catch { /* ignore trace errors */ }
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
      // Active-edit guard: also skip if a debounced save is pending — the
      // unsaved-ref alone misses the gap between the keystroke that bumps
      // the ref and the eventual flush.
      const guard = isFieldActivelyEdited({
        hasUnsavedRef,
        debounceTimerRef: saveDebounceTimerRef,
        focusContainerSelector: '[data-form-section="training-summary"]',
      });
      if (guard.active) {
        recordActiveEditSkip({ form: 'training', table: 'trainings', rowId: id ?? null, reason: guard.reason!, source: 'realtime' });
        return;
      }
      if (id && isRecentSelfWrite(id)) {
        if (import.meta.env.DEV) console.log('[TrainingForm] Skipping remote refresh — recent self-write');
        return;
      }
      if (import.meta.env.DEV) console.log('[TrainingForm] Remote update detected — reloading');
      loadTraining();
    },
    onResumeOrDegraded: () => {
      const guard = isFieldActivelyEdited({
        hasUnsavedRef,
        debounceTimerRef: saveDebounceTimerRef,
        focusContainerSelector: '[data-form-section="training-summary"]',
      });
      if (guard.active) {
        recordActiveEditSkip({ form: 'training', table: 'trainings', rowId: id ?? null, reason: guard.reason!, source: 'visibility' });
        return;
      }
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
        // JSON import is an explicit reset — clear deletion-tracking refs.
        deletedDeliveryIdsRef.current.clear();
        deletedOperatingSystemIdsRef.current.clear();
        deletedImmediateAttentionIdsRef.current.clear();
        deletedVerifiableIdsRef.current.clear();
        deletedSystemsInPlaceIdsRef.current.clear();
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
      // Save Progress UI lifecycle fix: give the user clear feedback rather
      // than a silent no-op when they click during a previous save (which
      // may now be in its remote-sync tail after the local-commit
      // early-release below). Mark dirty so the autosave layer picks up
      // any new changes on its next cycle.
      if (!silent) {
        if (hasUnsavedRef.current || hasUnsavedChanges) {
          setHasUnsavedChanges(true);
          toast.info("Save queued", {
            description: "Finishing previous sync — your latest changes will save next.",
            duration: 2500,
          });
        } else {
          toast.success("Already saved", {
            description: "Finishing background sync.",
            duration: 2000,
          });
        }
      }
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
    // Save Progress UI lifecycle fix: tracks whether the early local-commit
    // release has already flipped the button/loading flag. NARROW SCOPE —
    // only releases `isSaving` + `saveInProgressRef` so the Save Progress
    // button re-enables as soon as the local hard-save lands. Dirty
    // clearing, `lastSaved`, and the merge/active-edit guard inputs are
    // unchanged and still happen at full completion below.
    let localCommittedRef = false;
    const releaseSaveUiAfterLocalCommit = () => {
      if (localCommittedRef || safetyTimerFired) return;
      localCommittedRef = true;
      clearTimeout(safetyTimeout);
      setIsSaving(false);
      saveInProgressRef.current = false;
      if (import.meta.env.DEV) {
        console.log('[Training Save] Local hard-save committed — Save Progress button released; remote sync continues in background');
      }
    };
    const safetyTimeout = setTimeout(() => {
      if (localCommittedRef) return;
      console.warn('[Training Save] Safety timeout reached, forcing save state reset');
      safetyTimerFired = true;
      setIsSaving(false);
      saveInProgressRef.current = false;
    }, 8000);

    try {
      const latestSummary = summaryRef.current ?? summary;
      const latestTraining = trainingRef.current ?? training;
      const payload = {
        id: id!,
        training: latestTraining,
        deliveryApproaches,
        operatingSystems,
        immediateAttention,
        verifiableItems,
        systemsInPlace,
        summary: latestSummary,
      };
      logTrainingSummaryAutosave('save-start', { silent, pendingFields: Object.keys(pendingSummaryFieldsRef.current), hasSummary: !!latestSummary, summaryUpdatedAt: latestSummary?.updated_at ?? null });

      // Phase 1 — IDB + snapshot + version history (always runs)
      const persisted = await persistTrainingToOffline(payload, {
        currentUserId: currentUser?.id,
        childDataLoaded: childDataLoadedRef.current as never,
        silent,
        onVersionAppended: (info) => {
          setLastVersionNumber(info.versionNumber);
          setLastFieldCount(info.fieldCount);
        },
      });
      const { updatedTraining, localSaveSucceeded, offlineError } = persisted;

      // Show hard-saved toast immediately after localStorage snapshot (which
      // persistTrainingToOffline writes first; always reliable)
      if (!silent) showHardSavedToast(lastVersionNumber ? lastVersionNumber + 1 : undefined, undefined);

      // Surface IDB save failures the same way the inline version did
      if (offlineError) {
        console.warn('[Training Save] Offline storage failed:', offlineError);
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

      // H10: Pre-edit snapshot when an admin (non-owner) edits the report.
      // Routes internally to a local queue when offline.
      if (localSaveSucceeded && currentUser?.id && training?.inspector_id && currentUser.id !== training.inspector_id) {
        capturePreEditSnapshot('training', id!, training.inspector_id, currentUser.id);
      }
      if (localSaveSucceeded) {
        logTrainingSummaryAutosave('local-save-committed', { pendingFields: Object.keys(pendingSummaryFieldsRef.current), summaryUpdatedAt: latestSummary?.updated_at ?? null });
        // Save Progress UI lifecycle fix — release the button BEFORE the
        // remote sync tail runs. Only flips button/loading state.
        releaseSaveUiAfterLocalCommit();
      }

      // Phase 2 — push to Supabase (online + local save succeeded)
      if (isOnline && localSaveSucceeded) {
        try {
          const { syncTimestamp } = await pushTrainingToRemote(payload, { updatedTraining });
          // Mark local as synced only after server confirmation
          await saveTrainingOffline({ ...updatedTraining, synced_at: syncTimestamp });
          markSnapshotSynced('training', id!);
          // Confirmed successful round-trip persisted the shorter child arrays.
          // Wholesale-clear deletion-tracking refs; future stale snapshots are
          // reconciled against now-authoritative server state.
          deletedDeliveryIdsRef.current.clear();
          deletedOperatingSystemIdsRef.current.clear();
          deletedImmediateAttentionIdsRef.current.clear();
          deletedVerifiableIdsRef.current.clear();
          deletedSystemsInPlaceIdsRef.current.clear();
          logTrainingSummaryAutosave('remote-save-committed', { pendingFields: Object.keys(pendingSummaryFieldsRef.current), syncTimestamp });
          if (import.meta.env.DEV) console.log('[Training Save] Synced to database (verified)');
        } catch (error) {
          // Escalated from DEV-only — silent failures here were how empty
          // Observations/Recommendations slipped past us. The IDB write
          // already committed the summary row, and we deliberately leave
          // `synced_at` unset so the background sync loop replays the
          // training + ALL its child rows (including training_summary) on
          // the next pass, recovering the text.
          console.warn('[Training Save] Remote sync failed; relying on IDB+bg-sync replay for summary text:', error);
          logTrainingSummaryAutosave('remote-save-failed', { pendingFields: Object.keys(pendingSummaryFieldsRef.current), error: (error as Error)?.message });
          try {
            await Promise.race([
              queueTrainingOperation('update', id!, updatedTraining),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
            ]);
          } catch (e) {
            console.warn('[TrainingForm] Queue operation failed/timed out:', e);
          }
        }
      } else {
        // Offline (or local save failed) — queue for later sync
        if (import.meta.env.DEV) console.log('[Training Save] Offline - queuing for sync');
        try {
          await Promise.race([
            queueTrainingOperation('update', id!, updatedTraining),
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
      // Skip if the early local-commit release or the safety timer already
      // handled UI/mutex cleanup — avoids stomping a newer invocation.
      if (!safetyTimerFired && !localCommittedRef) {
        setIsSaving(false);
        saveInProgressRef.current = false;
      }
    }
      }, [training, id, deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, isOnline]);

  // Keep saveTrainingRef pointing to the latest saveTraining on every render
  saveTrainingRef.current = saveTraining;

  // Auto-save/sync retry is now handled by useAutoSync hook

  // Debounced auto-save on data changes (1.5s) — runs for owners AND admins
  // editing another trainer's record. RLS already permits admin writes
  // (`Admins can manage all training summaries`), so the previous owner-only
  // gate was a UX bug that left Observations/Recommendations only in React
  // state until Generate Report forced a save.
  useEffect(() => {
    if (isLoading || !training) return;
    if (effectiveReadOnly) return;

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
  }, [deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, effectiveReadOnly]);

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
      if (hasUnsavedChanges && !isSaving && !isLoading && training && !effectiveReadOnly) {
        if (import.meta.env.DEV) console.log('[Training AutoSave] Interval save triggered');
        saveTraining(true);
      }
    }, 30000);

    return () => {
      if (autoSaveTimer.current) {
        clearInterval(autoSaveTimer.current);
      }
    };
  }, [hasUnsavedChanges, isSaving, isLoading, training, effectiveReadOnly]);

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
      // OPTIMIZATION: Client-side cache check — see shouldUseCachedTrainingReport.
      // Photo writes invalidate the cached row via the
      // invalidate_training_report_cache_on_photo trigger; pending in-form
      // edits are caught here so we never serve stale HTML during an
      // unsaved edit window.
      if (shouldUseCachedTrainingReport({
        latestReportGeneratedAt: training?.latest_report_generated_at,
        trainingUpdatedAt: training?.updated_at,
        hasUnsavedChanges,
      })) {
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
            const { sanitizeTrainingSummaryForRemote } = await import('@/lib/form-savers/trainingSaver');
            const preparedSummary = sanitizeTrainingSummaryForRemote({
              ...summary,
              id: summary.id || crypto.randomUUID(),
              training_id: id,
            });
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
    // Mirror unsaved flag synchronously so refetch/realtime handlers see the
    // in-flight edit during the auto-save debounce window.
    hasUnsavedRef.current = true;
    if (!hasUnsavedChanges) setHasUnsavedChanges(true);
    setSummary(prev => {
      if (!prev) return prev;
      const nowIso = new Date().toISOString();
      const isTracked = (TRAINING_SUMMARY_FIELDS as readonly string[]).includes(field);
      if (isTracked) {
        pendingSummaryFieldsRef.current[field] = nowIso;
      }
      const next = {
        ...prev,
        [field]: value,
        updated_at: nowIso,
        ...(isTracked
          ? {
              field_timestamps: {
                ...((prev as { field_timestamps?: Record<string, string> | null }).field_timestamps ?? {}),
                [field]: nowIso,
              },
            }
          : {}),
      } as DbRow;
      summaryRef.current = next;
      summaryLocalSnapshotRef.current = next;
      logTrainingSummaryAutosave('summary-field-changed', { field, pendingFields: Object.keys(pendingSummaryFieldsRef.current), updatedAt: nowIso });
      return next;
    });
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
      <TrainingHeaderSection
        isOnline={isOnline}
        storageUnavailable={storageUnavailable}
        isLoading={isLoading}
        showOfflineEmptyBanner={
          !isOnline && !isLoading &&
          deliveryApproaches.length === 0 &&
          operatingSystems.length === 0 &&
          immediateAttention.length === 0 &&
          !childDataLoadedRef.current.delivery_approaches &&
          !childDataLoadedRef.current.operating_systems &&
          !childDataLoadedRef.current.immediate_attention
        }
        onBack={() => setShowLeaveDialog(true)}
        lastManuallySaved={lastManuallySaved}
        isSaving={isSaving}
        hasUnsavedChanges={hasUnsavedChanges}
        saveError={saveError}
        actions={{
          effectiveReadOnly,
          hasId: !!id,
          status: training?.status,
          isMobile,
          isAdmin,
          isSaving,
          onSave: async () => { await saveTraining(); setLastManuallySaved(new Date()); },
          onForceBackup: async () => {
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
          },
          refreshing,
          onRefresh: async () => {
            setRefreshing(true);
            try {
              await loadTraining();
              toast.success("Report refreshed", { description: "Latest data loaded successfully." });
            } catch {
              toast.error("Refresh failed");
            } finally {
              setRefreshing(false);
            }
          },
          onComplete: () => {
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
          },
          isGeneratingHTML,
          isOnline,
          onGenerateHTML: handleGenerateHTML,
          isInvoiced,
          invoiceToggling,
          onToggleInvoiced: toggleInvoiced,
        }}
      />

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
                  onUpdate={setDeliveryApproachesTracked} 
                />
              </TabsContent>

              <TabsContent value="systems" className="space-y-6">
                <OperatingSystemsSection 
                  systems={operatingSystems} 
                  onUpdate={setOperatingSystemsTracked} 
                />
              </TabsContent>

              <TabsContent value="attention" className="space-y-6">
                <ImmediateAttentionSection 
                  items={immediateAttention} 
                  onUpdate={setImmediateAttentionTracked} 
                />
              </TabsContent>

              <TabsContent value="verifiable" className="space-y-6">
                <VerifiableItemsSection 
                  items={verifiableItems} 
                  onUpdate={setVerifiableItemsTracked}
                  systemsInPlace={systemsInPlace}
                  onUpdateSystemsInPlace={setSystemsInPlaceTracked}
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
