import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { formatReportFilename, formatReportTitle } from "@/lib/report-naming";
import { useReportTabHistory } from "@/hooks/useReportTabHistory";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/sonner";
import { addSaveNotification, addSyncNotification } from "@/lib/notification-center";
import { onSyncComplete, markPendingDashboardRefresh, markDashboardStaleTimestamp, registerActiveFormRecord, unregisterActiveFormRecord, onPendingRemoteUpdate, isRecentSelfWrite } from "@/lib/sync-events";
import { useFormRecordRealtime } from "@/hooks/useFormRecordRealtime";
import { useNavigate, useParams } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { isLocalDataNewer } from "@/lib/local-data-guards";
import { applyTrackedFieldWrite, mergeRecordFields, TRACKED_FIELDS } from "@/lib/field-merge";
import { checkRequiredHeaderFields, formatMissingFieldLabels } from "@/lib/header-required-fields";
import { hasTextContent } from "@/lib/html-content-cleaner";
import { supabase } from "@/integrations/supabase/client";
import type { PostgrestError, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { CachedUser } from "@/lib/cached-auth";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Save, CheckCircle, Loader2, WifiOff, CloudOff, LogOut, User, FileText, Settings, Package, ClipboardList, FileCheck, RefreshCw, AlertTriangle, HardDrive } from "lucide-react";
import { AutoSaveIndicator } from "@/components/AutoSaveIndicator";
import { SaveFailureBanner } from "@/components/SaveFailureBanner";
import { useActiveTimer } from "@/hooks/useActiveTimer";
import { ActiveTimerDisplay } from "@/components/ActiveTimerDisplay";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import InspectionHeader from "@/components/inspection/InspectionHeader";
import { CollaboratorPresence } from "@/components/CollaboratorPresence";
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
  saveRelatedDataOffline,
  getRelatedDataOffline,
  getOfflinePhotos,
  type DbRow,
  type IdbSaveErrorCode,
} from "@/lib/offline-storage";
import { validateInspectionPackage } from "@/lib/validation-schemas";
import { getMissingInspectionFields, formatMissingDescription, type MissingField } from "@/lib/required-fields";
import { AttestationDialog } from "@/components/AttestationDialog";
import { useUserProfile } from "@/hooks/useUserProfile";
import type { AttestationPayload } from "@/lib/attestation";
import { APP_VERSION_FULL } from "@/lib/attestation";
import { reconcileAllChildTables, restoreReconciledDeletions, type ReconciledTableDelete } from "@/lib/sync-reconciliation";
import { cn } from "@/lib/utils";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useStorageHealthCheck } from "@/hooks/useStorageHealthCheck";

import { usePWA } from "@/hooks/usePWA";
import { ForceSyncButton } from "@/components/pwa/ForceSyncButton";
import { convertCircleBulletsToHtml } from "@/lib/bullet-converter";
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";
import { HtmlReportViewer } from "@/components/HtmlReportViewer";

import { useKeyboardAvoidance } from "@/hooks/useKeyboardAvoidance";
import { useScrollBoundaryDetection } from "@/hooks/useScrollBoundaryDetection";
import { useReportSync } from "@/hooks/useReportSync";
import { isMobile } from "@/lib/mobile-detection";
import { triggerCompletionConfetti } from "@/lib/confetti";
import { triggerHaptic } from "@/lib/haptics";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SwipeBackIndicator } from "@/components/SwipeBackIndicator";
// UserProfileDropdown moved to AuthenticatedHeader (global)

import { Check } from "lucide-react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useEmergencySave } from "@/hooks/useEmergencySave";
import { saveReportSnapshot, getReportSnapshot, markSnapshotSynced, downloadReportBackup } from "@/lib/local-backup-ledger";
import { capturePreEditSnapshot } from "@/lib/admin-edit-snapshot";
import { logError } from "@/lib/log-error";
import { onCloudBackupError } from "@/lib/cloud-backup";
import { useSaveShortcut } from "@/hooks/useKeyboardShortcuts";
import { useReportEditPermission } from "@/hooks/useReportEditPermission";
import { CompletionLockDialog } from "@/components/CompletionLockDialog";
import { SaveBeforeLeaveDialog } from "@/components/SaveBeforeLeaveDialog";
import { Lock } from "lucide-react";
import { appendVersion, subscribeVersioningHealth, getVersioningHealth, resetVersioningHealth } from "@/lib/report-version-manager";
import { showHardSavedToast } from "@/lib/toast-helpers";
import { DataIntegrityBadge, type IntegrityStatus } from "@/components/ui/data-integrity-badge";
import { VersionHistoryPanel } from "@/components/admin/VersionHistoryPanel";
import { Shield as ShieldIcon, Receipt } from "lucide-react";
import { useInvoicedStatus } from "@/hooks/useInvoicedStatus";
import { useEquipmentTypeOptions } from "@/hooks/useEquipmentTypeOptions";

// Slice 1 — STANDARDS_TEMPLATE + merge helpers extracted to inspectionLoader.
import {
  mergeStandards,
  mergeStandardsPreserveLocal,
} from "@/lib/form-loaders/inspectionLoader";
// Slice 1.5 — performSave engine extracted to inspectionSaver.
import {
  persistInspectionToOffline,
  pushInspectionToRemote,
} from "@/lib/form-savers/inspectionSaver";
import { InspectionHeaderSection } from "@/components/inspection/InspectionHeaderSection";

// `saveRelatedDataOffline` accepts a small set of well-known child-table keys.
// Mirrors the `RelatedDataType` union in `@/lib/offline-storage`.
type RelatedDataKey = 'systems' | 'ziplines' | 'equipment' | 'standards' | 'summary';

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

function errorCode(error: unknown): IdbSaveErrorCode | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code as IdbSaveErrorCode;
  }
  return undefined;
}

