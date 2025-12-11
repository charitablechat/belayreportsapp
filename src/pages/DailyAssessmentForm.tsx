import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useFormConfiguration } from "@/hooks/useFormConfiguration";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, FileText, Loader2, WifiOff, Check, Sunrise, Sunset, Settings, Package, Building, Cloud, LogOut, User, CloudOff, SendHorizonal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AutoSaveIndicator } from "@/components/AutoSaveIndicator";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";
import DailyAssessmentHeader from "@/components/daily-assessment/DailyAssessmentHeader";
import BeginningOfDaySection from "@/components/daily-assessment/BeginningOfDaySection";
import EndOfDaySection from "@/components/daily-assessment/EndOfDaySection";
import OperatingSystemsSection from "@/components/daily-assessment/OperatingSystemsSection";
import EquipmentChecksSection from "@/components/daily-assessment/EquipmentChecksSection";
import StructureChecksSection from "@/components/daily-assessment/StructureChecksSection";
import EnvironmentChecksSection from "@/components/daily-assessment/EnvironmentChecksSection";
import { HtmlReportViewer } from "@/components/HtmlReportViewer";
import { openHtmlReport } from "@/lib/html-report-viewer";
import { triggerCompletionConfetti } from "@/lib/confetti";
import { triggerHaptic } from "@/lib/haptics";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SwipeBackIndicator } from "@/components/SwipeBackIndicator";
import { toast } from "sonner";

import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useSaveShortcut } from "@/hooks/useKeyboardShortcuts";
import { useEmptyReportCleanup } from "@/hooks/useEmptyReportCleanup";

