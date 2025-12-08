import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useFormConfiguration } from "@/hooks/useFormConfiguration";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, FileText, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { FloatingActionButton } from "@/components/ui/floating-action-button";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";

export default function DailyAssessmentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { formConfig, isLoading: isLoadingConfig } = useFormConfiguration('en', 'daily_assessment');
  const isMobileView = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
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
  
  // Tab navigation state
  const [currentTab, setCurrentTab] = useState("beginning");
  const tabOrder = ["beginning", "end", "systems", "equipment", "structure", "environment"];
  
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

  // Unsaved changes protection
  const { isBlocked, confirmNavigation, cancelNavigation } = useUnsavedChanges({
    hasUnsavedChanges,
    message: "You have unsaved changes to this assessment. Are you sure you want to leave?",
  });

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

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save all data offline first
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

      // Update assessment status
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
          // Delete existing related records
          await Promise.all([
            supabase.from('daily_assessment_beginning_of_day').delete().eq('assessment_id', id),
            supabase.from('daily_assessment_end_of_day').delete().eq('assessment_id', id),
            supabase.from('daily_assessment_operating_systems').delete().eq('assessment_id', id),
            supabase.from('daily_assessment_equipment_checks').delete().eq('assessment_id', id),
            supabase.from('daily_assessment_structure_checks').delete().eq('assessment_id', id),
            supabase.from('daily_assessment_environment_checks').delete().eq('assessment_id', id),
          ]);

          // Insert new records
          const inserts = [];
          if (beginningOfDay.length > 0) {
            inserts.push(
              supabase.from('daily_assessment_beginning_of_day').insert(
                beginningOfDay.map(item => ({ ...item, assessment_id: id }))
              )
            );
          }
          if (endOfDay.length > 0) {
            inserts.push(
              supabase.from('daily_assessment_end_of_day').insert(
                endOfDay.map(item => ({ ...item, assessment_id: id }))
              )
            );
          }
          if (operatingSystems.length > 0) {
            inserts.push(
              supabase.from('daily_assessment_operating_systems').insert(
                operatingSystems.map(item => ({ ...item, assessment_id: id }))
              )
            );
          }
          if (equipmentChecks.length > 0) {
            inserts.push(
              supabase.from('daily_assessment_equipment_checks').insert(
                equipmentChecks.map(item => ({ ...item, assessment_id: id }))
              )
            );
          }
          if (structureChecks.length > 0) {
            inserts.push(
              supabase.from('daily_assessment_structure_checks').insert(
                structureChecks.map(item => ({ ...item, assessment_id: id }))
              )
            );
          }
          if (environmentChecks.length > 0) {
            inserts.push(
              supabase.from('daily_assessment_environment_checks').insert(
                environmentChecks.map(item => ({ ...item, assessment_id: id }))
              )
            );
          }

          await Promise.all(inserts);

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
          // Queue for sync
          await queueAssessmentOperation('update', id!, completedAssessment);
        }
      } else {
        // Queue for sync
        await queueAssessmentOperation('update', id!, completedAssessment);
      }
      setHasUnsavedChanges(false);
      navigate('/dashboard');
    } catch (error) {
      console.error('Error saving assessment:', error);
    } finally {
      setSaving(false);
    }
  };

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
      <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className={isMobileView ? "h-4 w-4" : "mr-2 h-4 w-4"} />
          {!isMobileView && "Back to Dashboard"}
        </Button>
        <div className="flex gap-2">
          <Button onClick={handleGenerateReport} disabled={generating} variant="outline">
            <FileText className={isMobileView ? "h-4 w-4" : "mr-2 h-4 w-4"} />
            {generating ? (isMobileView ? '...' : 'Generating...') : (isMobileView ? 'Report' : 'Generate Report')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className={isMobileView ? "h-4 w-4" : "mr-2 h-4 w-4"} />
            {saving ? (isMobileView ? '...' : 'Saving...') : (isMobileView ? 'Save' : 'Save & Complete')}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <DailyAssessmentHeader assessment={assessment} onUpdate={handleUpdateAssessment} />

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
          <div ref={swipeContainerRef}>
            <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
              <TabsTrigger value="beginning">Beginning</TabsTrigger>
              <TabsTrigger value="end">{isMobileView ? "End" : "End of Day"}</TabsTrigger>
              <TabsTrigger value="systems">Systems</TabsTrigger>
              <TabsTrigger value="equipment">Equipment</TabsTrigger>
              <TabsTrigger value="structure">Structure</TabsTrigger>
              <TabsTrigger value="environment">Environment</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="beginning" className="space-y-4 mt-4">
            {beginningSection && (
              <BeginningOfDaySection 
                section={beginningSection}
                items={beginningOfDay} 
                onUpdate={setBeginningOfDay} 
              />
            )}
          </TabsContent>

          <TabsContent value="end" className="space-y-4 mt-4">
            {endSection && (
              <EndOfDaySection 
                section={endSection}
                items={endOfDay} 
                onUpdate={setEndOfDay} 
              />
            )}
          </TabsContent>

          <TabsContent value="systems" className="space-y-4 mt-4">
            {systemsSection && (
              <OperatingSystemsSection 
                section={systemsSection}
                systems={operatingSystems} 
                onUpdate={setOperatingSystems} 
              />
            )}
          </TabsContent>

          <TabsContent value="equipment" className="space-y-4 mt-4">
            {equipmentSection && (
              <EquipmentChecksSection 
                section={equipmentSection}
                checks={equipmentChecks} 
                onUpdate={setEquipmentChecks} 
              />
            )}
          </TabsContent>

          <TabsContent value="structure" className="space-y-4 mt-4">
            {structureSection && (
              <StructureChecksSection 
                section={structureSection}
                checks={structureChecks} 
                onUpdate={setStructureChecks} 
              />
            )}
          </TabsContent>

          <TabsContent value="environment" className="space-y-4 mt-4">
            {environmentSection && (
              <EnvironmentChecksSection 
                section={environmentSection}
                checks={environmentChecks} 
                onUpdate={setEnvironmentChecks} 
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <HtmlReportViewer
        html={reportHtml}
        title={`Daily Assessment - ${assessment?.site || 'Report'}`}
        filename={`daily-assessment-${assessment?.site || 'report'}-${new Date().toISOString().split('T')[0]}.html`}
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />

      {/* Mobile FAB */}
      <FloatingActionButton
        primaryAction={{
          icon: <Save className="h-6 w-6" />,
          label: "Save",
          onClick: handleSave,
          loading: saving,
          disabled: saving,
        }}
      />
      </div>
    </>
  );
}