export default function InspectionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const { isSyncing } = usePWA();
  const isMobileView = useIsMobile();
  const { storageUnavailable } = useStorageHealthCheck();
  const { syncReport, getLatestReport } = useReportSync(id, 'inspection');
  
  // Check edit permissions - Super Admins are view-only, only owners can edit
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const { canEdit, isReadOnly, isOwner, isSuperAdmin, isAdmin, readOnlyReason } = useReportEditPermission({
    inspectorId,
    reportType: 'inspection'
  });
  
  // Completion lock: prevent accidental edits to completed reports
  const [completionLockOverridden, setCompletionLockOverridden] = useState(false);
  const [showCompletionLockDialog, setShowCompletionLockDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [showAttestationDialog, setShowAttestationDialog] = useState(false);
  const { fullName: signerFullName } = useUserProfile();
  const [isSavingBeforeLeave, setIsSavingBeforeLeave] = useState(false);
  // Enable keyboard avoidance for mobile
  useKeyboardAvoidance();
  
  // Enable scroll boundary detection with haptic feedback (mobile only)
  const isMobileDevice = isMobile();
  useScrollBoundaryDetection(isMobileDevice);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [generatingHtml, setGeneratingHtml] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [lastManuallySaved, setLastManuallySaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [lastVersionNumber, setLastVersionNumber] = useState<number | undefined>(undefined);
  const [lastFieldCount, setLastFieldCount] = useState<number | undefined>(undefined);
  const [saveError, setSaveError] = useState<import("@/components/SaveFailureBanner").SaveErrorState>(null);
  // M9: Versioning health — surface a banner when version writes silently fail.
  const [versioningFailures, setVersioningFailures] = useState<number>(
    () => getVersioningHealth().consecutiveFailures
  );
  const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInternalUpdateRef = useRef(false);
  const anySaveInProgressRef = useRef(false);
  const wasOfflineRef = useRef(!isOnline);
  const autoRetryingRef = useRef(false);
  const [currentUser, setCurrentUser] = useState<CachedUser | null>(null);
  const [inspectorProfile, setInspectorProfile] = useState<DbRow | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<DbRow | null>(null);
  // signingOut removed — sign-out handled by global AuthenticatedHeader
  const [htmlViewerOpen, setHtmlViewerOpen] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>('');
  const [inspection, setInspection] = useState<DbRow | null>(null);
  const { isInvoiced, toggling: invoiceToggling, toggleInvoiced } = useInvoicedStatus({
    reportId: id,
    reportType: 'inspection',
    enabled: isAdmin && inspection?.status === 'completed',
  });
  const [systems, setSystems] = useState<DbRow[]>([]);
  const [ziplines, setZiplines] = useState<DbRow[]>([]);
  const [equipment, setEquipment] = useState<DbRow[]>([]);

  // Equipment type options per category — pass existing values so custom entries persist in dropdown
  const getExistingTypes = (cat: string) =>
    equipment
      .filter((e) => e.equipment_category === cat && typeof e.equipment_type === 'string' && e.equipment_type.trim())
      .map((e) => e.equipment_type as string);
  const harnessesOpts = useEquipmentTypeOptions("harnesses", getExistingTypes("harnesses"));
  const helmetsOpts = useEquipmentTypeOptions("helmets", getExistingTypes("helmets"));
  const lanyardsOpts = useEquipmentTypeOptions("lanyards", getExistingTypes("lanyards"));
  const connectorsOpts = useEquipmentTypeOptions("connectors", getExistingTypes("connectors"));
  const ropeOpts = useEquipmentTypeOptions("rope", getExistingTypes("rope"));
  const belayOpts = useEquipmentTypeOptions("belay", getExistingTypes("belay"));
  const trolleysOpts = useEquipmentTypeOptions("trolleys", getExistingTypes("trolleys"));
  const otherOpts = useEquipmentTypeOptions("other", getExistingTypes("other"));
  const [modifiedByProfile, setModifiedByProfile] = useState<DbRow | null>(null);
  const [standards, setStandards] = useState<DbRow[]>([
    { id: crypto.randomUUID(), standard_name: "Local Written Operations Procedures", has_documentation: null },
    { id: crypto.randomUUID(), standard_name: "Local Written Emergency Action Plan", has_documentation: null },
    { id: crypto.randomUUID(), standard_name: "Minimum Annual Training", has_documentation: null },
    { id: crypto.randomUUID(), standard_name: "Written Pre-Use Inspection in Use", has_documentation: null },
    { id: crypto.randomUUID(), standard_name: "Inventory Tracking System in Use", has_documentation: null },
    { id: crypto.randomUUID(), standard_name: "Operational Review Every 5 Years", has_documentation: null },
  ]);
  const [summary, setSummary] = useState({
    id: '',
    inspection_id: '',
    repairs_performed: "",
    critical_actions: "",
    future_considerations: "",
    next_inspection_date: null,
  });
  const summaryRef = useRef(summary);
  useEffect(() => { summaryRef.current = summary; }, [summary]);

  // Track whether the user has manually edited next_inspection_date this session.
  // When true, inspection_date changes will NOT overwrite the user's choice.
  const userTouchedNextDateRef = useRef(false);

  // Helper: compute inspection_date + 1 year as a YYYY-MM-DD string (timezone-agnostic).
  const computeNextInspectionDate = (inspectionDate: string | null | undefined): string | null => {
    if (!inspectionDate) return null;
    const parts = inspectionDate.split('-');
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    const nextDate = new Date(year + 1, month, day);
    return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
  };

  // On initial summary load: decide whether the saved next_inspection_date is a deliberate
  // user override (preserve it) or stale legacy data (let auto-track recompute it).
  // - Equal to inspection_date + 1y → not an override (auto-track will keep it in sync).
  // - Strictly after inspection_date but != +1y → deliberate override (e.g. 6mo / 2y cycle).
  // - On or before inspection_date → stale/invalid; clear the override flag so +1y auto-fills.
  const initialNextDateCheckedRef = useRef(false);
  useEffect(() => {
    if (initialNextDateCheckedRef.current) return;
    if (!summary.inspection_id && !summary.id) return;
    initialNextDateCheckedRef.current = true;
    if (summary.next_inspection_date && inspection?.inspection_date) {
      const expected = computeNextInspectionDate(inspection.inspection_date);
      if (
        expected &&
        summary.next_inspection_date !== expected &&
        summary.next_inspection_date > inspection.inspection_date
      ) {
        userTouchedNextDateRef.current = true;
      }
    }
  }, [summary.inspection_id, summary.id, summary.next_inspection_date, inspection?.inspection_date]);

  // Auto-track inspection_date + 1y unless the user has manually overridden the next-date field.
  useEffect(() => {
    if (!inspection?.inspection_date) return;
    if (!summary.inspection_id && !summary.id) return;
    if (userTouchedNextDateRef.current) return;
    const nextDateStr = computeNextInspectionDate(inspection.inspection_date);
    if (!nextDateStr) return;
    if (summary.next_inspection_date === nextDateStr) return;
    setSummary(prev => ({ ...prev, next_inspection_date: nextDateStr }));
  }, [inspection?.inspection_date, summary.inspection_id, summary.id, summary.next_inspection_date]);

  // Called by SummarySection when the user directly interacts with the next-date picker.
  // `cleared` = true when the field was emptied (resume auto-tracking on next inspection_date change).
  const handleNextDateUserEdit = useCallback((cleared: boolean) => {
    userTouchedNextDateRef.current = !cleared;
  }, []);

  // Completion lock derived values (after report state is declared)
  const isCompletionLocked = inspection?.status === 'completed' && !completionLockOverridden;
  // Active-usage timer: only tracks time when user is actively editing
  // DISABLED: Timer fully disabled — set enabled: false to stop all background tracking
  const { elapsedSeconds, isActive: timerActive, isPaused: timerPaused, getElapsedSeconds } = useActiveTimer({
    initialSeconds: inspection?.active_duration_seconds || 0,
    enabled: false, // was: canEdit && !isReadOnly && !isCompletionLocked && !isSuperAdmin
  });

  const effectiveReadOnly = isReadOnly || isCompletionLocked;

  // Required-field completion gate. Saves stay unblocked; only the
  // explicit Complete action checks this list. See
  // src/lib/required-fields.ts and mem://features/required-field-completion-gate.
  const [missingRequiredFields, setMissingRequiredFields] = useState<MissingField[]>([]);
  // Live-clear the persistent toast + pulse the moment the user fills
  // the remaining required fields.
  useEffect(() => {
    if (!missingRequiredFields.length) return;
    const stillMissing = getMissingInspectionFields(inspection);
    if (!stillMissing.length) {
      toast.dismiss(`completion-blocked-${id}`);
      setMissingRequiredFields([]);
    } else if (stillMissing.length !== missingRequiredFields.length) {
      setMissingRequiredFields(stillMissing);
    }
  }, [inspection?.organization, inspection?.location, inspection?.inspection_date, missingRequiredFields.length, id]);


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

  // Track if auto-population has run for this inspection
  const autoPopulatedRef = useRef<string | null>(null);

  // Track which child data types loaded successfully (not from timeout fallback)
  // Prevents destructive auto-save of timeout-sourced empty arrays
  const childDataLoadedRef = useRef<Record<string, boolean>>({
    systems: false,
    ziplines: false,
    equipment: false,
    standards: false,
    summary: false,
  });
  
  // Track for real-time summary regeneration
  const summaryRegenerateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousFailProvisionsRef = useRef<string>('');
  
  // Tab navigation state
  const [currentTab, setCurrentTab] = useState("details");
  const tabOrder = ["details", "equipment", "standards", "summary"];
  
  // Track visited tabs for lazy rendering (performance optimization)
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['details']));
  
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
  // Use a ref for the save function to avoid stale closure -- useCallback([], []) captures
  // the first-render performSave which closes over empty state arrays, causing data loss.
  const performSaveRef = useRef<(silent: boolean) => Promise<void>>();
  const saveBeforeLeaveRef = useRef<(() => Promise<void>) | null>(null);
  const handleSaveAndLeave = useCallback(async () => {
    // Cancel pending debounce
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
    try {
      await performSaveRef.current?.(true);
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      console.log('[InspectionForm] Save-before-leave completed');
    } catch (e) {
      console.warn('[InspectionForm] Save-before-leave failed:', e);
    }
  }, []);
  saveBeforeLeaveRef.current = handleSaveAndLeave;

  // Unsaved changes protection
  const { isBlocked, confirmNavigation, cancelNavigation, saveAndLeave, bypassAndProceed } = useUnsavedChanges({
    hasUnsavedChanges: hasUnsavedChanges && (inspection?.status !== 'completed' || completionLockOverridden),
    alwaysBlock: true,
    message: "You have unsaved changes to this inspection. Are you sure you want to leave?",
    onSaveAndLeave: async () => { await saveBeforeLeaveRef.current?.(); },
  });

  // Emergency save on page hide/refresh (Vector 1: zero-data-loss)
  useEmergencySave({
    hasUnsavedChanges,
    saving,
    saveDebounceTimerRef,
    performSaveRef,
    formName: 'InspectionForm',
    onEmergencySnapshot: () => {
      if (inspection && id) {
        // Include photo metadata (IDs, captions) but NOT blobs for localStorage budget
        getOfflinePhotos(id).then(photos => {
          const photoMeta = photos.map((p) => ({
            id: p.id,
            caption: p.caption,
            photo_section: p.section,
            display_order: p.display_order,
            uploaded: Boolean(p.uploaded),
          }));
          saveReportSnapshot('inspection', id, inspection, {
            systems, ziplines, equipment, standards, summary: [summary],
          }, !!inspection.synced_at, photoMeta);
        }).catch(() => {
          // Fallback: save without photo metadata
          saveReportSnapshot('inspection', id, inspection, {
            systems, ziplines, equipment, standards, summary: [summary],
          }, !!inspection.synced_at);
        });
      }
    },
  });

  const safeGoBack = useCallback(() => {
    goBack(navigate);
  }, [navigate]);

  // Auto-retry on network reconnect is now handled by useAutoSync hook
  // This component only needs to handle local save retries

  const saveRef = useRef<(() => void) | null>(null);
  useSaveShortcut(() => saveRef.current?.(), hasUnsavedChanges && !saving);

  // handleSignOut removed — sign-out handled by global AuthenticatedHeader
  // Emergency save via useEmergencySave handles data preservation on navigation

  const generateSummaryFromInspection = () => {
    const criticalActions: string[] = [];
    const repairsPerformed: string[] = [];
    const futureConsiderations: string[] = [];

    // Process Equipment
    equipment.forEach(item => {
      if (!item.equipment_type) return;
      
      const details = [
        item.equipment_type,
        item.production_year ? `Year: ${item.production_year}` : null,
        item.quantity ? `Qty: ${item.quantity}` : null
      ].filter(Boolean).join(', ');
      
      const entry = `○   ${item.equipment_category || 'Equipment'}- ${details}${hasTextContent(item.comments) ? ': ' + item.comments : ''}`;
      
      if (item.result === 'fail') {
        criticalActions.push(entry);
      } else if (item.result === 'pass w/provisions') {
        futureConsiderations.push(entry);
      } else if (item.result === 'pass' && hasTextContent(item.comments)) {
        repairsPerformed.push(entry);
      }
    });

    // Process Operating Systems
    systems.forEach(system => {
      if (!system.system_name && !system.name) return;
      
      const label = system.system_name
        ? `${system.system_name}${system.name ? ` (${system.name})` : ''}`
        : system.name;
      const entry = `○   Operating System- ${label}${hasTextContent(system.comments) ? ': ' + system.comments : ''}`;
      
      if (system.result === 'fail') {
        criticalActions.push(entry);
      } else if (system.result === 'pass w/provisions') {
        futureConsiderations.push(entry);
      } else if (system.result === 'pass' && hasTextContent(system.comments)) {
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
      const hasPassWithComments = !hasFail && !hasProvisions && 
                                  zipline.result === 'pass' && hasTextContent(zipline.comments);
      
      // Create entry with component issues or just overall result
      const issueText = issues.length > 0 ? ` [${issues.join(', ')}]` : '';
      const entry = `○   Zipline- ${zipline.zipline_name}${issueText}${hasTextContent(zipline.comments) ? ': ' + zipline.comments : ''}`;
      
      if (hasFail) {
        criticalActions.push(entry);
      } else if (hasProvisions) {
        futureConsiderations.push(entry);
      } else if (hasPassWithComments) {
        repairsPerformed.push(entry);
      }
    });

    return {
      criticalActions: criticalActions.length > 0 
        ? criticalActions.join('\n')
        : '',
      repairsPerformed: repairsPerformed.length > 0 
        ? repairsPerformed.join('\n')
        : '',
      futureConsiderations: futureConsiderations.length > 0
        ? futureConsiderations.join('\n')
        : ''
    };
  };

  useEffect(() => {
    loadInspection();
    
    // Fetch current user - works offline with cache + offline fallback
    const fetchUser = async () => {
      let user = await getUserWithCache();
      if (!user) {
        const offlineId = getOfflineUserId();
        if (offlineId) user = { id: offlineId };
      }
      setCurrentUser(user);
    };
    
    fetchUser();
    
    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          setCurrentUser(session.user);
        } else if (navigator.onLine) {
          // Only clear user on explicit sign-out while online
          // Prevents losing currentUser when offline token refresh fails
          setCurrentUser(null);
        }
      }
    );
    
    return () => subscription.unsubscribe();
  }, [id]);

  // F4: Subscribe to Realtime changes for THIS inspection so a remote edit on
  // another device re-loads the form. Suppressed while the user has unsaved
  // local changes (avoid clobbering in-progress edits).
  // H5: read `hasUnsavedChanges` and the latest `updated_at` via refs so the
  // channel doesn't churn on every keystroke.
  const lastLoadedUpdatedAtRef = useRef<string | null>(null);
  useEffect(() => {
    const ua = inspection?.updated_at;
    lastLoadedUpdatedAtRef.current = typeof ua === 'string' ? ua : null;
  }, [inspection]);
  // Audit H2: form-scoped Realtime now goes through the shared helper which
  // adds CHANNEL_ERROR/TIMED_OUT/CLOSED fallback refetch + app-resume
  // resubscribe (online/visibilitychange/iOS pageshow+focus). Without these,
  // an iPad form silently disconnects when the websocket dies during tab
  // suspension and the user misses cross-device updates for the rest of the
  // editing session.
  useFormRecordRealtime({
    enabled: !!id && !id.startsWith('temp-'),
    channelName: id ? `inspection-form-${id}` : '',
    table: 'inspections',
    recordId: id || '',
    logTag: 'InspectionForm',
    onUpdate: (payload: RealtimePostgresChangesPayload<DbRow>) => {
      const newRow = payload.new as Partial<DbRow> | null;
      const remoteUpdated = newRow && typeof newRow.updated_at === 'string' ? newRow.updated_at : null;
      if (!remoteUpdated) return;
      const localUpdated = lastLoadedUpdatedAtRef.current;
      const remoteMs = new Date(remoteUpdated).getTime();
      const localMs = localUpdated ? new Date(localUpdated).getTime() : 0;
      if (remoteMs - localMs <= 5000) return; // already in sync (within tolerance)
      if (hasUnsavedRef.current) {
        if (import.meta.env.DEV) console.log('[InspectionForm] Skipping remote refresh — unsaved local changes');
        return;
      }
      // Defence-in-depth: even with no `hasUnsavedRef`, suppress refreshes
      // for ~15 s after our own atomic-sync writes this record (S6 self-write
      // registry). The form's debounced save can flush IDB + Supabase a few
      // seconds before the user's React state stabilises; without this guard
      // the round-trip Realtime UPDATE from our own write can still bounce a
      // stale server payload back into `setInspection`.
      if (id && isRecentSelfWrite(id)) {
        if (import.meta.env.DEV) console.log('[InspectionForm] Skipping remote refresh — recent self-write');
        return;
      }
      if (import.meta.env.DEV) console.log('[InspectionForm] Remote update detected — reloading');
      loadInspection();
    },
    onResumeOrDegraded: () => {
      // Same hasUnsaved + self-write guards — never clobber in-flight edits.
      if (hasUnsavedRef.current) return;
      if (id && isRecentSelfWrite(id)) return;
      loadInspection();
    },
  });

  // H3: Register this record as actively edited so the global Realtime IDB
  // writer in useAutoSync doesn't silently overwrite our IDB row while we
  // hold unsaved React state. Subscribe to skipped-overwrite notifications
  // so we can offer the user a "Reload" toast on cross-device updates.
  useEffect(() => {
    if (!id || id.startsWith('temp-')) return;
    registerActiveFormRecord('inspections', id);
    const unsub = onPendingRemoteUpdate((p) => {
      if (p.table !== 'inspections' || p.recordId !== id) return;
      // Suppress reload prompts for our own atomic-sync round-trips.
      if (isRecentSelfWrite(id)) {
        if (import.meta.env.DEV) console.log('[InspectionForm] Suppressing pending-update toast — recent self-write');
        return;
      }
      // Silent reconcile: loadInspection flushes any pending debounced save first,
      // then merges server data per-field via mergeRecordFields so locally-newer
      // edits survive. No user prompt needed.
      if (import.meta.env.DEV) console.log('[InspectionForm] Pending remote update — silent reconcile');
      loadInspection();
    });
    return () => {
      unsub();
      unregisterActiveFormRecord(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Clear save error when background sync completes successfully
  useEffect(() => {
    // M9: Subscribe to versioning health so the banner reflects live state.
    const unsubHealth = subscribeVersioningHealth((h) => {
      setVersioningFailures(h.consecutiveFailures);
    });

    const unsubscribe = onSyncComplete(() => {
      // Clear pending_sync and any sync-related errors
      setSaveError(prev => {
        if (!prev) return null;
        // Clear pending_sync state and any sync-related errors
        if (prev === 'pending_sync') {
          if (import.meta.env.DEV) {
            console.log('[InspectionForm] Cleared pending_sync after successful background sync');
          }
          return null;
        }
        // Check multiple patterns that indicate sync errors
        const msg = typeof prev === 'string' ? prev : prev.message;
        const isSyncError = /sync|failed|offline|queued|network|locally/i.test(msg);
        if (isSyncError) {
          if (import.meta.env.DEV) {
            console.log('[InspectionForm] Cleared sync error after successful background sync');
          }
          return null;
        }
        return prev;
      });
    });
    
    return () => {
      unsubscribe();
      unsubHealth();
    };
  }, []); // Empty dependency array to avoid stale closures

  // Fetch inspector profile (the report owner, not current user)
  useEffect(() => {
    const fetchInspectorProfile = async () => {
      if (!inspectorId || !navigator.onLine) return;
      
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", inspectorId)
        .maybeSingle();
      
      setInspectorProfile(profile);
    };
    
    fetchInspectorProfile();
  }, [inspectorId]);

  // Fetch current logged-in user's profile (for avatar dropdown)
  useEffect(() => {
    const fetchCurrentUserProfile = async () => {
      if (!currentUser?.id || !navigator.onLine) return;
      
      const { data: profile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", currentUser.id)
        .maybeSingle();
      
      setCurrentUserProfile(profile);
    };
    
    fetchCurrentUserProfile();
  }, [currentUser?.id]);

  // Fetch modified-by profile (who last modified the report, if different from owner)
  useEffect(() => {
    const fetchModifiedByProfile = async () => {
      if (!inspection?.last_modified_by || !navigator.onLine) return;
      // Only fetch if modifier is different from the owner
      if (inspection.last_modified_by === inspection.inspector_id) {
        setModifiedByProfile(null);
        return;
      }
      
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", inspection.last_modified_by)
        .maybeSingle();
      
      setModifiedByProfile(profile);
    };
    
    fetchModifiedByProfile();
  }, [inspection?.last_modified_by, inspection?.inspector_id]);

  // Auto-populate ACCT# from inspector profile (report owner)
  useEffect(() => {
    if (inspection && inspectorProfile && !inspection.acct_number && inspectorProfile.acct_number && isOwner) {
      isInternalUpdateRef.current = true;
      handleHeaderUpdate('acct_number', inspectorProfile.acct_number);
    }
  }, [inspectorProfile, inspection?.id]);

  // Track changes to inspection data and trigger debounced auto-save
  // Use ref to avoid extra re-render from setHasUnsavedChanges on every keystroke
  const hasUnsavedRef = useRef(false);
  useEffect(() => {
    if (!loading && !isInternalUpdateRef.current && isOwner) {
      if (!hasUnsavedRef.current) {
        hasUnsavedRef.current = true;
        setHasUnsavedChanges(true);
      }
      
      // Clear existing debounce timer using ref
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
      
      // Set new debounce timer for 1.5 seconds (optimized for near-instant feel).
      // Do NOT clear `hasUnsavedRef` here — that has to wait until the save
      // actually completes, otherwise the form-scoped Realtime UPDATE handler
      // can fire during the in-flight save and overwrite the user's edits with
      // stale server data. Clearing now lives next to every `setHasUnsavedChanges(false)`.
      saveDebounceTimerRef.current = setTimeout(() => {
        autoSaveProgress();
      }, 1500);
    }
  }, [systems, ziplines, equipment, standards, summary, isOwner]);

  // Reset internal update flag AFTER the auto-save watcher above has run
  // React runs effects in declaration order, so this always executes after the watcher skips
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
    }
  }, [systems, ziplines, equipment, standards, summary]);

  // Auto-save interval (every 10 seconds as backup)
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      if (hasUnsavedChanges && !saving && !autoSaving && isOwner) {
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
    if (!inspection || loading || !isOwner) return;
    
    // Only auto-populate once per inspection
    if (autoPopulatedRef.current === inspection.id) return;
    
    const autoGenerated = generateSummaryFromInspection();
    
    // Only populate if fields are empty
    if (autoGenerated.criticalActions || autoGenerated.repairsPerformed || autoGenerated.futureConsiderations) {
      isInternalUpdateRef.current = true;
      setSummary(prev => {
        const newSummary = { ...prev };
        
        // Only set if field is empty (don't merge/append)
        if (!prev.critical_actions?.trim() && autoGenerated.criticalActions) {
          newSummary.critical_actions = convertCircleBulletsToHtml(autoGenerated.criticalActions);
        }
        
        if (!prev.repairs_performed?.trim() && autoGenerated.repairsPerformed) {
          newSummary.repairs_performed = convertCircleBulletsToHtml(autoGenerated.repairsPerformed);
        }
        
        if (!prev.future_considerations?.trim() && autoGenerated.futureConsiderations) {
          newSummary.future_considerations = convertCircleBulletsToHtml(autoGenerated.futureConsiderations);
        }
        
        return newSummary;
      });
      
      autoPopulatedRef.current = inspection.id;
    }
  }, [inspection?.id, loading]);

  // Manual regenerate function for summary section
  const handleRegenerateSummary = (showToast = true) => {
    const autoGenerated = generateSummaryFromInspection();
    
    isInternalUpdateRef.current = true;
    setSummary(prev => {
      const newSummary = {
        ...prev,
        critical_actions: convertCircleBulletsToHtml(autoGenerated.criticalActions),
        repairs_performed: convertCircleBulletsToHtml(autoGenerated.repairsPerformed),
        future_considerations: convertCircleBulletsToHtml(autoGenerated.futureConsiderations),
      };
      
      if (showToast) {
        toast.success("Summary Updated", {
          description: "Summary regenerated from inspection data",
        });
      }
      
      return newSummary;
    });
  };

  // Memoize the fail/provisions signature to avoid recomputing on every render
  const failProvisionsSignature = useMemo(() => {
    const items: string[] = [];
    
    // Equipment items
    equipment.forEach(item => {
      const result = item.result?.toLowerCase();
      if (result === 'fail' || result === 'pass w/provisions' || (result === 'pass' && item.comments?.trim())) {
        items.push(`eq:${item.id}:${result}:${item.comments || ''}`);
      }
    });
    
    // Operating systems
    systems.forEach(item => {
      const result = item.result?.toLowerCase();
      if (result === 'fail' || result === 'pass w/provisions' || (result === 'pass' && item.comments?.trim())) {
        items.push(`sys:${item.id}:${result}:${item.comments || ''}`);
      }
    });
    
    // Ziplines (including component results)
    ziplines.forEach(item => {
      const results = [
        item.result?.toLowerCase(),
        item.cable_result?.toLowerCase(),
        item.braking_result?.toLowerCase(),
        item.ead_result?.toLowerCase()
      ];
      
      const hasFail = results.some(r => r === 'fail');
      const hasProvisions = results.some(r => r === 'pass w/provisions');
      const hasPassWithComments = !hasFail && !hasProvisions && item.result?.toLowerCase() === 'pass' && item.comments?.trim();
      
      if (hasFail || hasProvisions || hasPassWithComments) {
        items.push(`zip:${item.id}:${item.result}:${item.cable_result}:${item.braking_result}:${item.ead_result}:${item.comments || ''}`);
      }
    });
    
    return items.sort().join('|');
  }, [equipment, systems, ziplines]);

  // Real-time summary auto-regeneration when fail/provisions items change
  useEffect(() => {
    // Skip during initial load
    if (loading || !inspection?.id || !isOwner) return;
    
    // Only regenerate if signature changed and there are items
    if (failProvisionsSignature !== previousFailProvisionsRef.current) {
      // Clear any pending timer
      if (summaryRegenerateTimerRef.current) {
        clearTimeout(summaryRegenerateTimerRef.current);
      }
      
      // Debounce the regeneration by 800ms
      summaryRegenerateTimerRef.current = setTimeout(() => {
        isInternalUpdateRef.current = true;
        handleRegenerateSummary(false); // Silent regeneration
        
        // Only show toast on desktop; on mobile, route to notification center
        if (isMobile()) {
          addSaveNotification("Summary auto-updated from inspection items");
        } else {
          toast.info("Summary Auto-Updated", {
            description: "Critical actions and repairs updated from inspection items",
          });
        }
      }, 800);
    }
    
    previousFailProvisionsRef.current = failProvisionsSignature;
    
    // Cleanup timer on unmount
    return () => {
      if (summaryRegenerateTimerRef.current) {
        clearTimeout(summaryRegenerateTimerRef.current);
      }
    };
  }, [failProvisionsSignature, loading, inspection?.id, isOwner]);

  // Original manual regenerate handler wrapper (for button click)
  const handleManualRegenerateSummary = () => {
    handleRegenerateSummary(true);
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
      // PR-A: route every header-field write through `applyTrackedFieldWrite`
      // so tracked fields populate `field_timestamps`. Without this the
      // cross-device merger (atomic-sync-manager S16/H4 → mergeRecordFields)
      // falls back to row-level last-writer-wins for every field.
      const updatedInspection = applyTrackedFieldWrite(
        inspection,
        'inspection',
        field,
        value,
      );

      // CRITICAL: apply the React state update SYNCHRONOUSLY before any await.
      // Previously the save-mutex wait gated this update, causing controlled
      // inputs (e.g. onsite_contact via GlobalAutocomplete) to appear to "lose"
      // the just-typed value for up to 3 s while a save was in flight — the
      // input exited edit mode and re-rendered the stale prop.
      //
      // Sync-mirror the unsaved flag onto the ref BEFORE setInspection so the
      // form-scoped Realtime UPDATE handler (`useFormRecordRealtime.onUpdate`)
      // sees the in-flight edit even if a remote update lands inside the
      // 500 ms debounce window.
      hasUnsavedRef.current = true;
      setInspection(updatedInspection);
      setHasUnsavedChanges(true);

      // MUTEX: wait for any in-flight save to complete before scheduling the
      // next debounced save — but DO NOT block the UI state update above.
      if (anySaveInProgressRef.current) {
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Header update waiting for in-flight save before scheduling next save');
        }
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (!anySaveInProgressRef.current) {
              clearInterval(check);
              resolve();
            }
          }, 100);
          setTimeout(() => { clearInterval(check); resolve(); }, 3000);
        });
      }

      // Trigger the debounced auto-save instead of bypassing it
      // This ensures header updates go through the same save path as other changes
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
      saveDebounceTimerRef.current = setTimeout(() => {
        performSaveRef.current?.(true);
      }, 500); // Short debounce for header fields
    } catch (error) {
      console.error("Error updating header field:", error);
    }
  };

  const loadInspection = async () => {
    // Safety timeout - force loading to complete after 15 seconds max
    const LOAD_TIMEOUT = 15000;
    let loadCompleted = false;
    
    const safetyTimeout = setTimeout(() => {
      if (!loadCompleted) {
        console.error('[InspectionForm] Safety timeout triggered - forcing loading completion');
        setLoading(false);
        toast.error("Loading timed out", {
          description: "The inspection is taking too long to load. Please try again.",
        });
      }
    }, LOAD_TIMEOUT);

    try {
      // Race-fix: flush any pending debounced save into IDB before reading,
      // so `getOfflineInspection` returns the row containing the user's
      // most recent edits instead of a pre-edit snapshot.
      if (saveDebounceTimerRef.current || hasUnsavedRef.current) {
        try {
          if (saveDebounceTimerRef.current) {
            clearTimeout(saveDebounceTimerRef.current);
            saveDebounceTimerRef.current = null;
          }
          await performSaveRef.current?.(true);
        } catch (e) {
          console.warn('[InspectionForm] Pre-load flush failed (continuing):', e);
        }
      }

      // Helper to wrap offline operations with a timeout to prevent hanging
      const withOfflineTimeout = async <T,>(
        operation: Promise<T>,
        fallback: T,
        timeoutMs: number = 3000
      ): Promise<T> => {
        return Promise.race([
          operation,
          new Promise<T>((resolve) => setTimeout(() => {
            console.warn('[InspectionForm] Offline operation timed out, proceeding with fallback');
            resolve(fallback);
          }, timeoutMs))
        ]);
      };

      // Helper to wrap Supabase queries with timeout protection
      // Note: We use Promise.race with the query's .then() to ensure proper Promise conversion
      const withQueryTimeout = async <T,>(
        query: PromiseLike<{ data: T | null; error: PostgrestError | Error | null }>,
        timeoutMs: number = 8000
      ): Promise<{ data: T | null; error: PostgrestError | Error | null }> => {
        const timeoutPromise = new Promise<{ data: T | null; error: PostgrestError | Error | null }>((resolve) =>
          setTimeout(() => {
            console.warn('[InspectionForm] Supabase query timed out after', timeoutMs, 'ms');
            resolve({ data: null, error: new Error('Query timeout') });
          }, timeoutMs)
        );
        return Promise.race([Promise.resolve(query), timeoutPromise]);
      };

      // Load inspection header from offline first (with timeout protection)
      let offlineData = await withOfflineTimeout(
        getOfflineInspection(id!),
        null,
        5000  // 5s timeout (increased from 3s for mobile reliability)
      );
      
      // Temp-ID records only exist locally -- retry without timeout if needed
      if (!offlineData && id!.startsWith('temp-')) {
        try {
          console.log('[InspectionForm] Retrying temp-ID lookup without timeout:', id);
          offlineData = await getOfflineInspection(id!);
        } catch (e) {
          console.warn('[InspectionForm] Retry for temp-ID also failed:', e);
        }
      }
      
      if (offlineData) {
        setInspection(offlineData);
        setInspectorId(offlineData.inspector_id);
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Loaded inspection from offline storage');
        }
      } else if (!id!.startsWith('temp-')) {
        // Finding 6: Auto-restore from localStorage backup if IndexedDB was evicted
        const backup = getReportSnapshot('inspection', id!);
        if (backup) {
          console.log('[InspectionForm] IndexedDB empty but localStorage backup found — auto-restoring');
          const restoredParent = backup.parent;
          // Restore parent to IndexedDB (fire-and-forget)
          saveInspectionOffline(restoredParent).catch(() => {});
          setInspection(restoredParent);
          setInspectorId(restoredParent.inspector_id);
          
          // Restore children to IndexedDB
          if (backup.children) {
            for (const [childType, childData] of Object.entries(backup.children)) {
              if (Array.isArray(childData) && childData.length > 0) {
                saveRelatedDataOffline(childType as RelatedDataKey, id!, childData).catch(() => {});
                // Mark restored child types as loaded
                if (childType in childDataLoadedRef.current) {
                  childDataLoadedRef.current[childType] = true;
                }
              }
            }
          }
          
          toast.info("Restored from local backup", {
            description: backup.photoMetadata?.some(p => !p.uploaded)
              ? "Some photos may need to be re-captured."
              : "Your data has been recovered.",
          });
        }
      }

      // Load all related data from offline storage first (with timeout protection)
      const [
        offlineSystems,
        offlineZiplines,
        offlineEquipment,
        offlineStandards,
        offlineSummary
      ] = await withOfflineTimeout(
        Promise.all([
          getRelatedDataOffline('systems', id!),
          getRelatedDataOffline('ziplines', id!),
          getRelatedDataOffline('equipment', id!),
          getRelatedDataOffline('standards', id!),
          getRelatedDataOffline('summary', id!)
        ]),
        [[], [], [], [], []],
        3000
      );

      // Mark as internal update to prevent change tracker from firing
      isInternalUpdateRef.current = true;

      // Track successful loads vs timeout fallbacks
      // If the entire Promise.all timed out, ALL arrays are empty fallbacks
      // If individual arrays have data, they came from real reads
      if (offlineSystems.length > 0) {
        childDataLoadedRef.current.systems = true;
        const normalizedSystems = offlineSystems.map(item => ({
          ...item,
          result: normalizeResultValue(item.result)
        }));
        setSystems(normalizedSystems);
      }
      if (offlineZiplines.length > 0) {
        childDataLoadedRef.current.ziplines = true;
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
        childDataLoadedRef.current.equipment = true;
        const normalizedEquipment = offlineEquipment.map(item => ({
          ...item,
          result: normalizeResultValue(item.result)
        }));
        setEquipment(normalizedEquipment);
      }
      if (offlineStandards.length > 0) {
        childDataLoadedRef.current.standards = true;
        setStandards(prev => mergeStandardsPreserveLocal(offlineStandards, prev));
      }
      if (offlineSummary.length > 0) {
        childDataLoadedRef.current.summary = true;
        setSummary(offlineSummary[0] as typeof summary);
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
      // Skip server queries for temp-ID inspections (they only exist locally)
      if (isOnline && !id!.startsWith('temp-')) {
        // Update last_opened_at and started_at (if null) only for owners (write operation)
        if (isOwner) {
          const now = new Date().toISOString();
          // Set started_at on first open to enable accurate completion time tracking
          const updateFields: Record<string, string> = { last_opened_at: now };
          const currentInspection = offlineData || inspection;
          if (currentInspection && !currentInspection.started_at) {
            updateFields.started_at = now;
          }
          await withQueryTimeout(
            supabase
              .from("inspections")
              .update(updateFields as never)
              .eq("id", id),
            5000
          ).catch(e => console.warn('[InspectionForm] last_opened_at/started_at update failed:', e));
        }

        // PERFORMANCE: Parallel data loading - all queries run simultaneously
        const [
          inspectionResult,
          systemsResult,
          ziplinesResult,
          equipmentResult,
          standardsResult,
          summaryResult
        ] = await Promise.all([
          withQueryTimeout(
            supabase
              .from("inspections")
              .select("*, inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name, avatar_url)")
              .eq("id", id)
              .maybeSingle(),
            8000
          ),
          withQueryTimeout(
            supabase
              .from("inspection_systems")
              .select("*")
              .eq("inspection_id", id)
              .order("display_order"),
            8000
          ),
          withQueryTimeout(
            supabase
              .from("inspection_ziplines")
              .select("*")
              .eq("inspection_id", id)
              .order("display_order"),
            8000
          ),
          withQueryTimeout(
            supabase
              .from("inspection_equipment")
              .select("*")
              .eq("inspection_id", id)
              .order("display_order"),
            8000
          ),
          withQueryTimeout(
            supabase
              .from("inspection_standards")
              .select("*")
              .eq("inspection_id", id),
            8000
          ),
          withQueryTimeout(
            supabase
              .from("inspection_summary")
              .select("*")
              .eq("inspection_id", id)
              .maybeSingle(),
            8000
          )
        ]);

        const { data, error } = inspectionResult;
        if (error && error.message !== 'Query timeout') throw error;
        
        // Handle inspection not found - redirect to dashboard.
        // Only act when the server response is conclusive (no timeout, no error)
        // AND local storage isn't degraded — otherwise a transient IDB/network
        // hiccup would falsely alarm the user and bounce them off the form.
        if (!data && !offlineData) {
          const serverInconclusive = !!error || !navigator.onLine;
          const { getCircuitBreakerStatus } = await import('@/lib/offline-storage');
          const idbDegraded = getCircuitBreakerStatus().open;
          if (serverInconclusive || idbDegraded) {
            console.warn('[InspectionForm] Skipping not-found redirect — inconclusive lookup; staying mounted', { serverInconclusive, idbDegraded, id });
            return; // keep form mounted; next refetch/online recovery will reconcile
          }
          console.warn('[InspectionForm] Inspection not found:', id);
          toast.error("Inspection not found", {
            description: "This inspection may have been deleted or doesn't exist.",
          });
          navigate('/dashboard');
          return;
        }
        
        // Determine if local data should take priority over server data
        // This prevents data loss when opening a report with unsynced local changes
        const localIsNewer = isLocalDataNewer(offlineData, data);

        if (localIsNewer) {
          // LOCAL DATA IS NEWER — preserve local state, don't overwrite with stale server data
          console.log('[InspectionForm] Local data is newer than server — preserving local state', {
            localUpdatedAt: offlineData.updated_at,
            serverUpdatedAt: data?.updated_at,
            localSyncedAt: offlineData.synced_at,
          });
          
          // Only update inspection header metadata from server (status, inspector info)
          if (data) {
            setInspection(prev => ({
              ...(prev ?? {} as DbRow),
              status: data.status,
              inspector: (data as DbRow).inspector,
            }));
            setInspectorId(data.inspector_id);
            // Do NOT cache server inspection — local version is the source of truth
          }
          
          // Skip all related data processing — local state (loaded earlier from IndexedDB) is preserved
          // Do NOT call saveRelatedDataOffline with server data — that would overwrite local IndexedDB
          
          if (import.meta.env.DEV) {
            console.log('[InspectionForm] Skipped server data overwrite — local data preserved');
          }
        } else {
          // SERVER DATA IS CURRENT — apply it (existing behavior)
          if (data) {
            // Race-fix: per-field merge so any locally-newer tracked-field
            // edit (e.g. onsite_contact typed seconds ago) survives a refetch
            // even when the server payload doesn't yet reflect that edit.
            setInspection(prev => {
              if (!prev) return data;
              return mergeRecordFields(
                prev as DbRow & { field_timestamps?: Record<string, string> | null },
                data as DbRow & { field_timestamps?: Record<string, string> | null },
                TRACKED_FIELDS.inspection,
              ) as DbRow;
            });
            setInspectorId(data.inspector_id);
            // Non-blocking cache update - don't await to prevent loading freeze
            saveInspectionOffline({ ...data, synced_at: data.synced_at || new Date().toISOString() }).catch(e => 
              console.warn('[InspectionForm] Non-critical: failed to cache inspection', e)
            );
            
            if (import.meta.env.DEV) {
              console.log('[InspectionForm] Updated inspection from Supabase');
            }
          }

          // Process all fetched related data
          // Vector 2: Non-regression guard — don't overwrite local data with empty server arrays
          const { data: systemsData } = systemsResult;
          // Mark as internal update to prevent change tracker from firing
          isInternalUpdateRef.current = true;
          // Mark all child types as loaded when server data is applied
          // (server is the source of truth in this branch)
          childDataLoadedRef.current.systems = true;
          childDataLoadedRef.current.ziplines = true;
          childDataLoadedRef.current.equipment = true;
          childDataLoadedRef.current.standards = true;
          childDataLoadedRef.current.summary = true;
          if (systemsData && systemsData.length > 0) {
            const normalizedSystems = systemsData.map(item => ({
              ...item,
              result: normalizeResultValue(item.result)
            }));
            setSystems(normalizedSystems);
            saveRelatedDataOffline('systems', id!, normalizedSystems).catch(e =>
              console.warn('[InspectionForm] Non-critical: failed to cache systems', e)
            );
          } else if (offlineSystems.length > 0) {
            console.warn('[InspectionForm] Server returned empty systems but local has data -- preserving local');
            const normalizedSystems = offlineSystems.map(item => ({
              ...item,
              result: normalizeResultValue(item.result)
            }));
            setSystems(normalizedSystems);
          }

          const { data: ziplinesData } = ziplinesResult;
          if (ziplinesData && ziplinesData.length > 0) {
            const normalizedZiplines = ziplinesData.map(item => ({
              ...item,
              result: normalizeResultValue(item.result),
              cable_result: normalizeResultValue(item.cable_result),
              braking_result: normalizeResultValue(item.braking_result),
              ead_result: normalizeResultValue(item.ead_result)
            }));
            setZiplines(normalizedZiplines);
            saveRelatedDataOffline('ziplines', id!, normalizedZiplines).catch(e =>
              console.warn('[InspectionForm] Non-critical: failed to cache ziplines', e)
            );
          } else if (offlineZiplines.length > 0) {
            console.warn('[InspectionForm] Server returned empty ziplines but local has data -- preserving local');
            const normalizedZiplines = offlineZiplines.map(item => ({
              ...item,
              result: normalizeResultValue(item.result),
              cable_result: normalizeResultValue(item.cable_result),
              braking_result: normalizeResultValue(item.braking_result),
              ead_result: normalizeResultValue(item.ead_result)
            }));
            setZiplines(normalizedZiplines);
          }

          const { data: equipmentData } = equipmentResult;
          if (equipmentData && equipmentData.length > 0) {
            const normalizedEquipment = equipmentData.map(item => ({
              ...item,
              result: normalizeResultValue(item.result)
            }));
            setEquipment(normalizedEquipment);
            saveRelatedDataOffline('equipment', id!, normalizedEquipment).catch(e =>
              console.warn('[InspectionForm] Non-critical: failed to cache equipment', e)
            );
          } else if (offlineEquipment.length > 0) {
            console.warn('[InspectionForm] Server returned empty equipment but local has data -- preserving local');
            const normalizedEquipment = offlineEquipment.map(item => ({
              ...item,
              result: normalizeResultValue(item.result)
            }));
            setEquipment(normalizedEquipment);
          }

          const { data: standardsData } = standardsResult;
          if (standardsData && standardsData.length > 0) {
            setStandards(prev => mergeStandardsPreserveLocal(standardsData, prev));
            saveRelatedDataOffline('standards', id!, standardsData).catch(e =>
              console.warn('[InspectionForm] Non-critical: failed to cache standards', e)
            );
          } else if (offlineStandards.length > 0) {
            console.warn('[InspectionForm] Server returned empty standards but local has data -- preserving local');
            setStandards(prev => mergeStandardsPreserveLocal(offlineStandards, prev));
          }

          const { data: summaryData } = summaryResult;
          if (summaryData) {
            setSummary(summaryData as typeof summary);
            saveRelatedDataOffline('summary', id!, [summaryData]).catch(e =>
              console.warn('[InspectionForm] Non-critical: failed to cache summary', e)
            );
          } else if (offlineSummary.length > 0) {
            console.warn('[InspectionForm] Server returned empty summary but local has data -- preserving local');
            setSummary(offlineSummary[0] as typeof summary);
          }

          if (import.meta.env.DEV) {
            console.log('[InspectionForm] Synced and cached all data from Supabase (parallel)');
          }
        }
      } else if (!offlineData) {
        // Offline and no cached data
        toast.error("Inspection not available offline", {
          description: "Please connect to the internet to load this inspection.",
        });
        navigate('/dashboard');
        return;
      }
    } catch (error) {
      console.error("Error loading inspection:", error);

      // LockManager timeout: concurrency issue, not a real failure.
      // If we already have inspection data loaded (from offline cache or partial server fetch),
      // continue with what we have instead of crashing back to dashboard.
      const errorMsg = errorMessage(error, '');
      const isLockTimeout = errorMsg.includes('LockManager') || (errorMsg.includes('lock') && errorMsg.includes('timed out'));
      
      if (isLockTimeout && inspection.organization) {
        console.warn('[InspectionForm] LockManager timeout — continuing with cached data');
        toast.warning("Loading with cached data", {
          description: "Some data may be slightly out of date. It will refresh automatically.",
        });
      } else {
        toast.error("Failed to load inspection", {
          description: errorMessage(error, "An error occurred while loading the inspection."),
        });
        navigate('/dashboard');
      }
    } finally {
      loadCompleted = true;
      clearTimeout(safetyTimeout);
      setLastSaved(new Date());
      setLoading(false);
    }
  };

  // Listen for JSON import events — reload form state from IndexedDB to prevent
  // stale React state from overwriting imported data on next save
  useEffect(() => {
    const handleReportImported = async (event: Event) => {
      const { reportType, reportId } = (event as CustomEvent).detail;
      if (reportType !== 'inspection' || reportId !== id) return;

      console.log('[InspectionForm] Detected JSON import — reloading state from IndexedDB');
      try {
        const offlineData = await getOfflineInspection(id!);
        const [offSystems, offZiplines, offEquipment, offStandards, offSummary] = await Promise.all([
          getRelatedDataOffline('systems', id!),
          getRelatedDataOffline('ziplines', id!),
          getRelatedDataOffline('equipment', id!),
          getRelatedDataOffline('standards', id!),
          getRelatedDataOffline('summary', id!),
        ]);

        isInternalUpdateRef.current = true;
        if (offlineData) {
          setInspection(offlineData);
          setInspectorId(offlineData.inspector_id);
        }
        setSystems(offSystems); childDataLoadedRef.current.systems = true;
        setZiplines(offZiplines); childDataLoadedRef.current.ziplines = true;
        setEquipment(offEquipment); childDataLoadedRef.current.equipment = true;
        setStandards(prev => mergeStandardsPreserveLocal(offStandards, prev)); childDataLoadedRef.current.standards = true;
        if (offSummary.length > 0) { setSummary(offSummary[0] as typeof summary); }
        childDataLoadedRef.current.summary = true;

        // Refresh photo galleries to pick up any imported photo metadata
        setPhotoRefreshKey(prev => prev + 1);

        hasUnsavedRef.current = true;
        setHasUnsavedChanges(true);
        toast.success("Imported data loaded into form");
      } catch (e) {
        console.warn('[InspectionForm] Failed to reload after import:', e);
      }
    };

    window.addEventListener('report-data-imported', handleReportImported);
    return () => window.removeEventListener('report-data-imported', handleReportImported);
  }, [id]);

  const performSave = async (silent: boolean = false) => {
    // Block all writes in Lovable preview to protect production data
    if ((await import('@/lib/environment')).isLovablePreview()) return;
    // Required-field gate: mirror the sync-time validator
    // (`validation-schemas.ts#inspectionSchema`) at save time so the form
    // and the sync engine cannot disagree about which header fields are
    // required. Manual saves surface a toast; auto-saves skip silently so
    // the user isn't spammed every debounce interval while editing.
    const requiredHeaderCheck = checkRequiredHeaderFields(
      inspection as unknown as Record<string, unknown>,
      'inspection',
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
        console.log(`[InspectionForm] Skipping silent save — required fields missing: ${missingLabels}`);
      }
      return;
    }
    // Mutex guard: prevent concurrent saves from auto-save, emergency save, and interval timer
    if (anySaveInProgressRef.current) {
      if (import.meta.env.DEV) console.log('[InspectionForm] performSave skipped - another save in progress');
      return;
    }
    anySaveInProgressRef.current = true;
    // Deadlock recovery: if this `performSave` hangs longer than 30s, force-
    // release the mutex so a subsequent invocation can proceed. The `finally`
    // (below) is the normal release path; this break-glass exists for hung
    // awaits (e.g. a Supabase request on a half-open TCP connection that
    // never resolves, stalled IDB upgrades).
    //
    // `deadlockTimerFired` makes ownership safe across the recovery boundary:
    // once the timer fires, the mutex no longer belongs to this invocation
    // (a newer `performSave` may have acquired it). The `finally` therefore
    // skips its release in that case, otherwise it would silently clear a
    // newer invocation's mutex and allow concurrent saves.
    //
    // Sizing: well above the worst legitimate budget (getDB Promise.race 5s,
    // withOfflineTimeout local fallback 2s, Supabase per-query timeout 8s,
    // syncWithRetry 3 attempts with 2s+4s backoff = ~14s plus network),
    // well below "permanently stuck".
    let deadlockTimerFired = false;
    const performSaveDeadlockTimer = setTimeout(() => {
      deadlockTimerFired = true;
      console.error('[InspectionForm] performSave deadlock recovery: mutex held >30s, force-releasing');
      anySaveInProgressRef.current = false;
    }, 30000);
    try {
      // Best-effort user lookup for last_modified_by — never blocks save
      // Matches TrainingForm/DailyAssessmentForm pattern: local saves always succeed
      const user = await getUserWithCache().catch(() => null);
      
      // Preserve original inspector_id - only update timestamp
      const baseInspectionToSave = {
        ...inspection,
        updated_at: new Date().toISOString(),
        // DISABLED: active_duration_seconds: getElapsedSeconds(),
        // Track who modified the report if current user is not the owner
        ...(currentUser?.id && currentUser.id !== inspection.inspector_id 
          ? { last_modified_by: currentUser.id } 
          : {}),
      };

      // S9: Reconcile user-clear intent. If the user has emptied every section
      // of a previously-synced inspection, stamp `user_cleared_at` so the
      // sync pipeline doesn't restore the server copy back into IDB.
      const summarySnapshot = summaryRef.current;
      const summaryHasAnyContent = !!(summarySnapshot && (
        summarySnapshot.repairs_performed ||
        summarySnapshot.critical_actions ||
        summarySnapshot.future_considerations ||
        summarySnapshot.next_inspection_date
      ));
      const totalChildCount =
        systems.length + ziplines.length + equipment.length +
        standards.length + (summaryHasAnyContent ? 1 : 0);
      const { reconcileClearIntent } = await import('@/lib/clear-intent');
      const inspectionToSave = reconcileClearIntent(
        baseInspectionToSave,
        totalChildCount,
        !!baseInspectionToSave.synced_at,
      );
      
      // Validate before saving
      // Only include summary in validation if it has required fields and content
      const currentSummary = summaryRef.current;
      const hasSummaryContent = currentSummary.repairs_performed || 
                                currentSummary.critical_actions || 
                                currentSummary.future_considerations || 
                                currentSummary.next_inspection_date;
      const summaryForValidation = (currentSummary.id && currentSummary.inspection_id && hasSummaryContent) 
        ? currentSummary 
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
        summary: currentSummary,
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

      // Save ALL items to offline storage (including incomplete rows)
      // This preserves work-in-progress data locally even if names are empty.
      // Slice 1.5: delegated to `persistInspectionToOffline`. The saver:
      //   - re-applies reconcileClearIntent (idempotent — page already did so)
      //   - re-stamps updated_at (a few ms newer than the page snapshot)
      //   - writes localStorage snapshot FIRST (Layer 1) then IDB child rows (Layer 2)
      //   - fires onSnapshotSaved BEFORE awaiting IDB so showHardSavedToast
      //     still appears even if IDB hangs (preserves legacy timing)
      // The mutex, deadlock timer, validation, and React state remain in this page.
      let localSaveSucceeded = false;
      let offlineError: unknown;
      let updatedInspection: DbRow = inspectionToSave;
      try {
        const persistResult = await persistInspectionToOffline(
          {
            id: id!,
            inspection: inspectionToSave,
            systems,
            ziplines,
            equipment,
            standards,
            summary: currentSummary,
          },
          {
            currentUserId: currentUser?.id,
            childDataLoaded: {
              systems: childDataLoadedRef.current.systems,
              ziplines: childDataLoadedRef.current.ziplines,
              equipment: childDataLoadedRef.current.equipment,
              standards: childDataLoadedRef.current.standards,
              summary: childDataLoadedRef.current.summary,
            },
            silent,
            onSnapshotSaved: () => {
              if (!silent) {
                showHardSavedToast(lastVersionNumber ? lastVersionNumber + 1 : undefined, undefined);
              }
            },
            onVersionAppended: ({ versionNumber, fieldCount }) => {
              setLastVersionNumber(versionNumber);
              setLastFieldCount(fieldCount);
            },
          },
        );
        updatedInspection = persistResult.updatedInspection;
        localSaveSucceeded = persistResult.localSaveSucceeded;
        offlineError = persistResult.offlineError;
        // Sync React state to the saver's freshly-stamped inspection so the
        // remote push uses the same timestamp that landed in IDB.
        setInspection(updatedInspection);
        if (localSaveSucceeded) {
          console.log('[InspectionForm Save] Offline storage completed');
        }
      } catch (e) {
        // persistInspectionToOffline does not throw under normal conditions
        // (snapshot/version are best-effort). Treat any throw as a fatal local
        // save failure.
        offlineError = e;
      }
      if (!localSaveSucceeded) {
        console.warn('[InspectionForm Save] Offline storage failed:', offlineError);
        // Gap 2.1: A real IdbSaveError must propagate so callers KEEP the dirty
        // flag set, SKIP advancing lastSaved, and SKIP appendVersion(). The
        // localStorage snapshot above is still the user's safety net.
        const { isIdbSaveError } = await import('@/lib/offline-storage');
        if (isIdbSaveError(offlineError)) {
          setSaveError({ message: 'Local save failed — your changes are NOT stored. Tap to retry.', code: (offlineError as { code: IdbSaveErrorCode }).code });
          throw offlineError;
        }
        if (!silent) {
          toast.warning("Saved to backup — retrying storage", {
            description: "Your data is safe. Extended storage is slow on this device.",
            duration: 4000,
          });
        }
        setSaveError({ message: 'Local save failed — please retry' });
      }

      // DEV: warn if filtering excludes items from server sync
      if (import.meta.env.DEV) {
        if (validSystems.length !== systems.length) {
          console.warn(`[InspectionForm] ${systems.length - validSystems.length} system(s) filtered out (empty name) — saved locally but excluded from server sync`);
        }
        if (validZiplines.length !== ziplines.length) {
          console.warn(`[InspectionForm] ${ziplines.length - validZiplines.length} zipline(s) filtered out (empty name) — saved locally but excluded from server sync`);
        }
        console.log('[InspectionForm] Saved all data to offline storage');
      }
      
      // Clear any previous save errors
      setSaveError(null);

      // H10: Pre-edit snapshot: capture server state before admin overwrites it.
      // Fires regardless of online state — capturePreEditSnapshot internally
      // routes to a local queue (admin_edit_snapshot_queue) when offline so the
      // audit trail is never lost.
      if (currentUser?.id && inspection?.inspector_id && currentUser.id !== inspection.inspector_id) {
        capturePreEditSnapshot('inspection', id!, inspection.inspector_id, currentUser.id);
      }

      // If online, sync to Supabase with retry logic
      if (isOnline) {
        const syncWithRetry = async (retries = 2): Promise<void> => {
          try {
            // Sanitize inspection data - remove joined/computed fields and handle nulls.
            // M10: Also strip `created_at` so neither update nor the upsert fallback
            // can overwrite the server's original timestamp with a (possibly skewed)
            // local clock value. The temp→real-UUID dedup key relies on
            // (inspector_id, organization, created_at), so drift here can produce
            // duplicate rows on the next sync.
            //
            // Strip IDB-only fields (`child_count_hint`, `dirty`) — the local-save
            // helper `saveInspectionOffline` MUTATES the inspection object in
            // place to stamp these (S30 / C3), so by the time we reach the
            // remote write `inspectionToSave` carries them. Sending them to
            // Supabase fails with PGRST204 ("Could not find the
            // 'child_count_hint' column …"). Mirrors the strip list in
            // `atomic-sync-manager.ts:LOCAL_ONLY_REMOTE_UPSERT_FIELDS` —
            // keep both lists in sync when adding new IDB-only flags.
            const sanitizeInspection = (insp: DbRow) => {
              const {
                id,
                inspector,
                created_at,
                child_count_hint,
                dirty,
                inspection_id,
                user_id,
                ...rest
              } = insp;
              return {
                ...rest,
                previous_inspection_date: rest.previous_inspection_date === "" ? null : rest.previous_inspection_date,
              };
            };

            // Update main inspection record WITHOUT synced_at (deferred pattern)
            const sanitized = sanitizeInspection(inspectionToSave);
            const { data: updateResult, error: inspectionError } = await supabase
              .from("inspections")
              .update(sanitized as never)
              .eq("id", id)
              .select("id");
            
            if (inspectionError) {
              console.error('[InspectionForm Sync] Failed to update inspection:', inspectionError);
              throw inspectionError;
            }
            
            // Verification: If 0 rows updated, record may not exist on server — use upsert
            if (!updateResult || updateResult.length === 0) {
              console.warn('[InspectionForm Sync] Update returned 0 rows — falling back to upsert');
              const { error: upsertError } = await supabase
                .from("inspections")
                .upsert({ id, ...sanitized } as never);
              if (upsertError) {
                console.error('[InspectionForm Sync] Upsert fallback failed:', upsertError);
                throw upsertError;
              }
            }
            
            // OPTIMIZED: Parallelize all independent database operations
            // Pre-generate UUIDs for new items to avoid .select() roundtrips
            // Stamp display_order from array index before saving
            const systemsWithOrder = systems.map((s, i) => ({ ...s, display_order: i }));
            const ziplinesWithOrder = ziplines.map((z, i) => ({ ...z, display_order: i }));
            const equipmentWithOrder = equipment.map((e, i) => ({ ...e, display_order: i }));

            const existingSystems = systemsWithOrder.filter(s => s.id && !s.id.startsWith('temp-'));
            const newSystems = systemsWithOrder.filter(s => !s.id || s.id.startsWith('temp-')).map(s => ({
              ...s,
              id: crypto.randomUUID(), // Pre-generate UUID
              inspection_id: id
            }));
            
            const existingZiplines = ziplinesWithOrder.filter(z => z.id && !z.id.startsWith('temp-'));
            const newZiplines = ziplinesWithOrder.filter(z => !z.id || z.id.startsWith('temp-')).map(z => ({
              ...z,
              id: crypto.randomUUID(),
              inspection_id: id
            }));
            
            const existingEquipment = equipmentWithOrder.filter(e => e.id && !e.id.startsWith('temp-'));
            const newEquipment = equipmentWithOrder.filter(e => !e.id || e.id.startsWith('temp-')).map(e => ({
              ...e,
              id: crypto.randomUUID(),
              inspection_id: id
            }));
            
            // Prepare standards with proper IDs for upsert
            const standardsWithIds = standards.map(s => ({
              ...s,
              id: s.id || crypto.randomUUID(),
              inspection_id: id
            }));
            
            // Prepare summary
            const sanitizeSummary = (sum: DbRow) => ({
              ...sum,
              next_inspection_date: sum.next_inspection_date === "" ? null : sum.next_inspection_date
            });

            // Execute ALL operations in parallel for maximum speed
            const parallelOperations: Promise<void>[] = [];

            // RECONCILE: Delete server rows removed locally before upserting
            // C4: capture pre-images so we can restore them if the parallel upserts fail.
            let inspReconciledDeletes: ReconciledTableDelete[] = [];
            const user = await getUserWithCache();
            if (user) {
              const reconcileResult = await reconcileAllChildTables(
                [
                  { childTable: 'inspection_systems', parentIdColumn: 'inspection_id', localItems: systems },
                  { childTable: 'inspection_ziplines', parentIdColumn: 'inspection_id', localItems: ziplines },
                  { childTable: 'inspection_equipment', parentIdColumn: 'inspection_id', localItems: equipment },
                  { childTable: 'inspection_standards', parentIdColumn: 'inspection_id', localItems: standards },
                  { childTable: 'inspection_summary', parentIdColumn: 'inspection_id', localItems: summary ? [summary] : [] },
                ],
                id!,
                'inspection',
                user.id,
              );
              inspReconciledDeletes = reconcileResult.deletedByTable;
            }
            
            // Helper to convert PromiseLike to proper Promise
            const dbOp = async (operation: PromiseLike<{ error: PostgrestError | null }>) => {
              const { error } = await operation;
              if (error) throw error;
            };
            
            // Systems operations
            if (existingSystems.length > 0) {
              parallelOperations.push(
                dbOp(supabase.from("inspection_systems").upsert(existingSystems.map(s => ({ ...s, inspection_id: id })) as never, { onConflict: 'id' }))
              );
            }
            if (newSystems.length > 0) {
              // Build temp ID → new item map for position-preserving replacement
              const systemTempToNewMap = new Map<string, typeof newSystems[0]>();
              systems.filter(s => !s.id || s.id.startsWith('temp-')).forEach((original, i) => {
                if (newSystems[i]) {
                  systemTempToNewMap.set(original.id || '', newSystems[i]);
                }
              });
              
              parallelOperations.push(
                dbOp(supabase.from("inspection_systems").insert(newSystems as never))
              );
              
              // Replace temp items in-place, preserving position (no reordering).
              // Adopt only the server-assigned id/inspection_id; keep all other fields
              // from live React state to avoid clobbering in-flight user edits.
              queueMicrotask(() => {
                isInternalUpdateRef.current = true;
                setSystems(prev => prev.map(s => {
                  if (s.id && s.id.startsWith('temp-') && systemTempToNewMap.has(s.id)) {
                    const replacement = systemTempToNewMap.get(s.id)!;
                    return { ...s, id: replacement.id, inspection_id: replacement.inspection_id };
                  }
                  return s;
                }));
              });
            }
            
            // Ziplines operations
            if (existingZiplines.length > 0) {
              parallelOperations.push(
                dbOp(supabase.from("inspection_ziplines").upsert(existingZiplines.map(z => ({ ...z, inspection_id: id })) as never, { onConflict: 'id' }))
              );
            }
            if (newZiplines.length > 0) {
              // Build temp ID → new item map for position-preserving replacement
              const ziplineTempToNewMap = new Map<string, typeof newZiplines[0]>();
              ziplines.filter(z => !z.id || z.id.startsWith('temp-')).forEach((original, i) => {
                if (newZiplines[i]) {
                  ziplineTempToNewMap.set(original.id || '', newZiplines[i]);
                }
              });
              
              parallelOperations.push(
                dbOp(supabase.from("inspection_ziplines").insert(newZiplines as never))
              );
              
              // Replace temp items in-place, preserving position (no reordering).
              // Adopt only the server-assigned id/inspection_id; keep all other fields
              // from live React state to avoid clobbering in-flight user edits.
              queueMicrotask(() => {
                isInternalUpdateRef.current = true;
                setZiplines(prev => prev.map(z => {
                  if (z.id && z.id.startsWith('temp-') && ziplineTempToNewMap.has(z.id)) {
                    const replacement = ziplineTempToNewMap.get(z.id)!;
                    return { ...z, id: replacement.id, inspection_id: replacement.inspection_id };
                  }
                  return z;
                }));
              });
            }
            
            // Equipment operations
            if (existingEquipment.length > 0) {
              parallelOperations.push(
                dbOp(supabase.from("inspection_equipment").upsert(existingEquipment.map(e => ({ ...e, inspection_id: id })) as never, { onConflict: 'id' }))
              );
            }
            if (newEquipment.length > 0) {
              // Build temp ID → new item map for position-preserving replacement
              const equipmentTempToNewMap = new Map<string, typeof newEquipment[0]>();
              equipment.filter(e => !e.id || e.id.startsWith('temp-')).forEach((original, i) => {
                if (newEquipment[i]) {
                  equipmentTempToNewMap.set(original.id || '', newEquipment[i]);
                }
              });
              
              parallelOperations.push(
                dbOp(supabase.from("inspection_equipment").insert(newEquipment as never))
              );
              
              // Replace temp items in-place, preserving position (no reordering).
              // CRITICAL: only adopt the server-assigned id/inspection_id — preserve all
              // other fields from the live React state. Replacing the whole row from the
              // pre-save snapshot would clobber any edits the user made between when the
              // snapshot was taken and when this microtask runs (e.g. picking an equipment
              // type from the combobox immediately after adding the row).
              queueMicrotask(() => {
                isInternalUpdateRef.current = true;
                setEquipment(prev => prev.map(e => {
                  if (e.id && e.id.startsWith('temp-') && equipmentTempToNewMap.has(e.id)) {
                    const replacement = equipmentTempToNewMap.get(e.id)!;
                    return { ...e, id: replacement.id, inspection_id: replacement.inspection_id };
                  }
                  return e;
                }));
              });
            }
            
            // Standards - use upsert instead of delete+insert for atomicity
            parallelOperations.push(
              dbOp(supabase.from("inspection_standards").upsert(standardsWithIds as never, { onConflict: 'id', ignoreDuplicates: false }))
            );
            
            // Summary
            parallelOperations.push(
              dbOp(supabase.from("inspection_summary").upsert(sanitizeSummary({ ...currentSummary, inspection_id: id }) as never, { onConflict: 'inspection_id' }))
            );

            // Execute all in parallel
            try {
              await Promise.all(parallelOperations);
            } catch (parErr) {
              // C4: parallel upsert(s) failed — restore the rows reconcile already deleted.
              if (inspReconciledDeletes.length > 0) {
                try {
                  await restoreReconciledDeletions(inspReconciledDeletes, id!);
                } catch (restoreErr) {
                  console.error('[C4] InspectionForm: restoreReconciledDeletions threw', restoreErr);
                }
              }
              throw parErr;
            }

            // DEFERRED: Set synced_at ONLY after all child data committed successfully
            const hadFilteredItems = validSystems.length !== systems.length
              || validZiplines.length !== ziplines.length
              || validEquipment.length !== equipment.length;

            const syncTimestamp = new Date().toISOString();
            
            // Final step: set synced_at on server and verify it was written
            const { data: verifyData, error: finalSyncError } = await supabase
              .from("inspections")
              .update({ synced_at: syncTimestamp })
              .eq("id", id)
              .select("id, synced_at");
            
            if (finalSyncError || !verifyData?.length) {
              console.error('[InspectionForm Sync] Post-sync verification failed:', finalSyncError);
              throw new Error("Sync verification failed: server did not confirm synced_at update");
            }

            // Only mark local as synced after server confirmation
            await saveInspectionOffline({
              ...inspectionToSave,
              synced_at: syncTimestamp,
              updated_at: hadFilteredItems ? inspectionToSave.updated_at : syncTimestamp,
            });

            markSnapshotSynced('inspection', id!);
            console.log('[InspectionForm Sync] Synced all data to Supabase successfully (verified)');
          } catch (error) {
            // Detect network-related errors for retry
            const errMsg = errorMessage(error, '').toLowerCase();
            const code: string | undefined = errorCode(error);
            const errName = error instanceof Error ? error.name : undefined;
            const isNetworkError =
              errMsg.includes('network') ||
              errMsg.includes('fetch') ||
              errMsg.includes('failed to fetch') ||
              errMsg.includes('connection') ||
              errMsg.includes('timeout') ||
              code === 'NETWORK_ERROR' ||
              code === 'ECONNREFUSED' ||
              errName === 'TypeError' || // Often thrown on network failures
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
        } catch (error) {
          console.error('[InspectionForm Sync] Failed after retries:', error);
          // Use "Pending sync" instead of error - less alarming, auto-retry handles it
          setSaveError('pending_sync');
          // H5: No queueOperation call — IDB drift (updated_at > synced_at from
          // the earlier saveInspectionOffline) is the sole sync trigger.
          // useAutoSync's next cycle will pick this up via getUnsyncedInspections.
          console.log('[InspectionForm Sync] Sync failed — IDB drift will trigger retry on next auto-sync cycle');
          
          // If local save ALSO failed, warn the user urgently
          if (!localSaveSucceeded) {
            if (isMobile()) {
              addSyncNotification("⚠️ Data could not be saved locally or remotely. Please retry.");
            } else {
              toast.error("Save failed", {
                description: "Data could not be saved locally or remotely. Please check your connection and try again.",
                duration: 10000,
              });
            }
          } else {
            // Show toast for network failures with auto-retry hint - mobile-aware
            if (isMobile()) {
              addSyncNotification("Saved locally - will sync when online");
            } else {
              toast.info("Saved locally", {
                description: "Will sync automatically when connection improves.",
              });
            }
          }
        }
      } else {
        // H5: Offline — no queueOperation call. The earlier saveInspectionOffline
        // already set updated_at > synced_at; useAutoSync will detect this drift
        // and sync via syncInspectionAtomic when the device comes back online.
        console.log('[InspectionForm Sync] Offline — IDB drift will trigger sync when online');
      }
    } catch (error) {
      console.error('[InspectionForm] Save error:', error);
      logError(error, { scope: 'InspectionForm.performSave' });
      setSaveError({ message: errorMessage(error, 'Failed to save'), code: errorCode(error) });
      throw error;
    } finally {
      clearTimeout(performSaveDeadlockTimer);
      // Only release if we still own the mutex. If the deadlock timer fired,
      // a later `performSave` may have already acquired it; clearing here
      // would let a third invocation run concurrently.
      if (!deadlockTimerFired) {
        anySaveInProgressRef.current = false;
      }
    }
  };

  // Keep performSaveRef pointing to the latest performSave on every render
  performSaveRef.current = performSave;

  const triggerImmediateSaveRef = useRef<() => Promise<void>>();

  const triggerImmediateSave = async () => {
    if (saving || anySaveInProgressRef.current) {
      // Don't drop the save -- ensure data is saved on the next cycle
      setHasUnsavedChanges(true);
      return;
    }
    
    // Clear existing debounce timer using ref
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
    
    // `anySaveInProgressRef` is owned exclusively by `performSave`
    // (acquire on entry, release in `finally`). Wrapper-level race
    // protection is provided by `autoSaving`/`saving`.
    setAutoSaving(true);
    
    // Safety timeout - NEVER get stuck in autoSaving UI state.
    // Does NOT touch `anySaveInProgressRef` — that mutex is owned by
    // `performSave`. Releasing it here would race with a concurrent
    // wrapper whose `performSave` early-returned (mutex held by another
    // run): its `finally` would prematurely clear the live mutex.
    const safetyTimeout = setTimeout(() => {
      console.warn('[InspectionForm] triggerImmediateSave safety timeout reached, forcing state reset');
      setAutoSaving(false);
    }, 8000);
    
    try {
      await performSave(true); // Silent immediate save
      setLastSaved(new Date());
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      // Non-intrusive success feedback (routes to notification center on mobile)
      toast.success("Changes saved");
      if (import.meta.env.DEV) {
        console.log("Immediate save triggered at", new Date().toLocaleTimeString());
      }
      // Sync is now handled automatically by useAutoSync hook
    } catch (error) {
      console.error("Immediate save failed:", error);
      setSaveError({ message: errorMessage(error, 'Immediate save failed'), code: errorCode(error) });
    } finally {
      clearTimeout(safetyTimeout);
      setAutoSaving(false);
      // `anySaveInProgressRef` is NOT cleared here — owned by `performSave`.
    }
  };

  // Update ref after every render so the stable wrapper always calls the latest version
  triggerImmediateSaveRef.current = triggerImmediateSave;

  // Stable wrapper that never changes identity — allows React.memo to work on EquipmentTable
  const stableTriggerImmediateSave = useCallback(() => {
    return triggerImmediateSaveRef.current?.() ?? Promise.resolve();
  }, []);

  const autoSaveProgress = async () => {
    if (!hasUnsavedChanges || saving || autoSaving || anySaveInProgressRef.current) return;
    
    // `anySaveInProgressRef` is owned exclusively by `performSave`
    // (acquire on entry, release in `finally`). Wrapper-level race
    // protection is provided by `autoSaving`/`saving`.
    setAutoSaving(true);
    
    // Safety timeout - NEVER get stuck in autoSaving UI state.
    // Does NOT touch `anySaveInProgressRef` — owned by `performSave`.
    const safetyTimeout = setTimeout(() => {
      console.warn('[InspectionForm] autoSaveProgress safety timeout reached, forcing state reset');
      setAutoSaving(false);
    }, 8000);
    
    try {
      await performSave(true); // Silent auto-save
      setLastSaved(new Date());
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      if (import.meta.env.DEV) {
        console.log("Auto-saved successfully at", new Date().toLocaleTimeString());
      }
      // Sync is now handled automatically by useAutoSync hook
    } catch (error) {
      console.error("Auto-save failed:", error);
      setSaveError({ message: errorMessage(error, 'Auto-save failed'), code: errorCode(error) });
    } finally {
      clearTimeout(safetyTimeout);
      setAutoSaving(false);
      // `anySaveInProgressRef` is NOT cleared here — owned by `performSave`.
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

    // Safety timeout - ensure saving UI state is cleared after max 8 seconds.
    // Does NOT touch `anySaveInProgressRef` — owned by `performSave`.
    //
    // The `safetyTimerFired` flag is captured per-invocation so the finally
    // block can tell whether THIS invocation still owns `saveInProgressRef`
    // when it cleans up. Without it, an 8s+ save would have its mutex
    // released by the timer, a concurrent caller would acquire it, then the
    // original save's `finally` would stomp the new owner's mutex back to
    // false — letting yet another caller race in. Same pattern as PR #26's
    // fix in TrainingForm/DailyAssessmentForm; the underlying lesson is the
    // deadlock-timer ownership race PR #22 fixed in
    // `InspectionForm.performSave` (`deadlockTimerFired`).
    let safetyTimerFired = false;
    const safetyTimeout = setTimeout(() => {
      console.warn('[InspectionForm] Safety timeout reached, forcing save state reset');
      safetyTimerFired = true;
      setSaving(false);
      saveInProgressRef.current = false;
    }, 8000);

    try {
      await performSave(false); // Show warnings on manual save
      setLastSaved(new Date());
      setLastManuallySaved(new Date());
      hasUnsavedRef.current = false;
      setHasUnsavedChanges(false);
      if (import.meta.env.DEV) {
        console.log('[InspectionForm] Progress saved:', isOnline ? 'online' : 'offline');
      }
      // Sync is now handled automatically by useAutoSync hook
    } catch (error) {
      console.error("Save error:", error);
      setSaveError({ message: errorMessage(error, 'Failed to save progress'), code: errorCode(error) });
    } finally {
      clearTimeout(safetyTimeout);
      // Only flip UI state + release the mutex if the safety timer hasn't
      // already done so. If the safety timer already fired, a concurrent
      // caller may have acquired the mutex AND called `setSaving(true)`
      // — the stale invocation must not stomp either piece of their state.
      // Both guards together keep the `saving` flag and the mutex coherent
      // for the new owner.
      if (!safetyTimerFired) {
        console.log('[InspectionForm] Completed, setting saving to false');
        setSaving(false);
        saveInProgressRef.current = false;
      }
    }
  };

  // Set save ref for keyboard shortcut
  useEffect(() => {
    saveRef.current = saveProgress;
  });

  // Auto-save/sync retry is now handled by useAutoSync hook

  const completeInspection = async (attestation?: AttestationPayload) => {
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
    
    if (!validation.success && import.meta.env.DEV) {
      console.warn('[InspectionForm] Completing with validation warnings:', 
        validation.errors.map(formatValidationError));
    }
    
    await saveProgress();
    try {
      const wasAlreadyCompleted = inspection?.status === "completed";
      
      // Build the update payload — include attestation only when first signing,
      // and always stamp the app version at completion time.
      const updatePayload: Record<string, unknown> = {
        status: "completed",
        app_version_at_completion: APP_VERSION_FULL,
      };
      if (attestation) {
        Object.assign(updatePayload, attestation);
      }
      
      if (isOnline) {
        const { error } = await supabase
          .from("inspections")
          .update(updatePayload as never)
          .eq("id", id);

        if (error) throw error;

        // Persist completion to IndexedDB IMMEDIATELY so useAutoSync's drift
        // check doesn't read a stale `status: 'draft'` from IDB and re-push it,
        // silently reverting the server back to draft (Baylor bug).
        // Stamp synced_at = updated_at since the row was just confirmed remote.
        const completionTimestamp = new Date().toISOString();
        const updatedInspection = {
          ...inspection,
          ...updatePayload,
          updated_at: completionTimestamp,
          synced_at: completionTimestamp,
        };
        try {
          await saveInspectionOffline(updatedInspection);
        } catch (idbErr) {
          console.error('[InspectionForm] Post-completion IDB save failed', idbErr);
        }

        // Functional updater so we merge into the latest state produced by
        // the preceding saveProgress(), not a stale pre-await closure.
        setInspection(prev => ({ ...(prev ?? inspection), ...updatePayload, updated_at: completionTimestamp, synced_at: completionTimestamp }));

        // Trigger celebration on first completion
        if (!wasAlreadyCompleted) {
          triggerCompletionConfetti();
          triggerHaptic('success');
        }
        
        if (import.meta.env.DEV) {
          console.log('[InspectionForm] Inspection completed online');
        }
      } else {
        // Save completion offline. H5: no queueOperation — saveInspectionOffline
        // bumps updated_at and useAutoSync's IDB drift check will sync it on
        // the next online cycle via syncInspectionAtomic.
        const updatedInspection = { ...inspection, ...updatePayload };
        await saveInspectionOffline(updatedInspection);

        // Update local state to reflect completion (functional updater for consistency)
        setInspection(prev => ({ ...(prev ?? inspection), ...updatePayload }));
        
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
    } catch (error) {
      console.error('[InspectionForm] Failed to complete inspection:', error);
    }
  };

  // Click handler for the Complete button — opens attestation on first sign,
  // skips it on subsequent re-completions (original signature stays valid).
  // Required-field gate runs first; missing fields reject completion with a
  // persistent toast + red pulse on the offending input.
  const handleCompleteClick = () => {
    const missing = getMissingInspectionFields(inspection);
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
      triggerHaptic('error');
      document.getElementById(`field-${missing[0].key}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    toast.dismiss(`completion-blocked-${id}`);
    setMissingRequiredFields([]);
    if (inspection?.attestation_signed_at) {
      // Already signed — just re-complete silently (admin re-edit flow)
      completeInspection();
    } else {
      setShowAttestationDialog(true);
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

    const GENERATION_TIMEOUT = 120000;
    const safetyTimeout = setTimeout(() => {
      console.warn('[PDF Generation] Safety timeout reached (120s) — force-releasing spinner');
      setGeneratingPdf(false);
      toast.error('PDF generation timed out', {
        description: 'The service is taking too long. Please try again.',
      });
    }, GENERATION_TIMEOUT);

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
        
        fileName = data.fileName || formatReportFilename(inspection.organization, 'inspection', 'pdf');
        
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
          
        } catch (decodeError) {
          console.error('[PDF Generation] Base64 decode error:', decodeError);
          throw new Error('DECODE_ERROR: Failed to decode PDF data. The file may be corrupted.');
        }
        
      } else if (data.pdfUrl) {
        console.log('[PDF Generation] Processing pdfUrl format (storage URL)');
        console.log('[PDF Generation] PDF URL:', data.pdfUrl);
        
        fileName = formatReportFilename(inspection.organization, 'inspection', 'pdf');
        
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
          
        } catch (fetchError) {
          console.error('[PDF Generation] Storage fetch error:', fetchError);
          throw new Error(`STORAGE_ERROR: ${errorMessage(fetchError, 'fetch failed')}`);
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

    } catch (error) {
      const msg = errorMessage(error, '');
      console.error('[PDF Generation] ❌ FAILED:', msg);

      const userMessage = msg.includes('NETWORK_ERROR')
        ? 'Network error — check your connection and try again.'
        : msg.includes('AUTH_ERROR')
        ? 'Authentication failed. Please log out and log in again.'
        : 'Failed to generate PDF. Please try again.';
      
      toast.error('PDF generation failed', { description: userMessage });
    } finally {
      clearTimeout(safetyTimeout);
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
    const progressToastId = toast.loading("Generating report...");
    
    // Safety timeout - NEVER get stuck in generating state (60 seconds max)
    const GENERATION_TIMEOUT = 120000;
    const safetyTimeoutHandle = setTimeout(() => {
      console.error('[HTML Generation] Safety timeout reached after 60 seconds - force resetting state');
      setGeneratingHtml(false);
      toast.dismiss(progressToastId);
      toast.error("Report generation timed out", {
        description: "Please check your connection and try again.",
      });
    }, GENERATION_TIMEOUT);

    try {
      // OPTIMIZATION: Client-side cache check — if no unsaved changes and report was already 
      // generated after the last update, use cached HTML from the database directly
      if (!hasUnsavedChanges && inspection?.latest_report_generated_at && inspection?.updated_at) {
        const generatedAt = new Date(inspection.latest_report_generated_at).getTime();
        const updatedAt = new Date(inspection.updated_at).getTime();
        
        if (generatedAt >= updatedAt) {
          console.log('[HTML Generation] Client-side cache HIT — fetching cached report from DB');
          toast.loading("Loading cached report...", { id: progressToastId });
          const cachedHtml = await getLatestReport();
          if (cachedHtml) {
            clearTimeout(safetyTimeoutHandle);
            toast.dismiss(progressToastId);
            setReportHtml(cachedHtml);
            setHtmlViewerOpen(true);
            setGeneratingHtml(false);
            return;
          }
          console.log('[HTML Generation] Cache returned empty, falling through to generation');
        }
      }

      // Flush any pending changes to ensure edge function reads fresh data
      if (hasUnsavedChanges) {
        toast.loading("Saving changes first...", { id: progressToastId });
        try {
          await Promise.race([
            saveProgress(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Save timeout')), 5000)),
          ]);
        } catch (e) {
          console.warn('[HTML Generation] Pre-save timed out, proceeding anyway:', e);
        }
        toast.loading("Generating report...", { id: progressToastId });
      }

      // Wrap the edge function call in a Promise.race with timeout
      const generatePromise = supabase.functions.invoke(
        'generate-inspection-html',
        {
          body: { inspectionId: id }
        }
      );
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('TIMEOUT: Report generation took too long'));
        }, GENERATION_TIMEOUT - 2000); // 2 seconds before safety timeout
      });
      
      const { data, error } = await Promise.race([generatePromise, timeoutPromise]);

      if (error) {
        throw new Error(error.message || 'Failed to generate HTML');
      }

      // Backend now returns a signed URL instead of raw HTML
      let html: string;
      
      if (data?.htmlUrl) {
        // Fetch the HTML content from the signed storage URL
        console.log('[HTML Generation] Fetching HTML from signed URL...');
        const htmlResponse = await fetch(data.htmlUrl);
        if (!htmlResponse.ok) {
          throw new Error(`Failed to fetch report: ${htmlResponse.status} ${htmlResponse.statusText}`);
        }
        html = await htmlResponse.text();
      } else if (data?.html) {
        // Backward compatibility: direct HTML response
        html = data.html;
      } else {
        throw new Error('No HTML content or URL received from server');
      }
      const filename = formatReportFilename(inspection?.organization, 'inspection', 'html');
      const title = formatReportTitle(inspection?.organization, 'inspection');

      // Always use in-app viewer for consistent Save PDF + Close buttons
      toast.dismiss(progressToastId);
      setReportHtml(html);
      setHtmlViewerOpen(true);
    } catch (error) {
      toast.dismiss(progressToastId);
      const msg = errorMessage(error, 'Please try again.');
      console.error('[HTML Generation] Error:', msg || error);

      if (msg.includes('TIMEOUT')) {
        toast.error("Report generation timed out", {
          description: "Please check your connection and try again.",
        });
      } else {
        toast.error("Failed to generate report", {
          description: msg,
        });
      }
    } finally {
      clearTimeout(safetyTimeoutHandle);
      setGeneratingHtml(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading inspection...</p>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => goBack(navigate)}
            className="mt-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
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
        hasUnsavedChanges={hasUnsavedChanges && (inspection?.status !== 'completed' || completionLockOverridden)}
        message="You have unsaved changes to this inspection. Are you sure you want to leave?"
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
            console.warn('[InspectionForm] Save-before-leave error:', e);
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
      <InspectionHeaderSection
        isOnline={isOnline}
        storageUnavailable={storageUnavailable}
        showOfflineEmptyBanner={
          !isOnline &&
          !loading &&
          systems.length === 0 &&
          ziplines.length === 0 &&
          equipment.length === 0 &&
          !childDataLoadedRef.current.systems &&
          !childDataLoadedRef.current.ziplines &&
          !childDataLoadedRef.current.equipment
        }
        onBack={() => setShowLeaveDialog(true)}
        saveError={saveError}
        isSyncing={isSyncing}
        isSaving={saving}
        isAutoSaving={autoSaving}
        hasUnsavedChanges={hasUnsavedChanges}
        lastManuallySaved={lastManuallySaved}
        versioningFailures={versioningFailures}
        onRetrySave={async () => {
          setSaveError(null);
          try {
            await saveProgress();
            toast.success("Save successful");
          } catch (err) {
            console.error('[InspectionForm] Manual save failed:', err);
            toast.error("Save failed", {
              description: "Please try again or check your connection.",
            });
          }
        }}
        onWarnVersioning={() => {
          toast.warning("Recovery snapshots are failing", {
            description: `Your last ${versioningFailures} version snapshots could not be saved. Your current work is still saved, but earlier-state recovery may be unavailable. Try reloading the page.`,
            duration: 8000,
          });
          resetVersioningHealth();
        }}
        actions={{
          effectiveReadOnly,
          hasId: !!id,
          status: inspection?.status,
          isMobile: isMobileView,
          isAdmin,
          isOnline,
          isSaving: saving,
          isAutoSaving: autoSaving,
          onSave: saveProgress,
          saveLabel: isOnline ? "Save Progress" : "Save Locally",
          onForceBackup: async () => {
            if (inspection && id) {
              saveReportSnapshot('inspection', id, inspection, {
                systems, ziplines, equipment, standards, summary: [summary],
              }, !!inspection.synced_at);
            }
            const ok = await downloadReportBackup('inspection', id);
            if (ok) {
              toast.success('BACKUP SAVED', {
                description: 'Snapshot downloaded to device',
                duration: 2000,
                style: {
                  background: 'hsl(0, 0%, 5%)',
                  color: 'hsl(120, 100%, 56%)',
                  border: '1px solid hsl(120, 100%, 50%, 0.3)',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                },
              });
            } else {
              toast.warning('No snapshot available to download');
            }
          },
          refreshing,
          onRefresh: async () => {
            setRefreshing(true);
            try {
              await loadInspection();
              toast.success("Report refreshed", { description: "Latest data loaded successfully." });
            } catch {
              toast.error("Refresh failed");
            } finally {
              setRefreshing(false);
            }
          },
          onComplete: handleCompleteClick,
          isGeneratingHTML: generatingHtml,
          onGenerateHTML: handleGenerateHTML,
          isInvoiced,
          invoiceToggling,
          onToggleInvoiced: toggleInvoiced,
        }}
      />

      <SaveFailureBanner
        saveError={saveError}
        onRetry={() => saveProgress()}
        onExportDraft={() => ({
          inspection,
          systems,
          ziplines,
          equipment,
          standards,
          summary,
          exported_at: new Date().toISOString(),
        })}
        reportType="inspection"
        reportId={id}
      />

      <main onClickCapture={handleLockedFieldClick} onPointerDownCapture={handleLockedFieldClick} className={cn("container mx-auto px-4 py-8 max-w-6xl", isCompletionLocked && "completion-locked")}>
        {isCompletionLocked && (
          <div className="border-2 border-green-500/60 bg-black/90 text-green-500 font-mono text-xs px-4 py-2 flex items-center gap-2 mb-4 rounded">
            <Lock className="h-3.5 w-3.5" />
            <span>LOCKED — Click any field to unlock for editing</span>
          </div>
        )}
        {!isOnline && (
          <Alert className="mb-6 border-warning bg-warning/10">
            <CloudOff className="h-4 w-4 text-warning" />
            <AlertDescription className="text-gray-900 dark:text-gray-100">
              📴 Working offline - data will sync when online
            </AlertDescription>
          </Alert>
        )}

        {(() => {
          const requiredHeaderCheck = checkRequiredHeaderFields(
            inspection as unknown as Record<string, unknown>,
            'inspection',
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

        <InspectionHeader
          inspection={inspection}
          userProfile={inspectorProfile}
          modifiedByProfile={modifiedByProfile as { first_name?: string; last_name?: string } | null}
          onUpdate={effectiveReadOnly ? () => {} : handleHeaderUpdate}
          onImmediateSave={effectiveReadOnly ? undefined : stableTriggerImmediateSave}
          isReadOnly={effectiveReadOnly}
          missingFieldKeys={missingRequiredFields.map(m => m.key)}
        />

        {id && currentUser?.id && (
          <CollaboratorPresence
            reportId={id}
            reportType="inspection"
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

        <Tabs value={currentTab} onValueChange={(tab) => {
          handleTabChange(tab);
          // Mark tab as visited for lazy rendering
          setVisitedTabs(prev => new Set([...prev, tab]));
        }} className="space-y-6 mt-6">
          <div ref={swipeContainerRef} className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm pb-1">
            <TabsList className="grid grid-cols-4 w-full gap-1 lg:gap-0 h-auto p-1.5 lg:p-1 bg-muted/50 border border-border/50 rounded-lg">
              <TabsTrigger value="details" className="whitespace-nowrap text-xs lg:text-sm py-1.5 lg:py-2 flex flex-row items-center gap-1 lg:gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-semibold data-[state=active]:border data-[state=active]:border-primary/30">
                <Settings className="h-3.5 w-3.5 hidden lg:block" />
                <span>{isMobileView ? "Systems" : "Systems - Ziplines"}</span>
              </TabsTrigger>
              <TabsTrigger value="equipment" className="whitespace-nowrap text-xs lg:text-sm py-1.5 lg:py-2 flex flex-row items-center gap-1 lg:gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-semibold data-[state=active]:border data-[state=active]:border-primary/30">
                <Package className="h-3.5 w-3.5 hidden lg:block" />
                <span>Equipment</span>
              </TabsTrigger>
              <TabsTrigger value="standards" className="whitespace-nowrap text-xs lg:text-sm py-1.5 lg:py-2 flex flex-row items-center gap-1 lg:gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-semibold data-[state=active]:border data-[state=active]:border-primary/30">
                <ClipboardList className="h-3.5 w-3.5 hidden lg:block" />
                <span>{isMobileView ? "Criteria" : "Operations Criteria"}</span>
              </TabsTrigger>
              <TabsTrigger value="summary" className="whitespace-nowrap text-xs lg:text-sm py-1.5 lg:py-2 flex flex-row items-center gap-1 lg:gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent/50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:font-semibold data-[state=active]:border data-[state=active]:border-primary/30">
                <FileCheck className="h-3.5 w-3.5 hidden lg:block" />
                <span>Summary</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div>
              <TabsContent value="details" className="space-y-6">
                <OperatingSystemsTable systems={systems} onUpdate={setSystems} onImmediateSave={stableTriggerImmediateSave} inspectionId={id} onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)} />
                <ZiplinesTable ziplines={ziplines} onUpdate={setZiplines} onImmediateSave={stableTriggerImmediateSave} inspectionId={id} onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)} />
                
                <div className="mt-8 border-t pt-6">
                  <h3 className="text-lg font-semibold mb-4">Photos - Systems & Ziplines</h3>
                  {!effectiveReadOnly && (
                    <PhotoCapture
                      inspectionId={id!}
                      section="systems"
                      onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                  )}
                  <div className="mt-4">
                    <PhotoGallery
                      key={`systems-${photoRefreshKey}`}
                      inspectionId={id!}
                      section="systems"
                      readOnly={effectiveReadOnly}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="equipment" className="space-y-6">
                {/* PERFORMANCE: Lazy load - only render when tab has been visited */}
                {visitedTabs.has('equipment') && (
                  <>
                    <EquipmentTable
                      category="harnesses"
                      displayName="Harnesses"
                      equipment={equipment}
                      onUpdate={setEquipment}
                      onImmediateSave={stableTriggerImmediateSave}
                      categoryOptions={harnessesOpts.options}
                      onAddCategoryOption={harnessesOpts.addOption}
                      inspectionId={id}
                      onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                    <EquipmentTable
                      category="helmets"
                      displayName="Helmets"
                      equipment={equipment}
                      onUpdate={setEquipment}
                      onImmediateSave={stableTriggerImmediateSave}
                      categoryOptions={helmetsOpts.options}
                      onAddCategoryOption={helmetsOpts.addOption}
                      inspectionId={id}
                      onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                    <EquipmentTable
                      category="lanyards"
                      displayName="Lanyards"
                      equipment={equipment}
                      onUpdate={setEquipment}
                      onImmediateSave={stableTriggerImmediateSave}
                      categoryOptions={lanyardsOpts.options}
                      onAddCategoryOption={lanyardsOpts.addOption}
                      inspectionId={id}
                      onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                    <EquipmentTable
                      category="connectors"
                      displayName="Connectors (Carabiners & Quicklinks)"
                      equipment={equipment}
                      onUpdate={setEquipment}
                      onImmediateSave={stableTriggerImmediateSave}
                      categoryOptions={connectorsOpts.options}
                      onAddCategoryOption={connectorsOpts.addOption}
                      inspectionId={id}
                      onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                    <EquipmentTable
                      category="rope"
                      displayName="Rope"
                      equipment={equipment}
                      onUpdate={setEquipment}
                      onImmediateSave={stableTriggerImmediateSave}
                      categoryOptions={ropeOpts.options}
                      onAddCategoryOption={ropeOpts.addOption}
                      inspectionId={id}
                      onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                    <EquipmentTable
                      category="belay"
                      displayName="Belay/Descent Device"
                      equipment={equipment}
                      onUpdate={setEquipment}
                      onImmediateSave={stableTriggerImmediateSave}
                      categoryOptions={belayOpts.options}
                      onAddCategoryOption={belayOpts.addOption}
                      inspectionId={id}
                      onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                    <EquipmentTable
                      category="trolleys"
                      displayName="Trolleys and Pulleys"
                      equipment={equipment}
                      onUpdate={setEquipment}
                      onImmediateSave={stableTriggerImmediateSave}
                      categoryOptions={trolleysOpts.options}
                      onAddCategoryOption={trolleysOpts.addOption}
                      inspectionId={id}
                      onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                    <EquipmentTable
                      category="other"
                      displayName="Other Equipment"
                      equipment={equipment}
                      onUpdate={setEquipment}
                      onImmediateSave={stableTriggerImmediateSave}
                      categoryOptions={otherOpts.options}
                      onAddCategoryOption={otherOpts.addOption}
                      inspectionId={id}
                      onGalleryRefresh={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                    
                    <div className="mt-8 border-t pt-6">
                      <h3 className="text-lg font-semibold mb-4">Photos - Equipment</h3>
                      {!effectiveReadOnly && (
                        <PhotoCapture
                          inspectionId={id!}
                          section="equipment"
                          onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
                        />
                      )}
                      <div className="mt-4">
                        <PhotoGallery
                          key={`equipment-${photoRefreshKey}`}
                          inspectionId={id!}
                          section="equipment"
                          readOnly={effectiveReadOnly}
                        />
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="standards" className="space-y-4">
                <StandardsTable standards={standards} onUpdate={setStandards} onImmediateSave={stableTriggerImmediateSave} />
                
                <div className="mt-8 border-t pt-6">
                  <h3 className="text-lg font-semibold mb-4">Photos - Standards</h3>
                  {!effectiveReadOnly && (
                    <PhotoCapture
                      inspectionId={id!}
                      section="standards"
                      onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                  )}
                  <div className="mt-4">
                    <PhotoGallery
                      key={`standards-${photoRefreshKey}`}
                      inspectionId={id!}
                      section="standards"
                      readOnly={effectiveReadOnly}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="summary" className="space-y-4">
                <SummarySection 
                  summary={summary} 
                  onUpdate={setSummary} 
                  onImmediateSave={stableTriggerImmediateSave}
                  onRegenerate={handleManualRegenerateSummary}
                  onNextDateUserEdit={handleNextDateUserEdit}
                />
                
                <div className="mt-8 border-t pt-6">
                  <h3 className="text-lg font-semibold mb-4">Photos - Summary</h3>
                  {!effectiveReadOnly && (
                    <PhotoCapture
                      inspectionId={id!}
                      section="summary"
                      onPhotoAdded={() => setPhotoRefreshKey(prev => prev + 1)}
                    />
                  )}
                  <div className="mt-4">
                    <PhotoGallery
                      key={`summary-${photoRefreshKey}`}
                      inspectionId={id!}
                      section="summary"
                      readOnly={effectiveReadOnly}
                    />
                  </div>
                </div>
              </TabsContent>
          </div>
        </Tabs>
      </main>


      <HtmlReportViewer
        html={reportHtml}
        title={formatReportTitle(inspection?.organization, 'inspection')}
        filename={formatReportFilename(inspection?.organization, 'inspection', 'html')}
        isOpen={htmlViewerOpen}
        onClose={() => setHtmlViewerOpen(false)}
      />

      </div>

      <AlertDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete Inspection Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark this inspection as complete? This will lock the report. You can still edit it afterward if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => completeInspection()}>
              Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AttestationDialog
        open={showAttestationDialog}
        onOpenChange={setShowAttestationDialog}
        kind="inspection"
        signerName={signerFullName}
        signerId={inspection?.inspector_id ?? null}
        organization={inspection?.organization || ''}
        reportDate={inspection?.inspection_date || new Date().toISOString().slice(0, 10)}
        onSigned={(payload) => completeInspection(payload)}
      />
    </>
  );
}
