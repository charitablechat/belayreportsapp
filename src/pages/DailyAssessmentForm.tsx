import { useEffect, useState, useRef, useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import { formatReportFilename, formatReportTitle } from "@/lib/report-naming";
import { useReportTabHistory } from "@/hooks/useReportTabHistory";
import { isLocalDataNewer } from "@/lib/local-data-guards";
import { applyTrackedFieldWrite, mergeChildArray, mergeRecordFields, TRACKED_FIELDS } from "@/lib/field-merge";
import { trackChildDeletions } from "@/lib/track-child-deletions";
import { isFieldActivelyEdited, recordActiveEditSkip } from "@/lib/active-edit-guard";
import { checkRequiredHeaderFields, formatMissingFieldLabels } from "@/lib/header-required-fields";
import { useSaveRaceGuard } from "@/hooks/useSaveRaceGuard";

/**
 * Daily Assessment fields protected by the save-race guard.
 * Same Training-class stale-echo bug shape as Inspection's protected
 * fields. These three are the only free-text comment fields on the
 * Daily Assessment; the rest of the form is structured checklists.
 */
const DAILY_ASSESSMENT_PROTECTED_FIELDS = [
  'environment_comments',
  'structure_comments',
  'systems_comments',
] as const;
import { getMissingAssessmentFields, formatMissingDescription, type MissingField } from "@/lib/required-fields";
import { useParams, useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { markPendingDashboardRefresh, markDashboardStaleTimestamp, registerActiveFormRecord, unregisterActiveFormRecord, onPendingRemoteUpdate, isRecentSelfWrite } from "@/lib/sync-events";
import { useFormRecordRealtime } from "@/hooks/useFormRecordRealtime";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { CachedUser } from "@/lib/cached-auth";
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";
import { useFormConfiguration } from "@/hooks/useFormConfiguration";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, FileText, Loader2, WifiOff, Check, Sunrise, Sunset, Settings, Package, Building, Cloud, LogOut, User, CloudOff, CheckCircle, Camera, RefreshCw, AlertTriangle, HardDrive } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AutoSaveIndicator } from "@/components/AutoSaveIndicator";
import { SaveFailureBanner } from "@/components/SaveFailureBanner";
import { useActiveTimer } from "@/hooks/useActiveTimer";
import { ActiveTimerDisplay } from "@/components/ActiveTimerDisplay";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useStorageHealthCheck } from "@/hooks/useStorageHealthCheck";

import DailyAssessmentHeader from "@/components/daily-assessment/DailyAssessmentHeader";
import { CollaboratorPresence } from "@/components/CollaboratorPresence";
import BeginningOfDaySection from "@/components/daily-assessment/BeginningOfDaySection";
import EndOfDaySection from "@/components/daily-assessment/EndOfDaySection";
import OperatingSystemsSection from "@/components/daily-assessment/OperatingSystemsSection";
import EquipmentChecksSection from "@/components/daily-assessment/EquipmentChecksSection";
import StructureChecksSection from "@/components/daily-assessment/StructureChecksSection";
import EnvironmentChecksSection from "@/components/daily-assessment/EnvironmentChecksSection";
import PhotoCapture from "@/components/PhotoCapture";
import PhotoGallery from "@/components/PhotoGallery";
import { HtmlReportViewer } from "@/components/HtmlReportViewer";
import { AttestationDialog } from "@/components/AttestationDialog";
import { useUserProfile } from "@/hooks/useUserProfile";
import type { AttestationPayload } from "@/lib/attestation";
import { APP_VERSION_FULL } from "@/lib/attestation";

import { triggerCompletionConfetti } from "@/lib/confetti";
import { triggerHaptic } from "@/lib/haptics";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SwipeBackIndicator } from "@/components/SwipeBackIndicator";
// UserProfileDropdown moved to AuthenticatedHeader (global)
import { toast } from "@/components/ui/sonner";
import { isMobile } from "@/lib/mobile-detection";
import { addSyncNotification, addSaveNotification, addNotification } from "@/lib/notification-center";
import { useReportSync } from "@/hooks/useReportSync";

import {
  getOfflineDailyAssessment,
  getAssessmentDataOffline,
  saveDailyAssessmentOffline,
  saveAssessmentDataOffline,
  queueAssessmentOperation,
  type DbRow,
} from "@/lib/offline-storage";

// `saveAssessmentDataOffline` accepts a fixed set of section keys.
// Derived from its first parameter so the union stays in sync with offline-storage.
type AssessmentDataKey = Parameters<typeof saveAssessmentDataOffline>[0];

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

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
import { showSaveQueuedToast } from "@/lib/save-queued-toast";
import { DataIntegrityBadge, type IntegrityStatus } from "@/components/ui/data-integrity-badge";
import { VersionHistoryPanel } from "@/components/admin/VersionHistoryPanel";
import { Shield as ShieldIcon, Receipt } from "lucide-react";
import { useInvoicedStatus } from "@/hooks/useInvoicedStatus";