export default function DailyAssessmentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { formConfig, isLoading: isLoadingConfig } = useFormConfiguration('en', 'daily_assessment');
  const { isOnline } = useNetworkStatus();
  const isMobileView = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [generating, setGenerating] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);
  const [beginningOfDay, setBeginningOfDay] = useState<any[]>([]);
  const [endOfDay, setEndOfDay] = useState<any[]>([]);
  const [operatingSystems, setOperatingSystems] = useState<any[]>([]);
  const [equipmentChecks, setEquipmentChecks] = useState<any[]>([]);
  const [structureChecks, setStructureChecks] = useState<any[]>([]);
  const [environmentChecks, setEnvironmentChecks] = useState<any[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  
  // Tab navigation state
  const [currentTab, setCurrentTab] = useState("beginning");
  const tabOrder = ["beginning", "end", "systems", "equipment", "structure", "environment"];
  
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
    message: "You have unsaved changes to this assessment. Are you sure you want to leave?",
  });

  // Empty report cleanup
  const { cleanupEmptyReport } = useEmptyReportCleanup({
    type: 'daily_assessment',
    id,
    status: assessment?.status,
    data: assessment,
    relatedData: {
      beginningOfDay,
      endOfDay,
      operatingSystems,
      equipmentChecks,
      structureChecks,
      environmentChecks,
    }
  });

  // Cleanup empty reports on unmount
  useEffect(() => {
    return () => {
      if (assessment?.status === 'draft') {
        cleanupEmptyReport();
      }
    };
  }, [assessment?.status, cleanupEmptyReport]);

  // Fetch current user and profile
  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('avatar_url, first_name, last_name')
          .eq('id', user.id)
          .single();
        setUserProfile(profile);
      }
    };
    fetchUser();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  // Keyboard shortcut ref for save (actual function set later)  
  const saveRef = useRef<(() => void) | null>(null);
  useSaveShortcut(() => saveRef.current?.(), hasUnsavedChanges && !saving);

  useEffect(() => {
    loadAssessment();
  }, [id]);

  const loadAssessment = async () => {
    try {
      // Try loading from offline storage first
      const { getOfflineDailyAssessment, getAssessmentDataOffline } = await import('@/lib/offline-storage');
      const offlineAssessment = await getOfflineDailyAssessment(id!);
      
      if (offlineAssessment) {
        setAssessment(offlineAssessment);
        
        // Load related data from offline storage
        const [bodData, eodData, osData, eqData, stData, envData] = await Promise.all([
          getAssessmentDataOffline('beginning_of_day', id!),
          getAssessmentDataOffline('end_of_day', id!),
          getAssessmentDataOffline('operating_systems', id!),
          getAssessmentDataOffline('equipment_checks', id!),
          getAssessmentDataOffline('structure_checks', id!),
          getAssessmentDataOffline('environment_checks', id!),
        ]);

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
      }

      // If online, fetch from Supabase
      if (navigator.onLine) {
        const { data: assessmentData, error: assessmentError } = await supabase
          .from('daily_assessments')
          .select('*')
          .eq('id', id)
          .single();

        if (assessmentError) throw assessmentError;
        setAssessment(assessmentData);

        // Load all related data
        const [bodData, eodData, osData, eqData, stData, envData] = await Promise.all([
          supabase.from('daily_assessment_beginning_of_day').select('*').eq('assessment_id', id),
          supabase.from('daily_assessment_end_of_day').select('*').eq('assessment_id', id),
          supabase.from('daily_assessment_operating_systems').select('*').eq('assessment_id', id),
          supabase.from('daily_assessment_equipment_checks').select('*').eq('assessment_id', id),
          supabase.from('daily_assessment_structure_checks').select('*').eq('assessment_id', id),
          supabase.from('daily_assessment_environment_checks').select('*').eq('assessment_id', id),
        ]);

        setBeginningOfDay(bodData.data || []);
        setEndOfDay(eodData.data || []);
        setOperatingSystems(osData.data || []);
        setEquipmentChecks(eqData.data || []);
        setStructureChecks(stData.data || []);
        setEnvironmentChecks(envData.data || []);
        
        // Save to offline storage
        const { saveDailyAssessmentOffline, saveAssessmentDataOffline } = await import('@/lib/offline-storage');
        await saveDailyAssessmentOffline(assessmentData);
        await Promise.all([
          saveAssessmentDataOffline('beginning_of_day', id!, bodData.data || []),
          saveAssessmentDataOffline('end_of_day', id!, eodData.data || []),
          saveAssessmentDataOffline('operating_systems', id!, osData.data || []),
          saveAssessmentDataOffline('equipment_checks', id!, eqData.data || []),
          saveAssessmentDataOffline('structure_checks', id!, stData.data || []),
          saveAssessmentDataOffline('environment_checks', id!, envData.data || []),
        ]);
      }
    } catch (error) {
      console.error('Error loading assessment:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAssessment = async (field: string, value: any) => {
    const updatedAssessment = { ...assessment, [field]: value, updated_at: new Date().toISOString() };
    setAssessment(updatedAssessment);
    setHasUnsavedChanges(true);
    try {
      // Save offline first
      const { saveDailyAssessmentOffline, queueAssessmentOperation } = await import('@/lib/offline-storage');
      await saveDailyAssessmentOffline(updatedAssessment);

      if (navigator.onLine) {
        const { error } = await supabase
          .from('daily_assessments')
          .update({ [field]: value, updated_at: updatedAssessment.updated_at })
          .eq('id', id);

        if (error) throw error;

        // Update synced_at
        updatedAssessment.synced_at = new Date().toISOString();
        await saveDailyAssessmentOffline(updatedAssessment);
        setLastSaved(new Date());
      } else {
        // Queue for sync
        await queueAssessmentOperation('update', id!, updatedAssessment);
      }
    } catch (error) {
      console.error('Error updating assessment:', error);
      const { queueAssessmentOperation } = await import('@/lib/offline-storage');
      await queueAssessmentOperation('update', id!, updatedAssessment);
    }
  };

  // Save progress without completing - keeps status as draft
  const handleSaveProgress = async () => {
    setSaving(true);
    try {
      const { saveDailyAssessmentOffline, saveAssessmentDataOffline, queueAssessmentOperation } = await import('@/lib/offline-storage');
      
      // Save related data offline
      await Promise.all([
        saveAssessmentDataOffline('beginning_of_day', id!, beginningOfDay),
        saveAssessmentDataOffline('end_of_day', id!, endOfDay),
        saveAssessmentDataOffline('operating_systems', id!, operatingSystems),
        saveAssessmentDataOffline('equipment_checks', id!, equipmentChecks),
        saveAssessmentDataOffline('structure_checks', id!, structureChecks),
        saveAssessmentDataOffline('environment_checks', id!, environmentChecks),
      ]);

      // Save assessment without changing status
      const updatedAssessment = { ...assessment, updated_at: new Date().toISOString() };
      await saveDailyAssessmentOffline(updatedAssessment);

      if (navigator.onLine) {
        try {
          // Use upsert with onConflict to prevent duplicates
          const upsertResults = await Promise.all([
            beginningOfDay.length > 0 
              ? supabase.from('daily_assessment_beginning_of_day').upsert(
                  beginningOfDay.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })),
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
            endOfDay.length > 0 
              ? supabase.from('daily_assessment_end_of_day').upsert(
                  endOfDay.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })),
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
            operatingSystems.length > 0 
              ? supabase.from('daily_assessment_operating_systems').upsert(
                  operatingSystems.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })),
                  { onConflict: 'assessment_id,system_name' }
                )
              : { error: null, data: null },
            equipmentChecks.length > 0 
              ? supabase.from('daily_assessment_equipment_checks').upsert(
                  equipmentChecks.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })),
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
            structureChecks.length > 0 
              ? supabase.from('daily_assessment_structure_checks').upsert(
                  structureChecks.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })),
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
            environmentChecks.length > 0 
              ? supabase.from('daily_assessment_environment_checks').upsert(
                  environmentChecks.map(item => ({ 
                    ...item, 
                    assessment_id: id,
                    id: item.id || crypto.randomUUID()
                  })),
                  { onConflict: 'assessment_id,item_key' }
                )
              : { error: null, data: null },
          ]);

          // Check for errors in any upsert
          const errors = upsertResults.filter(r => r.error);
          if (errors.length > 0) {
            console.error('Upsert errors:', errors.map(e => e.error));
            throw new Error(`Failed to save ${errors.length} section(s)`);
          }

          // Update assessment (keep current status)
          const { error: assessmentError } = await supabase
            .from('daily_assessments')
            .update({ updated_at: updatedAssessment.updated_at })
            .eq('id', id);

          if (assessmentError) {
            console.error('Assessment update error:', assessmentError);
            throw assessmentError;
          }

          // Update synced_at
          updatedAssessment.synced_at = new Date().toISOString();
          await saveDailyAssessmentOffline(updatedAssessment);
        } catch (error) {
          console.error('Error syncing to database:', error);
          await queueAssessmentOperation('update', id!, updatedAssessment);
          toast.warning("Saved locally, will sync when connection improves");
        }
      } else {
        await queueAssessmentOperation('update', id!, updatedAssessment);
      }

      setHasUnsavedChanges(false);
      setLastSaved(new Date());
      setAssessment(updatedAssessment);
      toast.success("Progress saved");
    } catch (error) {
      console.error('Error saving progress:', error);
      toast.error("Failed to save progress");
    } finally {
      setSaving(false);
    }
  };

  // Submit and complete the assessment
  const handleSubmit = async () => {
    setSubmitting(true);
    setShowSubmitDialog(false);
    try {
      const { saveDailyAssessmentOffline, saveAssessmentDataOffline, queueAssessmentOperation } = await import('@/lib/offline-storage');
      
      // Save related data offline
      await Promise.all([
        saveAssessmentDataOffline('beginning_of_day', id!, beginningOfDay),
        saveAssessmentDataOffline('end_of_day', id!, endOfDay),
        saveAssessmentDataOffline('operating_systems', id!, operatingSystems),
        saveAssessmentDataOffline('equipment_checks', id!, equipmentChecks),
        saveAssessmentDataOffline('structure_checks', id!, structureChecks),
        saveAssessmentDataOffline('environment_checks', id!, environmentChecks),
      ]);

      // Update assessment status to completed
      const wasAlreadyCompleted = assessment?.status === 'completed';
      const completedAssessment = { ...assessment, status: 'completed', updated_at: new Date().toISOString() };
      await saveDailyAssessmentOffline(completedAssessment);

      // Trigger celebration on first completion
      if (!wasAlreadyCompleted) {
        triggerCompletionConfetti();
        triggerHaptic('success');
      }

      if (navigator.onLine) {
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
                })),
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
                })),
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
                })),
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
                })),
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
                })),
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
                })),
                { onConflict: 'assessment_id,item_key' }
              )
            );
          }

          await Promise.all(upserts);

          // Update status to completed
          await supabase
            .from('daily_assessments')
            .update({ status: 'completed', updated_at: completedAssessment.updated_at })
            .eq('id', id);

          // Update synced_at
          completedAssessment.synced_at = new Date().toISOString();
          await saveDailyAssessmentOffline(completedAssessment);
        } catch (error) {
          console.error('Error syncing to database:', error);
          await queueAssessmentOperation('update', id!, completedAssessment);
        }
      } else {
        await queueAssessmentOperation('update', id!, completedAssessment);
      }

      setHasUnsavedChanges(false);
      toast.success("Assessment submitted successfully");
      navigate('/dashboard');
    } catch (error) {
      console.error('Error submitting assessment:', error);
      toast.error("Failed to submit assessment");
    } finally {
      setSubmitting(false);
    }
  };

  // Set save ref for keyboard shortcut (save progress, not submit)
  useEffect(() => {
    saveRef.current = handleSaveProgress;
  });

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-daily-assessment-html', {
        body: { assessmentId: id },
      });

      if (error) throw error;

      const html = data.html;
      const filename = `daily-assessment-${assessment?.site || 'report'}-${new Date().toISOString().split('T')[0]}.html`;
      const title = `Daily Assessment - ${assessment?.site || 'Report'}`;

      // Try to open in new window (desktop)
      const opened = openHtmlReport({ html, filename, title });

      // If failed (mobile/PWA/popup blocked), use in-app viewer
      if (!opened) {
        setReportHtml(html);
        setViewerOpen(true);
      }
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
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
            <AlertDialogAction onClick={handleSubmit}>
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
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
              <AutoSaveIndicator
                lastSaved={lastSaved}
                isSaving={saving}
                hasUnsavedChanges={hasUnsavedChanges}
                className="hidden sm:flex"
              />
            </div>
            
            <div className="flex items-center gap-2">
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
                    {isMobileView ? "" : "Report"}
                  </>
                )}
              </Button>
              <Button 
                variant="outline"
                size={isMobileView ? "default" : "sm"} 
                onClick={handleSaveProgress} 
                disabled={saving || submitting}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Save className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                    <span>{isMobileView ? "Save" : "Save Progress"}</span>
                  </>
                )}
              </Button>
              <Button 
                size={isMobileView ? "default" : "sm"} 
                onClick={() => setShowSubmitDialog(true)} 
                disabled={saving || submitting}
                className={isMobileView ? "min-w-[90px] h-10 text-sm font-medium" : ""}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <SendHorizonal className={isMobileView ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                    <span>Submit</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>
      
      <div className="container mx-auto px-4 py-4 lg:py-8 max-w-5xl">

      <div className="space-y-6">
        <DailyAssessmentHeader assessment={assessment} onUpdate={handleUpdateAssessment} />

        {/* Swipe back indicator for mobile */}
        {isMobileView && isFirstTab && (
          <SwipeBackIndicator 
            progress={swipeState.swipeProgress} 
            isActive={swipeState.isSwipingBack} 
          />
        )}

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
          <div ref={swipeContainerRef}>
            <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6 gap-1 lg:gap-0 h-auto p-1.5 lg:p-1">
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
            </TabsList>
          </div>

          <TabsContent value="beginning" className="space-y-4 mt-4">
            <BeginningOfDaySection 
              items={beginningOfDay} 
              onUpdate={setBeginningOfDay} 
            />
          </TabsContent>

          <TabsContent value="end" className="space-y-4 mt-4">
            <EndOfDaySection 
              items={endOfDay} 
              onUpdate={setEndOfDay} 
            />
          </TabsContent>

          <TabsContent value="systems" className="space-y-4 mt-4">
            <OperatingSystemsSection 
              systems={operatingSystems} 
              onUpdate={setOperatingSystems} 
            />
          </TabsContent>

          <TabsContent value="equipment" className="space-y-4 mt-4">
            <EquipmentChecksSection 
              checks={equipmentChecks} 
              onUpdate={setEquipmentChecks} 
            />
          </TabsContent>

          <TabsContent value="structure" className="space-y-4 mt-4">
            <StructureChecksSection 
              checks={structureChecks} 
              onUpdate={setStructureChecks} 
            />
          </TabsContent>

          <TabsContent value="environment" className="space-y-4 mt-4">
            <EnvironmentChecksSection 
              checks={environmentChecks} 
              onUpdate={setEnvironmentChecks} 
            />
          </TabsContent>
        </Tabs>
      </div>
      </div>

      <HtmlReportViewer
        html={reportHtml}
        title={`Daily Assessment - ${assessment?.site || 'Report'}`}
        filename={`daily-assessment-${assessment?.site || 'report'}-${new Date().toISOString().split('T')[0]}.html`}
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />

      </div>
    </>
  );
}
