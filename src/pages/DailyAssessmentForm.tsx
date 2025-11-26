import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
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

export default function DailyAssessmentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);
  const [beginningOfDay, setBeginningOfDay] = useState<any[]>([]);
  const [endOfDay, setEndOfDay] = useState<any[]>([]);
  const [operatingSystems, setOperatingSystems] = useState<any[]>([]);
  const [equipmentChecks, setEquipmentChecks] = useState<any[]>([]);
  const [structureChecks, setStructureChecks] = useState<any[]>([]);
  const [environmentChecks, setEnvironmentChecks] = useState<any[]>([]);

  useEffect(() => {
    loadAssessment();
  }, [id]);

  const loadAssessment = async () => {
    try {
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
    } catch (error) {
      console.error('Error loading assessment:', error);
      toast({
        title: "Error",
        description: "Failed to load assessment",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAssessment = async (field: string, value: any) => {
    const updatedAssessment = { ...assessment, [field]: value };
    setAssessment(updatedAssessment);
    
    try {
      const { error } = await supabase
        .from('daily_assessments')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating assessment:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
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
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', id);

      toast({
        title: "Success",
        description: "Assessment saved successfully",
      });

      navigate('/dashboard');
    } catch (error) {
      console.error('Error saving assessment:', error);
      toast({
        title: "Error",
        description: "Failed to save assessment",
        variant: "destructive",
      });
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

      // Open HTML in new tab
      const htmlBlob = new Blob([data.html], { type: 'text/html' });
      const htmlUrl = URL.createObjectURL(htmlBlob);
      window.open(htmlUrl, '_blank');

      toast({
        title: "Success",
        description: "Report generated successfully",
      });
    } catch (error) {
      console.error('Error generating report:', error);
      toast({
        title: "Error",
        description: "Failed to generate report",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
        <div className="flex gap-2">
          <Button onClick={handleGenerateReport} disabled={generating} variant="outline">
            <FileText className="mr-2 h-4 w-4" />
            {generating ? 'Generating...' : 'Generate Report'}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving...' : 'Save & Complete'}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <DailyAssessmentHeader assessment={assessment} onUpdate={handleUpdateAssessment} />

        <Tabs defaultValue="beginning" className="w-full">
          <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
            <TabsTrigger value="beginning">Beginning</TabsTrigger>
            <TabsTrigger value="end">End of Day</TabsTrigger>
            <TabsTrigger value="systems">Systems</TabsTrigger>
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
            <TabsTrigger value="structure">Structure</TabsTrigger>
            <TabsTrigger value="environment">Environment</TabsTrigger>
          </TabsList>

          <TabsContent value="beginning" className="space-y-4 mt-4">
            <BeginningOfDaySection items={beginningOfDay} onUpdate={setBeginningOfDay} />
          </TabsContent>

          <TabsContent value="end" className="space-y-4 mt-4">
            <EndOfDaySection items={endOfDay} onUpdate={setEndOfDay} />
          </TabsContent>

          <TabsContent value="systems" className="space-y-4 mt-4">
            <OperatingSystemsSection systems={operatingSystems} onUpdate={setOperatingSystems} />
          </TabsContent>

          <TabsContent value="equipment" className="space-y-4 mt-4">
            <EquipmentChecksSection checks={equipmentChecks} onUpdate={setEquipmentChecks} />
          </TabsContent>

          <TabsContent value="structure" className="space-y-4 mt-4">
            <StructureChecksSection checks={structureChecks} onUpdate={setStructureChecks} />
          </TabsContent>

          <TabsContent value="environment" className="space-y-4 mt-4">
            <EnvironmentChecksSection checks={environmentChecks} onUpdate={setEnvironmentChecks} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