export default function DailyAssessmentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { formConfig, isLoading: isLoadingConfig } = useFormConfiguration('en', 'daily_assessment');
  const { isOnline } = useNetworkStatus();
  const isMobileView = useIsMobile();
  const { syncReport, getLatestReport } = useReportSync(id, 'daily_assessment');
  const { storageUnavailable } = useStorageHealthCheck();
  
  // Check edit permissions - Super Admins are view-only, only owners can edit
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const { canEdit, isReadOnly, isOwner, isSuperAdmin, isAdmin, readOnlyReason } = useReportEditPermission({
    inspectorId,
    reportType: 'daily_assessment'
  });
  
  
  // Completion lock: prevent accidental edits to completed reports
  const [completionLockOverridden, setCompletionLockOverridden] = useState(false);
  const [showCompletionLockDialog, setShowCompletionLockDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [isSavingBeforeLeave, setIsSavingBeforeLeave] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showAttestationDialog, setShowAttestationDialog] = useState(false);
  const { fullName: signerFullName } = useUserProfile();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  /**
   * Save-race guard for the three protected comment fields. Brings
   * Daily Assessment up to the same live save/refetch race protection
   * standard as Training and Inspection.
   */
  const saveRaceGuard = useSaveRaceGuard();
  const [saveError, setSaveError] = useState<import("@/components/SaveFailureBanner").SaveErrorState>(null);
  
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [lastManuallySaved, setLastManuallySaved] = useState<Date | null>(null);
  const [generating, setGenerating] = useState(false);
  const [assessment, setAssessment] = useState<DbRow | null>(null);
  const { isInvoiced, toggling: invoiceToggling, toggleInvoiced } = useInvoicedStatus({
    reportId: id,
    reportType: 'daily',
    enabled: isAdmin && assessment?.status === 'completed',
  });
  const [beginningOfDay, setBeginningOfDay] = useState<DbRow[]>([]);
  const [endOfDay, setEndOfDay] = useState<DbRow[]>([]);
  const [operatingSystems, setOperatingSystems] = useState<DbRow[]>([]);
  // ── Deletion-aware merge tracking (Operating Systems only) ─────────────
  // Session-scoped set of OS row ids the user intentionally unchecked or
  // removed via the section UI. Passed to `mergeChildArray` on server
  // reconcile so a stale snapshot can't resurrect a just-deleted row.
  // Auto-cleared per-id via `onDeletedIdConfirmed` when the server stops
  // returning the id, and wholesale on JSON import.
  const deletedOperatingSystemIdsRef = useRef<Set<string>>(new Set());
  const dropDeletedOperatingSystemId = useCallback((rid: string) => {
    deletedOperatingSystemIdsRef.current.delete(rid);
  }, []);
  const setOperatingSystemsTracked = useMemo(
    () => trackChildDeletions(setOperatingSystems, deletedOperatingSystemIdsRef) as Dispatch<SetStateAction<DbRow[]>>,
    [],
  );
  const [equipmentChecks, setEquipmentChecks] = useState<DbRow[]>([]);
  const [structureChecks, setStructureChecks] = useState<DbRow[]>([]);
  const [environmentChecks, setEnvironmentChecks] = useState<DbRow[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<CachedUser | null>(null);
  const [inspectorProfile, setInspectorProfile] = useState<DbRow | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<DbRow | null>(null);
  const [modifiedByProfile, setModifiedByProfile] = useState<DbRow | null>(null);
  // signingOut removed — sign-out handled by global AuthenticatedHeader
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  // Completion lock derived values (after report state is declared)
  const isCompletionLocked = assessment?.status === 'completed' && !completionLockOverridden;
  // Active-usage timer: only tracks time when user is actively editing
  // DISABLED: Timer fully disabled — set enabled: false to stop all background tracking
  const { elapsedSeconds, isActive: timerActive, isPaused: timerPaused, getElapsedSeconds } = useActiveTimer({
    initialSeconds: assessment?.active_duration_seconds || 0,
    enabled: false, // was: canEdit && !isReadOnly && !isCompletionLocked && !isSuperAdmin
  });

  const effectiveReadOnly = isReadOnly || isCompletionLocked;
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [lastVersionNumber, setLastVersionNumber] = useState<number | undefined>(undefined);
  const [lastFieldCount, setLastFieldCount] = useState<number | undefined>(undefined);

  // Required-field completion gate. Saves stay unblocked; only the
  // explicit Complete action checks this list. See
  // src/lib/required-fields.ts and mem://features/required-field-completion-gate.
  const [missingRequiredFields, setMissingRequiredFields] = useState<MissingField[]>([]);
  useEffect(() => {
    if (!missingRequiredFields.length) return;
    const stillMissing = getMissingAssessmentFields(assessment);
    if (!stillMissing.length) {
      toast.dismiss(`completion-blocked-${id}`);
      setMissingRequiredFields([]);
    } else if (stillMissing.length !== missingRequiredFields.length) {
      setMissingRequiredFields(stillMissing);
    }
  }, [assessment?.organization, assessment?.assessment_date, missingRequiredFields.length, id]);

  // Click handler for the Complete button. Required-field gate runs first;
  // missing fields reject completion with a persistent toast + red pulse.
  const handleCompleteClick = () => {
    const missing = getMissingAssessmentFields(assessment);
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
    if (assessment?.attestation_signed_at) {
      setShowSubmitDialog(true);
    } else {
      setShowAttestationDialog(true);
    }
  };

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

  const isInternalUpdateRef = useRef(false);
  const hasUnsavedRef = useRef(false);

  // Track which child data types loaded successfully (not from timeout fallback)
  const childDataLoadedRef = useRef<Record<string, boolean>>({
    beginning_of_day: false,
    end_of_day: false,
    operating_systems: false,
    equipment_checks: false,
    structure_checks: false,
    environment_checks: false,
  });

  // Auto-save debounce timer (declared early for useEmergencySave)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Tab navigation state
  const [currentTab, setCurrentTab] = useState("beginning");
  const tabOrder = ["beginning", "end", "systems", "equipment", "structure", "environment", "photos"];

  // Hardware back button → navigate tabs on mobile
  const { handleTabChange } = useReportTabHistory(
    currentTab, setCurrentTab, tabOrder,
    useCallback(() => setShowLeaveDialog(true), []),
  );

  // Swipe navigation for mobile (swipe right on first tab navigates back)
  const isFirstTab = currentTab === tabOrder[0];
  const { containerRef: swipeContainerRef, swipeState } = useSwipeNavigation({
    enabled: isMobileView,
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
  const handleSaveProgressRef = useRef<() => Promise<void>>();
  const saveBeforeLeaveRef = useRef<(() => Promise<void>) | null>(null);
  const handleSaveAndLeave = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const { startedAtMs } = saveRaceGuard.beginSave();
    try {
      await handleSaveProgressRef.current?.();
      // Race-guard gate: don't mark clean if a protected comment was
      // typed after this save started.
      if (!saveRaceGuard.typedAfter(startedAtMs)) {
        hasUnsavedRef.current = false;
        setHasUnsavedChanges(false);
      }
      console.log('[DailyAssessmentForm] Save-before-leave completed');
    } catch (e) {
      console.warn('[DailyAssessmentForm] Save-before-leave failed:', e);
    }
  }, [saveRaceGuard]);
  saveBeforeLeaveRef.current = handleSaveAndLeave;

  // Stable immediate-save trigger for child fields (e.g. notes onBlur).
  // Flushes pending debounce timer and performs save now so values persist
  // before navigation. Identity is stable to keep React.memo children happy.
  const triggerImmediateSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    return handleSaveProgressRef.current?.() ?? Promise.resolve();
  }, []);

  // Unsaved changes protection
  const { isBlocked, confirmNavigation, cancelNavigation, saveAndLeave, bypassAndProceed } = useUnsavedChanges({
    hasUnsavedChanges: hasUnsavedChanges && (assessment?.status !== 'completed' || completionLockOverridden),
    alwaysBlock: true,
    message: "You have unsaved changes to this assessment. Are you sure you want to leave?",
    onSaveAndLeave: async () => { await saveBeforeLeaveRef.current?.(); },
  });

  // Emergency save on page hide/refresh (Vector 1: zero-data-loss)
  useEmergencySave({
    hasUnsavedChanges,
    saving,
    saveDebounceTimerRef: autoSaveTimerRef,
    performSaveRef: handleSaveProgressRef as React.MutableRefObject<((silent?: boolean) => Promise<void>) | undefined>,
    formName: 'DailyAssessmentForm',
    onEmergencySnapshot: () => {
      if (assessment && id) {
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
            saveReportSnapshot('daily_assessment', id, assessment, {
              beginning_of_day: beginningOfDay,
              end_of_day: endOfDay,
              operating_systems: operatingSystems,
              equipment_checks: equipmentChecks,
              structure_checks: structureChecks,
              environment_checks: environmentChecks,
            }, !!assessment.synced_at, photoMeta);
          }).catch(() => {
            saveReportSnapshot('daily_assessment', id, assessment, {
              beginning_of_day: beginningOfDay,
              end_of_day: endOfDay,
              operating_systems: operatingSystems,
              equipment_checks: equipmentChecks,
              structure_checks: structureChecks,
              environment_checks: environmentChecks,
            }, !!assessment.synced_at);
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
        .maybeSingle();
      setInspectorProfile(profile as DbRow | null);
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
      if (!assessment?.last_modified_by || !navigator.onLine) return;
      // Only fetch if modifier is different from the owner
      if (assessment.last_modified_by === assessment.inspector_id) {
        setModifiedByProfile(null);
        return;
      }
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', assessment.last_modified_by)
        .maybeSingle();
      
      setModifiedByProfile(profile);
    };
    
    fetchModifiedByProfile();
  }, [assessment?.last_modified_by, assessment?.inspector_id]);

  // handleSignOut removed — sign-out handled by global AuthenticatedHeader
  // Emergency save via useEmergencySave handles data preservation on navigation

  // Keyboard shortcut ref for save (actual function set later)  
  const saveRef = useRef<(() => void) | null>(null);
  useSaveShortcut(() => saveRef.current?.(), hasUnsavedChanges && !saving);

  // Auto-save debounce timer
  // autoSaveTimerRef and autoSaveIntervalRef declared above (near isInternalUpdateRef)

  useEffect(() => {
    loadAssessment();
  }, [id]);

  // F4: Realtime refresh for THIS assessment. Suppressed while user has unsaved edits.
  // H5: read `hasUnsavedChanges` and the latest `updated_at` via refs so the
  // channel doesn't churn on every keystroke.
  const lastLoadedUpdatedAtRef = useRef<string | null>(null);
  useEffect(() => {
    const ua = assessment?.updated_at;
    lastLoadedUpdatedAtRef.current = typeof ua === 'string' ? ua : null;
  }, [assessment]);
  // Audit H2: see InspectionForm — same Realtime-recovery pattern via shared helper.
  useFormRecordRealtime({
    enabled: !!id && !id.startsWith('temp-'),
    channelName: id ? `assessment-form-${id}` : '',
    table: 'daily_assessments',
    recordId: id || '',
    logTag: 'DailyAssessmentForm',
    onUpdate: (payload: RealtimePostgresChangesPayload<DbRow>) => {
      const newRow = payload.new as Partial<DbRow> | null;
      const remoteUpdated = newRow && typeof newRow.updated_at === 'string' ? newRow.updated_at : null;
      if (!remoteUpdated) return;
      const localUpdated = lastLoadedUpdatedAtRef.current;
      const remoteMs = new Date(remoteUpdated).getTime();
      const localMs = localUpdated ? new Date(localUpdated).getTime() : 0;
      if (remoteMs - localMs <= 5000) return;
      const guard = isFieldActivelyEdited({
        hasUnsavedRef,
        debounceTimerRef: autoSaveTimerRef,
      });
      if (guard.active) {
        recordActiveEditSkip({ form: 'daily_assessment', table: 'daily_assessments', rowId: id ?? null, reason: guard.reason!, source: 'realtime' });
        return;
      }
      if (id && isRecentSelfWrite(id)) {
        if (import.meta.env.DEV) console.log('[DailyAssessmentForm] Skipping remote refresh — recent self-write');
        return;
      }
      if (import.meta.env.DEV) console.log('[DailyAssessmentForm] Remote update detected — reloading');
      loadAssessment();
    },
    onResumeOrDegraded: () => {
      const guard = isFieldActivelyEdited({
        hasUnsavedRef,
        debounceTimerRef: autoSaveTimerRef,
      });
      if (guard.active) {
        recordActiveEditSkip({ form: 'daily_assessment', table: 'daily_assessments', rowId: id ?? null, reason: guard.reason!, source: 'visibility' });
        return;
      }
      if (id && isRecentSelfWrite(id)) return;
      loadAssessment();
    },
  });

  // H3: Register this record as actively edited so the global Realtime IDB
  // writer in useAutoSync doesn't silently overwrite our IDB row while we
  // hold unsaved React state.
  useEffect(() => {
    if (!id || id.startsWith('temp-')) return;
    registerActiveFormRecord('daily_assessments', id);
    const unsub = onPendingRemoteUpdate((p) => {
      if (p.table !== 'daily_assessments' || p.recordId !== id) return;
      if (isRecentSelfWrite(id)) {
        if (import.meta.env.DEV) console.log('[DailyAssessmentForm] Suppressing pending-update toast — recent self-write');
        return;
      }
      if (import.meta.env.DEV) console.log('[DailyAssessmentForm] Pending remote update — silent reconcile');
      loadAssessment();
    });
    return () => {
      unsub();
      unregisterActiveFormRecord(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Debounced auto-save on data changes (3-second debounce) - immediate persistence
  // Watches ALL data sections: Beginning/End of Day, Operating Systems, Equipment/Structure/Environment Checks
  // Also watches assessment-level fields like section comments
  useEffect(() => {
    if (loading || !assessment || !isOwner) return;
    
    // Skip internal/programmatic updates (initial load, server hydration)
    if (isInternalUpdateRef.current) return;
    
    // Mark as having unsaved changes (ref-guarded to avoid redundant re-renders)
    if (!hasUnsavedRef.current) {
      hasUnsavedRef.current = true;
      setHasUnsavedChanges(true);
    }
    
    // Clear existing debounce timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    
    // Set new debounce timer - 1.5 seconds after last change (optimized for near-instant feel)
    autoSaveTimerRef.current = setTimeout(() => {
      if (!saving) {
        if (import.meta.env.DEV) {
          console.log('[DailyAssessment AutoSave] Debounced save triggered');
        }
        handleSaveProgress(true);
      }
    }, 1500);
    
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [beginningOfDay, endOfDay, operatingSystems, equipmentChecks, structureChecks, environmentChecks, assessment?.structure_comments, assessment?.environment_comments, assessment?.systems_comments, isOwner]);

  // Reset internal update ref after the change tracker skips
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
    }
  }, [beginningOfDay, endOfDay, operatingSystems, equipmentChecks, structureChecks, environmentChecks]);

  // Backup auto-save interval (every 30 seconds — matches system standard)
  useEffect(() => {
    autoSaveIntervalRef.current = setInterval(() => {
      if (hasUnsavedChanges && !saving && !loading && isOwner) {
        if (import.meta.env.DEV) console.log('[DailyAssessment AutoSave] Interval save triggered');
        handleSaveProgress(true);
      }
    }, 30000);

    return () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
      }
    };
  }, [hasUnsavedChanges, saving, loading, isOwner]);

  const loadAssessment = async () => {
    try {
      // Race-fix: flush any pending debounced save into IDB before reading.
      if (autoSaveTimerRef.current || hasUnsavedRef.current) {
        try {
          if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
          }
          await handleSaveProgressRef.current?.();
        } catch (e) {
          console.warn('[DailyAssessmentForm] Pre-load flush failed (continuing):', e);
        }
      }

      // Try loading from offline storage first
      const offlineAssessment = await getOfflineDailyAssessment(id!);
      
      if (offlineAssessment) {
        setAssessment(offlineAssessment);
        setInspectorId(offlineAssessment.inspector_id);
        
        // Load related data from offline storage
        const [bodData, eodData, osData, eqData, stData, envData] = await Promise.all([
          getAssessmentDataOffline('beginning_of_day', id!),
          getAssessmentDataOffline('end_of_day', id!),
          getAssessmentDataOffline('operating_systems', id!),
          getAssessmentDataOffline('equipment_checks', id!),
          getAssessmentDataOffline('structure_checks', id!),
          getAssessmentDataOffline('environment_checks', id!),
        ]);

        isInternalUpdateRef.current = true;
        // Track successful loads — arrays with data came from real IndexedDB reads
        if (bodData.length > 0) childDataLoadedRef.current.beginning_of_day = true;
        if (eodData.length > 0) childDataLoadedRef.current.end_of_day = true;
        if (osData.length > 0) childDataLoadedRef.current.operating_systems = true;
        if (eqData.length > 0) childDataLoadedRef.current.equipment_checks = true;
        if (stData.length > 0) childDataLoadedRef.current.structure_checks = true;
        if (envData.length > 0) childDataLoadedRef.current.environment_checks = true;
        setBeginningOfDay(bodData);
        setEndOfDay(eodData);
        setOperatingSystems(osData);
        setEquipmentChecks(eqData);
        setStructureChecks(stData);
        setEnvironmentChecks(envData);
        setLoading(false);
        
        if (import.meta.env.DEV) {
          console.log('[DailyAssessmentForm] Loaded from offline storage');
        }
      } else if (!id!.startsWith('temp-')) {
        // Finding 6: Auto-restore from localStorage backup if IndexedDB was evicted
        const backup = getReportSnapshot('daily_assessment', id!);
        if (backup) {
          console.log('[DailyAssessmentForm] IndexedDB empty but localStorage backup found — auto-restoring');
          
          saveDailyAssessmentOffline(backup.parent).catch(() => {});
          isInternalUpdateRef.current = true;
          setAssessment(backup.parent);
          setInspectorId(backup.parent.inspector_id);
          if (backup.children) {
            for (const [childType, childData] of Object.entries(backup.children)) {
              if (Array.isArray(childData) && childData.length > 0) {
                saveAssessmentDataOffline(childType as AssessmentDataKey, id!, childData).catch(() => {});
                if (childType in childDataLoadedRef.current) {
                  childDataLoadedRef.current[childType] = true;
                }
              }
            }
            setBeginningOfDay(backup.children.beginning_of_day || []);
            setEndOfDay(backup.children.end_of_day || []);
            setOperatingSystems(backup.children.operating_systems || []);
            setEquipmentChecks(backup.children.equipment_checks || []);
            setStructureChecks(backup.children.structure_checks || []);
            setEnvironmentChecks(backup.children.environment_checks || []);
          }
          setLoading(false);
          toast.info("Restored from local backup", {
            description: backup.photoMetadata?.some(p => !p.uploaded)
              ? "Some photos may need to be re-captured."
              : "Your data has been recovered.",
          });
        }
      }

      // If online and not a temp-ID, fetch from Supabase
      if (navigator.onLine && !id!.startsWith('temp-')) {
        const { data: assessmentData, error: assessmentError } = await supabase
          .from('daily_assessments')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        // Handle assessment not found - redirect to dashboard. Only act when
        // the lookup was conclusive (no error, online, IDB healthy) so
        // transient storage/network issues don't alarm the user.
        if (!assessmentData && !offlineAssessment) {
          const serverInconclusive = !!assessmentError || !navigator.onLine;
          const { getCircuitBreakerStatus } = await import('@/lib/offline-storage');
          const idbDegraded = getCircuitBreakerStatus().open;
          if (serverInconclusive || idbDegraded) {
            console.warn('[DailyAssessmentForm] Skipping not-found redirect — inconclusive lookup; staying mounted', { serverInconclusive, idbDegraded, id });
            return; // keep form mounted; next refetch/online recovery will reconcile
          }
          console.warn('[DailyAssessmentForm] Assessment not found:', id);
          toast.error("Assessment not found", {
            description: "This assessment may have been deleted or doesn't exist.",
          });
          navigate('/dashboard');
          return;
        }

        if (assessmentError) throw assessmentError;
        
        // Determine if local data should take priority
        const localIsNewer = isLocalDataNewer(offlineAssessment, assessmentData);

        if (localIsNewer) {
          // Local data is newer - preserve local state, only accept server metadata
          // Skip ALL server child data fetches to prevent overwriting local edits
          if (import.meta.env.DEV) console.log('[DailyAssessmentForm] Local data is newer -- preserving local state (parent + child)');
          if (assessmentData) {
            setAssessment(prev => ({ ...prev, status: assessmentData.status }));
            setInspectorId(assessmentData.inspector_id);
          }
          // Early exit: child data already loaded from IndexedDB above (lines 257-271)
        } else if (assessmentData) {
          // Race-fix: per-field merge so any locally-newer tracked-field
          // edit survives a refetch.
          setAssessment(prev => {
            if (!prev) return assessmentData;
            return mergeRecordFields(
              prev as typeof assessmentData & { field_timestamps?: Record<string, string> | null },
              assessmentData as typeof assessmentData & { field_timestamps?: Record<string, string> | null },
              TRACKED_FIELDS.daily_assessment,
            );
          });
          setInspectorId(assessmentData.inspector_id);

          // Load all related data
          const [bodData, eodData, osData, eqData, stData, envData] = await Promise.all([
            supabase.from('daily_assessment_beginning_of_day').select('*').eq('assessment_id', id).order('created_at'),
            supabase.from('daily_assessment_end_of_day').select('*').eq('assessment_id', id).order('created_at'),
            supabase.from('daily_assessment_operating_systems').select('*').eq('assessment_id', id).order('created_at'),
            supabase.from('daily_assessment_equipment_checks').select('*').eq('assessment_id', id).order('created_at'),
            supabase.from('daily_assessment_structure_checks').select('*').eq('assessment_id', id).order('created_at'),
            supabase.from('daily_assessment_environment_checks').select('*').eq('assessment_id', id).order('created_at'),
          ]);

          // Vector 2: Non-regression guard — don't overwrite local data with empty server arrays
          isInternalUpdateRef.current = true;
          // Mark all child types as loaded when server data is applied
          childDataLoadedRef.current.beginning_of_day = true;
          childDataLoadedRef.current.end_of_day = true;
          childDataLoadedRef.current.operating_systems = true;
          childDataLoadedRef.current.equipment_checks = true;
          childDataLoadedRef.current.structure_checks = true;
          childDataLoadedRef.current.environment_checks = true;
          
          saveDailyAssessmentOffline(
            { ...assessmentData, synced_at: assessmentData.synced_at || new Date().toISOString() },
            { markDirty: false, explicitUserSave: false, dispatchSyncEvent: false },
          ).catch(e =>
            console.warn('[DailyAssessmentForm] Non-critical: failed to cache assessment', e)
          );

          // Helper: only set state & cache if server returned data, otherwise preserve local
          const guardedSet = (serverData: DbRow[] | null, localData: DbRow[], setter: (d: DbRow[]) => void, key: AssessmentDataKey) => {
            if (serverData && serverData.length > 0) {
              setter(serverData);
              saveAssessmentDataOffline(key, id!, serverData).catch(e =>
                console.warn(`[DailyAssessmentForm] Non-critical: failed to cache ${key}`, e));
            } else if (localData.length > 0) {
              console.warn(`[DailyAssessmentForm] Server returned empty ${key} but local has data -- preserving local`);
              setter(localData);
            } else {
              setter(serverData || []);
            }
          };

          guardedSet(bodData.data, beginningOfDay, setBeginningOfDay, 'beginning_of_day');
          guardedSet(eodData.data, endOfDay, setEndOfDay, 'end_of_day');
          // Operating Systems: deletion-aware merge so a stale server snapshot
          // can't resurrect a row the user just unchecked/removed locally.
          if (osData.data && osData.data.length > 0) {
            setOperatingSystems(prev => mergeChildArray(
              prev as Array<DbRow & { id: string }>,
              osData.data as Array<DbRow & { id: string }>,
              {
                table: 'daily_assessment_operating_systems',
                deletedIds: deletedOperatingSystemIdsRef.current,
                onDeletedIdConfirmed: dropDeletedOperatingSystemId,
              },
            ) as DbRow[]);
            saveAssessmentDataOffline('operating_systems', id!, osData.data).catch(e =>
              console.warn('[DailyAssessmentForm] Non-critical: failed to cache operating_systems', e));
          } else if (operatingSystems.length > 0) {
            console.warn('[DailyAssessmentForm] Server returned empty operating_systems but local has data -- preserving local');
          } else {
            setOperatingSystems([]);
          }
          guardedSet(eqData.data, equipmentChecks, setEquipmentChecks, 'equipment_checks');
          guardedSet(stData.data, structureChecks, setStructureChecks, 'structure_checks');
          guardedSet(envData.data, environmentChecks, setEnvironmentChecks, 'environment_checks');
        }
      } else if (!offlineAssessment) {
        // Offline and no cached data
        toast.error("Assessment not available offline", {
          description: "Please connect to the internet to load this assessment.",
        });
        navigate('/dashboard');
        return;
      }
    } catch (error) {
      console.error('Error loading assessment:', error);
      toast.error("Failed to load assessment");
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAssessment = async (field: string, value: unknown) => {
    // PR-A: route every header-field write through `applyTrackedFieldWrite`
    // so tracked fields populate `field_timestamps` for cross-device merge.
    //
    // Sync-mirror the unsaved flag onto the ref BEFORE setAssessment so the
    // form-scoped Realtime UPDATE handler sees the in-flight edit during
    // the IDB-write + Supabase-update window below. Without this, our own
    // immediate Supabase update emits a Realtime UPDATE that races back
    // into `setAssessment(serverData)` and clobbers fields the local React
    // state has already advanced.
    hasUnsavedRef.current = true;
    if (!hasUnsavedChanges) setHasUnsavedChanges(true);
    // Save-race guard: stamp protected text fields on every user edit
    // so an older save/refetch echo cannot mark the form clean. Only
    // user-driven edits flow through this handler (the assessment
    // checklists call it for their own fields; hydration / refetch
    // never does), so stamping here is race-safe.
    if ((DAILY_ASSESSMENT_PROTECTED_FIELDS as readonly string[]).includes(field)) {
      saveRaceGuard.markFieldTyped(field);
    }
    const updatedAssessment = applyTrackedFieldWrite(assessment, 'daily_assessment', field, value);
    setAssessment(updatedAssessment);

    // Required-field gate: refuse to persist a write while a required
    // header field (e.g. `organization`, `assessment_date`) is missing.
    // The React state above still reflects the user's attempted edit so
    // the inline banner is visible, but IDB and Supabase retain the
    // last-valid version so the record can still sync once the user fills
    // in the missing field(s). Without this gate, the per-keystroke
    // immediate-write below persists an unsyncable record (empty
    // `organization` etc.) and the sync engine then throws
    //   `Validation failed: [{"path":"assessment.organization", ...}]`
    // on every cycle — exactly the production Sentry signature on
    // Android Chrome that motivated this PR.
    const requiredCheck = checkRequiredHeaderFields(
      updatedAssessment as unknown as Record<string, unknown>,
      'daily_assessment',
    );
    if (!requiredCheck.ok) {
      return;
    }

    try {
      // Save offline first
      await saveDailyAssessmentOffline(updatedAssessment);
      await saveDailyAssessmentOffline(updatedAssessment);

      if (navigator.onLine) {
        const syncTimestamp = new Date().toISOString();
        // PR-A: include `field_timestamps` so the per-field merger on the
        // server side and on the next pulling device sees the explicit stamp.
        // Without this, the immediate sync path strips `field_timestamps`
        // even though the local write populated it via applyTrackedFieldWrite.
        const updatePayload: Record<string, unknown> = {
          [field]: value,
          updated_at: updatedAssessment.updated_at,
          synced_at: syncTimestamp,
        };
        if (updatedAssessment.field_timestamps) {
          updatePayload.field_timestamps = updatedAssessment.field_timestamps;
        }
        const { error } = await supabase
          .from('daily_assessments')
          .update(updatePayload as never)
          .eq('id', id);

        if (error) throw error;

        // Update synced_at locally
        updatedAssessment.synced_at = syncTimestamp;
        await saveDailyAssessmentOffline(updatedAssessment);
        setLastSaved(new Date());
      } else {
        // Queue for sync
        try {
          await Promise.race([
            queueAssessmentOperation('update', id!, updatedAssessment),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
          ]);
        } catch (e) {
          console.warn('[DailyAssessment] Queue operation failed/timed out:', e);
        }
      }
    } catch (error) {
      console.error('Error updating assessment:', error);
      try {
        await Promise.race([
          queueAssessmentOperation('update', id!, updatedAssessment),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
        ]);
      } catch (e) {
        console.warn('[DailyAssessment] Fallback queue failed/timed out:', e);
      }
    }
  };

  // Timeout wrapper utility for offline storage operations
  const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      )
    ]);
  };

  // Listen for JSON import events — reload form state from IndexedDB to prevent
  // stale React state from overwriting imported data on next save
  useEffect(() => {
    const handleReportImported = async (event: Event) => {
      const { reportType, reportId } = (event as CustomEvent).detail;
      if (reportType !== 'daily_assessment' || reportId !== id) return;

      console.log('[DailyAssessmentForm] Detected JSON import — reloading state from IndexedDB');
      try {
        const offlineData = await getOfflineDailyAssessment(id!);
        const [bod, eod, os, eq, st, env] = await Promise.all([
          getAssessmentDataOffline('beginning_of_day', id!),
          getAssessmentDataOffline('end_of_day', id!),
          getAssessmentDataOffline('operating_systems', id!),
          getAssessmentDataOffline('equipment_checks', id!),
          getAssessmentDataOffline('structure_checks', id!),
          getAssessmentDataOffline('environment_checks', id!),
        ]);

        isInternalUpdateRef.current = true;
        if (offlineData) {
          setAssessment(offlineData);
          setInspectorId(offlineData.inspector_id);
        }
        setBeginningOfDay(bod); childDataLoadedRef.current.beginning_of_day = true;
        setEndOfDay(eod); childDataLoadedRef.current.end_of_day = true;
        // JSON import is a wholesale user-driven replacement: clear the
        // session deletion set so imported rows are not vetoed.
        deletedOperatingSystemIdsRef.current.clear();
        setOperatingSystems(os); childDataLoadedRef.current.operating_systems = true;
        setEquipmentChecks(eq); childDataLoadedRef.current.equipment_checks = true;
        setStructureChecks(st); childDataLoadedRef.current.structure_checks = true;
        setEnvironmentChecks(env); childDataLoadedRef.current.environment_checks = true;

        // Refresh photo galleries to pick up any imported photo metadata
        setPhotoRefreshKey(prev => prev + 1);

        hasUnsavedRef.current = true;
        setHasUnsavedChanges(true);
        toast.success("Imported data loaded into form");
      } catch (e) {
        console.warn('[DailyAssessmentForm] Failed to reload after import:', e);
      }
    };

    window.addEventListener('report-data-imported', handleReportImported);
    return () => window.removeEventListener('report-data-imported', handleReportImported);
  }, [id]);

  // Track if save is in progress to prevent duplicate calls
  const saveInProgressRef = useRef(false);

  // Save progress without completing - keeps status as draft
  const handleSaveProgress = async (silent = false) => {
    // Block all writes in Lovable preview to protect production data
    if ((await import('@/lib/environment')).isLovablePreview()) return;
    // Required-field gate: same invariant as the per-keystroke writer in
    // `handleUpdateAssessment`. Manual saves surface a toast pointing the
    // user at the offending field(s); auto-saves silently skip so the user
    // isn't spammed every interval while they're still editing.
    const requiredHeaderCheck = checkRequiredHeaderFields(
      assessment as unknown as Record<string, unknown>,
      'daily_assessment',
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
        console.log(`[Save] Skipping silent save — required fields missing: ${missingLabels}`);
      }
      return;
    }
    // Prevent duplicate save calls
    if (saveInProgressRef.current) {
      if (import.meta.env.DEV) console.log('[Save] Save already in progress, skipping');
      // Save Progress UI lifecycle fix — give the user feedback instead
      // of a silent no-op when they click during a previous save.
      if (!silent) {
        if (hasUnsavedRef.current || hasUnsavedChanges) {
          setHasUnsavedChanges(true);
          showSaveQueuedToast("queued");
        } else {
          showSaveQueuedToast("already-saved");
        }
      }
      return;
    }
    
    if (import.meta.env.DEV) console.log('[Save] Starting save progress...');
    saveInProgressRef.current = true;
    setSaving(true);
    if (!silent) setSaveError(null);

    // Safety timeout + Save Progress UI lifecycle early-release. NARROW —
    // only flips `saving` + `saveInProgressRef`. Dirty/lastSaved/merge
    // logic untouched in the success path.
    let safetyTimerFired = false;
    let localCommittedRef = false;
    const releaseSaveUiAfterLocalCommit = () => {
      if (localCommittedRef || safetyTimerFired) return;
      localCommittedRef = true;
      clearTimeout(safetyTimeout);
      setSaving(false);
      saveInProgressRef.current = false;
      if (import.meta.env.DEV) {
        console.log('[Save] Local hard-save committed — Save Progress button released; remote sync continues in background');
      }
    };
    const safetyTimeout = setTimeout(() => {
      if (localCommittedRef) return;
      console.warn('[Save] Safety timeout reached, forcing save state reset');
      safetyTimerFired = true;
      setSaving(false);
      saveInProgressRef.current = false;
    }, 8000);
    
    const { startedAtMs: saveStartedAtMs } = saveRaceGuard.beginSave();
    try {
      // offline storage is statically imported — no dynamic import overhead
      if (import.meta.env.DEV) console.log('[Save] Saving to offline storage...');
      const childOps: Promise<unknown>[] = [];
      const guardedSave = (key: AssessmentDataKey, data: DbRow[]) => {
        if (data.length > 0 || childDataLoadedRef.current[key]) {
          childOps.push(saveAssessmentDataOffline(key, id!, data, { allowEmpty: true }));
          } else {
            console.warn(`[DailyAssessment Save] Skipping ${key} save — empty array not confirmed as loaded`);
          }
        };
        guardedSave('beginning_of_day', beginningOfDay);
        guardedSave('end_of_day', endOfDay);
        guardedSave('operating_systems', operatingSystems);
        guardedSave('equipment_checks', equipmentChecks);
        guardedSave('structure_checks', structureChecks);
        guardedSave('environment_checks', environmentChecks);

        // Include parent assessment save in the same atomic batch
        const baseUpdatedAssessment = { 
          ...assessment, 
          updated_at: new Date().toISOString(),
          ...(currentUser?.id && currentUser.id !== assessment.inspector_id 
            ? { last_modified_by: currentUser.id } 
            : {}),
        };
        // S9: Reconcile user-clear intent across all six section collections.
        const totalChildCount =
          beginningOfDay.length + endOfDay.length + operatingSystems.length +
          equipmentChecks.length + structureChecks.length + environmentChecks.length;
        const { reconcileClearIntent } = await import('@/lib/clear-intent');
        const updatedAssessment = reconcileClearIntent(
          baseUpdatedAssessment,
          totalChildCount,
          !!baseUpdatedAssessment.synced_at,
        );
        childOps.push(
          withTimeout(saveDailyAssessmentOffline(updatedAssessment, { childCountHint: totalChildCount }), 3000, 'Assessment offline save')
        );

        // Layer 1: localStorage snapshot backup FIRST (before IndexedDB writes)
        try {
          saveReportSnapshot('daily_assessment', id!, assessment, {
            beginning_of_day: beginningOfDay,
            end_of_day: endOfDay,
            operating_systems: operatingSystems,
            equipment_checks: equipmentChecks,
            structure_checks: structureChecks,
            environment_checks: environmentChecks,
          }, false);
        } catch {}

        // Show hard-saved toast immediately after localStorage snapshot (always reliable)
        if (!silent) showHardSavedToast(lastVersionNumber ? lastVersionNumber + 1 : undefined, undefined);

        let localSaveSucceeded = false;
        try {
          await Promise.all(childOps);
          localSaveSucceeded = true;
          if (import.meta.env.DEV) console.log('[Save] Offline storage completed');

          // Layer 2: Append-only version history (metadata only)
          appendVersion('daily_assessment', id!, assessment, {
            beginning_of_day: beginningOfDay,
            end_of_day: endOfDay,
            operating_systems: operatingSystems,
            equipment_checks: equipmentChecks,
            structure_checks: structureChecks,
            environment_checks: environmentChecks,
          }, silent ? 'auto_save' : 'manual_save').then((v) => {
            if (v) {
              setLastVersionNumber(v.versionNumber);
              setLastFieldCount(v.fieldCount);
            }
          }).catch(() => {});
        } catch (offlineError) {
          console.warn('[Save] Offline storage failed:', offlineError);
          // Gap 2.1: re-throw IdbSaveError so the outer save handler keeps the dirty flag set
          const { isIdbSaveError } = await import('@/lib/offline-storage');
          if (isIdbSaveError(offlineError)) {
            setSaveError({
              message: 'Local save failed — your changes are NOT stored. Tap to retry.',
              code: (offlineError as { code?: import("@/lib/offline-storage").IdbSaveErrorCode })?.code,
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
      if (localSaveSucceeded && currentUser?.id && assessment?.inspector_id && currentUser.id !== assessment.inspector_id) {
        capturePreEditSnapshot('daily_assessment', id!, assessment.inspector_id, currentUser.id);
      }

      // Save Progress UI lifecycle fix — release button BEFORE the remote
      // sync tail runs.
      if (localSaveSucceeded) {
        releaseSaveUiAfterLocalCommit();
      }

      if (navigator.onLine && localSaveSucceeded) {
        if (import.meta.env.DEV) console.log('[Save] Online - syncing to database...');
        try {
          // RECONCILE: Delete server rows removed locally before upserting
          // C4: capture pre-images for restore-on-failure.
          let assessmentReconciledDeletes: ReconciledTableDelete[] = [];
          const user = await getUserWithCache();
          if (user) {
            // expectedNonEmpty: true — user-driven form save path; React
            // state is canonical. Without it, deleting the last row in a
            // child table trips reconcile Guard B and the row resurrects
            // on refresh.
            const reconcileResult = await reconcileAllChildTables(
              [
                { childTable: 'daily_assessment_beginning_of_day', parentIdColumn: 'assessment_id', localItems: beginningOfDay, expectedNonEmpty: true },
                { childTable: 'daily_assessment_end_of_day', parentIdColumn: 'assessment_id', localItems: endOfDay, expectedNonEmpty: true },
                { childTable: 'daily_assessment_operating_systems', parentIdColumn: 'assessment_id', localItems: operatingSystems, expectedNonEmpty: true },
                { childTable: 'daily_assessment_equipment_checks', parentIdColumn: 'assessment_id', localItems: equipmentChecks, expectedNonEmpty: true },
                { childTable: 'daily_assessment_structure_checks', parentIdColumn: 'assessment_id', localItems: structureChecks, expectedNonEmpty: true },
                { childTable: 'daily_assessment_environment_checks', parentIdColumn: 'assessment_id', localItems: environmentChecks, expectedNonEmpty: true },
              ],
              id!,
              'daily_assessment',
              user.id,
            );
            assessmentReconciledDeletes = reconcileResult.deletedByTable;
          }

          // Use upsert with onConflict to prevent duplicates
          const upsertResults = await Promise.all([
            beginningOfDay.length > 0 
              ? supabase.from('daily_assessment_beginning_of_day').upsert(
                  beginningOfDay.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })) as never,
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
            endOfDay.length > 0 
              ? supabase.from('daily_assessment_end_of_day').upsert(
                  endOfDay.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })) as never,
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
            operatingSystems.length > 0 
              ? supabase.from('daily_assessment_operating_systems').upsert(
                  operatingSystems.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })) as never,
                  { onConflict: 'assessment_id,system_name' }
                )
              : { error: null, data: null },
            equipmentChecks.length > 0 
              ? supabase.from('daily_assessment_equipment_checks').upsert(
                  equipmentChecks.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })) as never,
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
            structureChecks.length > 0 
              ? supabase.from('daily_assessment_structure_checks').upsert(
                  structureChecks.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })) as never,
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
            environmentChecks.length > 0 
              ? supabase.from('daily_assessment_environment_checks').upsert(
                  environmentChecks.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })) as never,
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
          ]);

          // Check for errors in any upsert
          const errors = upsertResults.filter(r => r.error);
          if (errors.length > 0) {
            console.error('[Save] Upsert errors:', errors.map(e => e.error));
            // C4: parallel upsert(s) failed — restore the rows reconcile already deleted.
            if (assessmentReconciledDeletes.length > 0) {
              try {
                await restoreReconciledDeletions(assessmentReconciledDeletes, id!);
              } catch (restoreErr) {
                console.error('[C4] DailyAssessmentForm: restoreReconciledDeletions threw', restoreErr);
              }
            }
            throw new Error(`Failed to save ${errors.length} section(s)`);
          }
          if (import.meta.env.DEV) console.log('[Save] Child tables synced successfully');

          // DEFERRED: Update assessment parent first WITHOUT synced_at
          const { data: updateResult, error: assessmentUpdateError } = await supabase
            .from('daily_assessments')
            .update({ updated_at: updatedAssessment.updated_at })
            .eq('id', id)
            .select('id');

          if (assessmentUpdateError) {
            console.error('[Save] Assessment update error:', assessmentUpdateError);
            throw assessmentUpdateError;
          }
          
          // Verification: If 0 rows updated, record may not exist on server — use upsert
          if (!updateResult || updateResult.length === 0) {
            console.warn('[Save] Update returned 0 rows — falling back to upsert');
            const { error: upsertError } = await supabase
              .from('daily_assessments')
              .upsert({ id, updated_at: updatedAssessment.updated_at, inspector_id: updatedAssessment.inspector_id });
            if (upsertError) throw upsertError;
          }
          
          // Set synced_at ONLY after all child data committed and parent verified
          const saveSyncTimestamp = new Date().toISOString();
          const { data: verifyData, error: finalSyncError } = await supabase
            .from('daily_assessments')
            .update({ synced_at: saveSyncTimestamp })
            .eq('id', id)
            .select('id, synced_at');
          
          if (finalSyncError || !verifyData?.length) {
            console.error('[Save] Post-sync verification failed:', finalSyncError);
            throw new Error("Sync verification failed: server did not confirm synced_at update");
          }
          if (import.meta.env.DEV) console.log('[Save] Assessment synced to database (verified)');

          // Only mark local as synced after server confirmation
          updatedAssessment.synced_at = saveSyncTimestamp;
          try {
            await withTimeout(saveDailyAssessmentOffline(updatedAssessment), 2000, 'Synced_at update');
          } catch (e) {
            console.warn('[Save] Synced_at offline update timed out');
          }
          
           markSnapshotSynced('daily_assessment', id!);
        } catch (error) {
          console.error('[Save] Error syncing to database:', error);
          try {
            await Promise.race([
              queueAssessmentOperation('update', id!, updatedAssessment),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
            ]);
          } catch (queueError) {
            console.warn('[Save] Failed to queue operation:', queueError);
          }
          if (isMobile()) {
            addSyncNotification("Saved locally, will sync when connection improves");
          } else {
            toast.warning("Saved locally, will sync when connection improves");
          }
        }
      } else {
        console.log('[Save] Offline - queuing for sync');
        try {
          await Promise.race([
            queueAssessmentOperation('update', id!, updatedAssessment),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
          ]);
        } catch (queueError) {
          console.warn('[Save] Failed to queue operation:', queueError);
        }
        if (isMobile()) {
          addSaveNotification("Saved offline");
        } else {
          toast.success("Saved offline");
        }
      }

      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      setLastSaved(new Date());
      setAssessment(updatedAssessment);
      setSaveError(null);
    } catch (error) {
      console.error('[Save] Error saving progress:', error);
      logError(error, { scope: 'DailyAssessmentForm.handleSaveProgress' });
      const { isIdbSaveError } = await import('@/lib/offline-storage');
      if (isIdbSaveError(error)) {
        setSaveError({ message: error.message || 'Save failed', code: error.code });
      } else {
        toast.error("Failed to save progress");
      }
    } finally {
      clearTimeout(safetyTimeout);
      console.log('[Save] Completed, setting saving to false');
      // Skip if the early local-commit release or safety timer already
      // handled UI/mutex cleanup — avoids stomping a newer invocation.
      if (!safetyTimerFired && !localCommittedRef) {
        setSaving(false);
        saveInProgressRef.current = false;
      }
    }
  };

  // Keep handleSaveProgressRef pointing to the latest handleSaveProgress on every render
  handleSaveProgressRef.current = handleSaveProgress;

  // Auto-save/sync retry is now handled by useAutoSync hook

  // Wrapper handlers for data section updates
  const handleBeginningOfDayUpdate = useCallback((items: DbRow[]) => {
    setBeginningOfDay(items);
  }, []);

  const handleEndOfDayUpdate = useCallback((items: DbRow[]) => {
    setEndOfDay(items);
  }, []);

  // Routes through the tracked setter so functional shrink updates from the
  // Operating Systems section record the removed id into the deletion ref.
  const handleOperatingSystemsUpdate = useCallback<Dispatch<SetStateAction<DbRow[]>>>((action) => {
    setOperatingSystemsTracked(action);
  }, [setOperatingSystemsTracked]);

  const handleEquipmentChecksUpdate = useCallback((items: DbRow[]) => {
    setEquipmentChecks(items);
  }, []);

  const handleStructureChecksUpdate = useCallback((items: DbRow[]) => {
    setStructureChecks(items);
  }, []);

  const handleEnvironmentChecksUpdate = useCallback((items: DbRow[]) => {
    setEnvironmentChecks(items);
  }, []);

  // Submit and complete the assessment
  const handleSubmit = async (attestation?: AttestationPayload) => {
    console.log('[Submit] Starting submit...');
    setSubmitting(true);
    setShowSubmitDialog(false);
    
    try {
      
      
      // Save related data offline with timeout protection (non-blocking)
      console.log('[Submit] Saving to offline storage...');
      try {
        await withTimeout(
          Promise.all([
            saveAssessmentDataOffline('beginning_of_day', id!, beginningOfDay),
            saveAssessmentDataOffline('end_of_day', id!, endOfDay),
            saveAssessmentDataOffline('operating_systems', id!, operatingSystems),
            saveAssessmentDataOffline('equipment_checks', id!, equipmentChecks),
            saveAssessmentDataOffline('structure_checks', id!, structureChecks),
            saveAssessmentDataOffline('environment_checks', id!, environmentChecks),
          ]),
          5000,
          'Offline storage save'
        );
      } catch (offlineError) {
        console.warn('[Submit] Offline storage failed or timed out:', offlineError);
      }

      // Update assessment status to completed
      const wasAlreadyCompleted = assessment?.status === 'completed';
      const completedAssessment = {
        ...assessment,
        status: 'completed',
        updated_at: new Date().toISOString(),
        app_version_at_completion: APP_VERSION_FULL,
        ...(attestation || {}),
      };
      
      try {
        await withTimeout(saveDailyAssessmentOffline(completedAssessment), 3000, 'Assessment offline save');
      } catch (e) {
        console.warn('[Submit] Assessment offline save timed out:', e);
      }

      // Trigger celebration on first completion
      if (!wasAlreadyCompleted) {
        triggerCompletionConfetti();
        triggerHaptic('success');
      }

      if (navigator.onLine) {
        console.log('[Submit] Online - syncing to database...');
        try {
          // Use upsert with onConflict to prevent duplicates
          const upserts = [];
          
          if (beginningOfDay.length > 0) {
            upserts.push(
              supabase.from('daily_assessment_beginning_of_day').upsert(
                beginningOfDay.map(item => ({ 
                  ...item, 
                  assessment_id: id,
                  id: item.id || crypto.randomUUID()
                })) as never,
                { onConflict: 'assessment_id,item_key' }
              )
            );
          }
          if (endOfDay.length > 0) {
            upserts.push(
              supabase.from('daily_assessment_end_of_day').upsert(
                endOfDay.map(item => ({ 
                  ...item, 
                  assessment_id: id,
                  id: item.id || crypto.randomUUID()
                })) as never,
                { onConflict: 'assessment_id,item_key' }
              )
            );
          }
          if (operatingSystems.length > 0) {
            upserts.push(
              supabase.from('daily_assessment_operating_systems').upsert(
                operatingSystems.map(item => ({ 
                  ...item, 
                  assessment_id: id,
                  id: item.id || crypto.randomUUID()
                })) as never,
                { onConflict: 'assessment_id,system_name' }
              )
            );
          }
          if (equipmentChecks.length > 0) {
            upserts.push(
              supabase.from('daily_assessment_equipment_checks').upsert(
                equipmentChecks.map(item => ({ 
                  ...item, 
                  assessment_id: id,
                  id: item.id || crypto.randomUUID()
                })) as never,
                { onConflict: 'assessment_id,item_key' }
              )
            );
          }
          if (structureChecks.length > 0) {
            upserts.push(
              supabase.from('daily_assessment_structure_checks').upsert(
                structureChecks.map(item => ({ 
                  ...item, 
                  assessment_id: id,
                  id: item.id || crypto.randomUUID()
                })) as never,
                { onConflict: 'assessment_id,item_key' }
              )
            );
          }
          if (environmentChecks.length > 0) {
            upserts.push(
              supabase.from('daily_assessment_environment_checks').upsert(
                environmentChecks.map(item => ({ 
                  ...item, 
                  assessment_id: id,
                  id: item.id || crypto.randomUUID()
                })) as never,
                { onConflict: 'assessment_id,item_key' }
              )
            );
          }

          await Promise.all(upserts);
          console.log('[Submit] Child tables synced');

          // Update status to completed (include attestation + version when present)
          const submitSyncTimestamp = new Date().toISOString();
          const assessmentUpdate: Record<string, unknown> = {
            status: 'completed',
            updated_at: completedAssessment.updated_at,
            synced_at: submitSyncTimestamp,
            app_version_at_completion: APP_VERSION_FULL,
          };
          if (attestation) Object.assign(assessmentUpdate, attestation);
          await supabase
            .from('daily_assessments')
            .update(assessmentUpdate as never)
            .eq('id', id);
          console.log('[Submit] Assessment status updated');

          // Update synced_at
          completedAssessment.synced_at = new Date().toISOString();
          try {
            await withTimeout(saveDailyAssessmentOffline(completedAssessment), 2000, 'Synced_at update');
          } catch (e) {
             console.warn('[Submit] Synced_at offline update timed out');
           }
           markSnapshotSynced('daily_assessment', id!);
        } catch (error) {
          console.error('[Submit] Error syncing to database:', error);
          try {
            await Promise.race([
              queueAssessmentOperation('update', id!, completedAssessment),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
            ]);
          } catch (queueError) {
            console.warn('[Submit] Failed to queue operation:', queueError);
          }
        }
      } else {
        console.log('[Submit] Offline - queuing for sync');
        try {
          await Promise.race([
            queueAssessmentOperation('update', id!, completedAssessment),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 5000)),
          ]);
        } catch (queueError) {
          console.warn('[Submit] Failed to queue operation:', queueError);
        }
      }

      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      toast.success("Assessment submitted successfully");
      navigate('/dashboard');
    } catch (error) {
      console.error('[Submit] Error submitting assessment:', error);
      toast.error("Failed to submit assessment");
    } finally {
      console.log('[Submit] Completed, setting submitting to false');
      setSubmitting(false);
    }
  };

  // Set save ref for keyboard shortcut (save progress, not submit)
  useEffect(() => {
    saveRef.current = async () => { await handleSaveProgress(); setLastManuallySaved(new Date()); };
  });

  // Verify that database has the expected data
  const verifyDataSaved = async (): Promise<boolean> => {
    try {
      const [eqResult, stResult, envResult, bodResult, eodResult] = await Promise.all([
        supabase.from('daily_assessment_equipment_checks').select('id', { count: 'exact' }).eq('assessment_id', id),
        supabase.from('daily_assessment_structure_checks').select('id', { count: 'exact' }).eq('assessment_id', id),
        supabase.from('daily_assessment_environment_checks').select('id', { count: 'exact' }).eq('assessment_id', id),
        supabase.from('daily_assessment_beginning_of_day').select('id', { count: 'exact' }).eq('assessment_id', id),
        supabase.from('daily_assessment_end_of_day').select('id', { count: 'exact' }).eq('assessment_id', id),
      ]);

      const expectedEquipment = equipmentChecks.filter(c => c.is_checked).length;
      const expectedStructure = structureChecks.filter(c => c.is_checked).length;
      const expectedEnvironment = environmentChecks.filter(c => c.is_checked).length;
      const expectedBeginning = beginningOfDay.filter(c => c.is_complete).length;
      const expectedEnd = endOfDay.filter(c => c.is_complete).length;

      console.log(`[Report] Database has: equipment=${eqResult.count}, structure=${stResult.count}, environment=${envResult.count}, beginning=${bodResult.count}, end=${eodResult.count}`);
      console.log(`[Report] Expected (checked): equipment=${expectedEquipment}, structure=${expectedStructure}, environment=${expectedEnvironment}, beginning=${expectedBeginning}, end=${expectedEnd}`);

      // Verify we have at least as many records as checked items
      return (
        (eqResult.count ?? 0) >= expectedEquipment &&
        (stResult.count ?? 0) >= expectedStructure &&
        (envResult.count ?? 0) >= expectedEnvironment &&
        (bodResult.count ?? 0) >= expectedBeginning &&
        (eodResult.count ?? 0) >= expectedEnd
      );
    } catch (error) {
      console.error('[Report] Error verifying data:', error);
      return false;
    }
  };

  const handleGenerateReport = async () => {
    setGenerating(true);
    const progressToastId = toast.loading("Generating report...");
    
    // Safety timeout - NEVER get stuck in generating state (60 seconds max)
    const GENERATION_TIMEOUT = 120000;
    const safetyTimeoutHandle = setTimeout(() => {
      console.error('[Report Generation] Safety timeout reached after 60 seconds - force resetting state');
      setGenerating(false);
      toast.dismiss(progressToastId);
      toast.error("Report generation timed out. Please check your connection and try again.");
    }, GENERATION_TIMEOUT);
    
    try {
      // Force save any pending changes before generating (with timeout)
      if (hasUnsavedChanges) {
        console.log('[Report] Saving pending changes before generating report...');
        toast.info("Saving changes before generating report...");
        try {
          await Promise.race([
            handleSaveProgress(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Save timeout')), 3000))
          ]);
        } catch (saveError) {
          console.warn('[Report] Pre-save timed out, proceeding anyway:', saveError);
        }
        // Short wait for data to be committed
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Verify data was saved correctly (with timeout)
      if (navigator.onLine) {
        console.log('[Report] Verifying data was saved...');
        try {
          const verified = await Promise.race([
            verifyDataSaved(),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000))
          ]);
          
          if (!verified) {
            console.warn('[Report] Data verification failed or timed out, proceeding anyway');
            if (isMobile()) {
              addNotification('info', 'Some items may not appear if not yet synced', 'medium');
            } else {
              toast.warning("Some items may not appear in the report if not yet synced.");
            }
          }
        } catch (verifyError) {
          console.warn('[Report] Verification error:', verifyError);
        }
      }

      console.log('[Report] Generating report...');

      // OPTIMIZATION: Client-side cache check
      if (!hasUnsavedChanges && assessment?.latest_report_generated_at && assessment?.updated_at) {
        const generatedAt = new Date(assessment.latest_report_generated_at).getTime();
        const updatedAt = new Date(assessment.updated_at).getTime();
        
        if (generatedAt >= updatedAt) {
          console.log('[Report] Client-side cache HIT — fetching cached report from DB');
          toast.loading("Loading cached report...", { id: progressToastId });
          const cachedHtml = await getLatestReport();
          if (cachedHtml) {
            clearTimeout(safetyTimeoutHandle);
            toast.dismiss(progressToastId);
            setReportHtml(cachedHtml);
            setViewerOpen(true);
            setGenerating(false);
            return;
          }
          console.log('[Report] Cache returned empty, falling through to generation');
        }
      }
      
      // Wrap the edge function call in a Promise.race with timeout
      const generatePromise = supabase.functions.invoke('generate-daily-assessment-html', {
        body: { assessmentId: id },
      });
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('TIMEOUT: Report generation took too long'));
        }, GENERATION_TIMEOUT - 2000); // 2 seconds before safety timeout (to account for pre-save time)
      });
      
      const { data, error } = await Promise.race([generatePromise, timeoutPromise]);

      if (error) throw error;

      // Backend now returns a signed URL instead of raw HTML
      let html: string;
      
      if (data?.htmlUrl) {
        console.log('[Report Generation] Fetching HTML from signed URL...');
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
      
      // Auto-sync report to database for "latest report" functionality (non-blocking)
      syncReport(html).catch(syncErr => {
        console.warn('[Report] Failed to sync report to database:', syncErr);
      });
      
      const filename = formatReportFilename(assessment?.organization, 'daily-assessment', 'html');
      const title = formatReportTitle(assessment?.organization, 'daily-assessment');

      // Always use in-app viewer for consistent Save PDF + Close buttons
      toast.dismiss(progressToastId);
      setReportHtml(html);
      setViewerOpen(true);
    } catch (error) {
      toast.dismiss(progressToastId);
      const msg = errorMessage(error, '');
      console.error('[Report Generation] Error:', msg || error);

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
      setGenerating(false);
    }
  };

  if (loading || isLoadingConfig) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const beginningSection = formConfig?.find(s => s.section_key === 'beginning_of_day');
  const endSection = formConfig?.find(s => s.section_key === 'end_of_day');
  const systemsSection = formConfig?.find(s => s.section_key === 'operating_systems_daily');
  const equipmentSection = formConfig?.find(s => s.section_key === 'equipment_checks');
  const structureSection = formConfig?.find(s => s.section_key === 'structure_checks');
  const environmentSection = formConfig?.find(s => s.section_key === 'environment_checks');

  return (
    <>
      <UnsavedChangesDialog
        isOpen={isBlocked}
        onConfirm={confirmNavigation}
        onCancel={cancelNavigation}
        onSaveAndLeave={saveAndLeave}
        hasUnsavedChanges={hasUnsavedChanges && (assessment?.status !== 'completed' || completionLockOverridden)}
        message="You have unsaved changes to this assessment. Are you sure you want to leave?"
      />
      
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit Assessment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to submit this assessment? This will mark it as complete. You can still edit it afterward if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleSubmit()}>
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CompletionLockDialog
        open={showCompletionLockDialog}
        onOpenChange={setShowCompletionLockDialog}
        onConfirm={() => setCompletionLockOverridden(true)}
      />

      <AttestationDialog
        open={showAttestationDialog}
        onOpenChange={setShowAttestationDialog}
        kind="daily_assessment"
        signerName={signerFullName}
        signerId={assessment?.inspector_id ?? null}
        organization={assessment?.organization || ''}
        reportDate={assessment?.assessment_date || new Date().toISOString().slice(0, 10)}
        onSigned={(payload) => handleSubmit(payload)}
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
            console.warn('[DailyAssessmentForm] Save-before-leave error:', e);
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
      {!isOnline && !loading && beginningOfDay.length === 0 && endOfDay.length === 0 &&
        equipmentChecks.length === 0 && !childDataLoadedRef.current.beginning_of_day && 
        !childDataLoadedRef.current.end_of_day && !childDataLoadedRef.current.equipment_checks && (
        <div className="bg-muted border-b border-border">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <WifiOff className="w-5 h-5 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">
                Assessment details not available offline. Connect to the internet to load full data.
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
                isSaving={saving}
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
                size={isMobileView ? "default" : "sm"} 
                onClick={async () => { await handleSaveProgress(); setLastManuallySaved(new Date()); }} 
                disabled={saving || submitting}
              >
                <Save className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                {isMobileView ? (saving ? "..." : "Save") : (saving ? "Saving..." : "Save Progress")}
              </Button>
              {id && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Force Local Backup"
                onClick={async () => {
                  if (assessment && id) {
                    saveReportSnapshot('daily_assessment', id, assessment, {
                      beginning_of_day: beginningOfDay,
                      end_of_day: endOfDay,
                      operating_systems: operatingSystems,
                      equipment_checks: equipmentChecks,
                      structure_checks: structureChecks,
                      environment_checks: environmentChecks,
                    }, !!assessment.synced_at);
                  }
                  const ok = await downloadReportBackup('daily_assessment', id);
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
                disabled={refreshing || saving || submitting}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await loadAssessment();
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
              {assessment?.status !== 'completed' && (
              <Button 
                size={isMobileView ? "default" : "sm"} 
                onClick={handleCompleteClick}
                disabled={saving || submitting}
                className={isMobileView ? "min-w-[100px] h-10 text-sm font-medium" : ""}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                    <span>Complete</span>
                  </>
                )}
              </Button>
              )}
              {assessment?.status === 'completed' && (
                <Button disabled variant="outline" size={isMobileView ? "default" : "sm"} className="opacity-70 cursor-default">
                  <CheckCircle className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                  <span>Completed</span>
                </Button>
              )}
              </>
              )}
              {assessment?.status === 'completed' && (
                <>
                {isMobileView && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleGenerateReport}
                    disabled={generating}
                    className="h-9 w-9"
                  >
                    <RefreshCw className={cn("w-4 h-4", generating && "animate-spin")} />
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size={isMobileView ? "default" : "sm"} 
                  onClick={handleGenerateReport} 
                  disabled={generating}
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <FileText className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                      {isMobileView ? "" : "Generate Report"}
                    </>
                  )}
                </Button>
                {isAdmin && assessment?.status === 'completed' && (
                  <Button
                    variant="outline"
                    size={isMobileView ? "default" : "sm"}
                    onClick={toggleInvoiced}
                    disabled={invoiceToggling}
                    className={cn("bg-emerald-500/10 backdrop-blur-md border-emerald-400/30 text-emerald-600 dark:text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.15)] hover:bg-emerald-500/20 hover:text-emerald-700 dark:hover:text-emerald-300", isInvoiced && "bg-emerald-500/25 shadow-[0_0_16px_rgba(16,185,129,0.3)] animate-pulse-calm")}
                  >
                    <Receipt className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                    {isMobileView ? "" : (isInvoiced ? "Invoiced ✓" : "Invoice")}
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
        onRetry={() => handleSaveProgressRef.current?.() ?? Promise.resolve()}
        onExportDraft={() => ({
          assessment,
          beginning_of_day: beginningOfDay,
          end_of_day: endOfDay,
          operating_systems: operatingSystems,
          equipment_checks: equipmentChecks,
          structure_checks: structureChecks,
          environment_checks: environmentChecks,
          exported_at: new Date().toISOString(),
        })}
        reportType="daily-assessment"
        reportId={id}
      />

      <div onClickCapture={handleLockedFieldClick} onPointerDownCapture={handleLockedFieldClick} className={cn("container mx-auto px-4 py-4 lg:py-8 max-w-5xl", isCompletionLocked && "completion-locked")}>
        {isCompletionLocked && (
          <div className="border-2 border-green-500/60 bg-black/90 text-green-500 font-mono text-xs px-4 py-2 flex items-center gap-2 mb-4 rounded">
            <Lock className="h-3.5 w-3.5" />
            <span>LOCKED — Click any field to unlock for editing</span>
          </div>
        )}
      <div className="space-y-6">
        {(() => {
          const requiredHeaderCheck = checkRequiredHeaderFields(
            assessment as unknown as Record<string, unknown>,
            'daily_assessment',
          );
          if (requiredHeaderCheck.ok) return null;
          const missingLabels = formatMissingFieldLabels(requiredHeaderCheck.missing);
          return (
            <div
              role="alert"
              className="border-2 border-red-500/60 bg-red-950/30 text-red-400 font-mono text-xs px-4 py-3 rounded flex items-start gap-2"
              data-testid="required-fields-banner"
            >
              <Lock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">SAVING DISABLED — required fields missing</div>
                <div>
                  Fill in <span className="text-red-200">{missingLabels}</span> to resume saving. Edits to other fields are kept in the form but will not persist until the required fields are filled.
                </div>
              </div>
            </div>
          );
        })()}
        <DailyAssessmentHeader
          assessment={assessment}
          onUpdate={effectiveReadOnly ? () => {} : handleUpdateAssessment}
          isReadOnly={effectiveReadOnly}
          userProfile={inspectorProfile as { first_name?: string; last_name?: string } | null}
          modifiedByProfile={modifiedByProfile as { first_name?: string; last_name?: string } | null}
          missingFieldKeys={missingRequiredFields.map(m => m.key)}
        />
        {id && currentUser?.id && (
          <CollaboratorPresence
            reportId={id}
            reportType="daily_assessment"
            currentUserId={currentUser.id}
            currentUserName={signerFullName || currentUser?.email || 'Someone'}
          />
        )}

        {/* Swipe back indicator for mobile */}
        {isMobileView && isFirstTab && (
          <SwipeBackIndicator 
            progress={swipeState.swipeProgress} 
            isActive={swipeState.isSwipingBack} 
          />
        )}

        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <div ref={swipeContainerRef} className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm pb-1">
            <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7 gap-1 lg:gap-0 h-auto p-1.5 lg:p-1">
              <TabsTrigger value="beginning" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Sunrise className="h-3.5 w-3.5" />
                <span>Beginning</span>
              </TabsTrigger>
              <TabsTrigger value="end" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Sunset className="h-3.5 w-3.5" />
                <span>{isMobileView ? "End" : "End of Day"}</span>
              </TabsTrigger>
              <TabsTrigger value="systems" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                <span>Systems</span>
              </TabsTrigger>
              <TabsTrigger value="equipment" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Package className="h-3.5 w-3.5" />
                <span>Equipment</span>
              </TabsTrigger>
              <TabsTrigger value="structure" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Building className="h-3.5 w-3.5" />
                <span>Structure</span>
              </TabsTrigger>
              <TabsTrigger value="environment" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Cloud className="h-3.5 w-3.5" />
                <span>Environment</span>
              </TabsTrigger>
              <TabsTrigger value="photos" className="text-xs lg:text-sm py-2 flex flex-col lg:flex-row items-center gap-1 lg:gap-1.5">
                <Camera className="h-3.5 w-3.5" />
                <span>Photos</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div>
              <TabsContent value="beginning" className="space-y-4 mt-4">
                <BeginningOfDaySection 
                  items={beginningOfDay} 
                  onUpdate={handleBeginningOfDayUpdate} 
                />
              </TabsContent>

              <TabsContent value="end" className="space-y-4 mt-4">
                <EndOfDaySection 
                  items={endOfDay} 
                  onUpdate={handleEndOfDayUpdate} 
                />
              </TabsContent>

              <TabsContent value="systems" className="space-y-4 mt-4">
                <OperatingSystemsSection 
                  systems={operatingSystems} 
                  onUpdate={handleOperatingSystemsUpdate}
                  sectionComments={assessment?.systems_comments || ''}
                  onSectionCommentsChange={(value) => handleUpdateAssessment('systems_comments', value)}
                  onSectionCommentsBlur={triggerImmediateSave}
                />
              </TabsContent>

              <TabsContent value="equipment" className="space-y-4 mt-4">
                <EquipmentChecksSection 
                  checks={equipmentChecks} 
                  onUpdate={handleEquipmentChecksUpdate} 
                />
              </TabsContent>

              <TabsContent value="structure" className="space-y-4 mt-4">
                <StructureChecksSection 
                  checks={structureChecks} 
                  onUpdate={handleStructureChecksUpdate}
                  sectionComments={assessment?.structure_comments || ''}
                  onSectionCommentsChange={(value) => handleUpdateAssessment('structure_comments', value)}
                  onSectionCommentsBlur={triggerImmediateSave}
                />
              </TabsContent>

              <TabsContent value="environment" className="space-y-4 mt-4">
                <EnvironmentChecksSection 
                  checks={environmentChecks} 
                  onUpdate={handleEnvironmentChecksUpdate}
                  sectionComments={assessment?.environment_comments || ''}
                  onSectionCommentsChange={(value) => handleUpdateAssessment('environment_comments', value)}
                  onSectionCommentsBlur={triggerImmediateSave}
                />
              </TabsContent>

              <TabsContent value="photos" className="space-y-4 mt-4">
                <div className="border-2 border-foreground/20 bg-background p-6 rounded-md">
                  <h3 className="text-lg font-semibold font-mono tracking-tight mb-4">Assessment Photos</h3>
                  {!effectiveReadOnly && (
                    <div className="mb-4">
                      <PhotoCapture
                        inspectionId={id!}
                        section="assessment"
                        onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
                        tableName="daily_assessment_photos"
                        foreignKeyColumn="assessment_id"
                        storageBucket="daily-assessment-photos"
                      />
                    </div>
                  )}
                  <PhotoGallery
                    key={`assessment-${photoRefreshKey}`}
                    inspectionId={id!}
                    section="assessment"
                    readOnly={effectiveReadOnly}
                    tableName="daily_assessment_photos"
                    foreignKeyColumn="assessment_id"
                    storageBucket="daily-assessment-photos"
                  />
                </div>
              </TabsContent>
          </div>
        </Tabs>
      </div>
      </div>
      

      <HtmlReportViewer
        html={reportHtml}
        title={formatReportTitle(assessment?.organization, 'daily-assessment')}
        filename={formatReportFilename(assessment?.organization, 'daily-assessment', 'html')}
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />

      </div>
    </>
  );
}
