import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, FileDown, ChevronLeft, WifiOff, Wifi } from "lucide-react";
import TrainingHeader from "@/components/training/TrainingHeader";
import DeliveryApproachSection from "@/components/training/DeliveryApproachSection";
import OperatingSystemsSection from "@/components/training/OperatingSystemsSection";
import ImmediateAttentionSection from "@/components/training/ImmediateAttentionSection";
import VerifiableItemsSection from "@/components/training/VerifiableItemsSection";
import TrainingSummarySection from "@/components/training/TrainingSummarySection";
import PhotoGallery from "@/components/PhotoGallery";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { format } from "date-fns";

export default function TrainingForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [training, setTraining] = useState<any>(null);
  const [deliveryApproaches, setDeliveryApproaches] = useState<any[]>([]);
  const [operatingSystems, setOperatingSystems] = useState<any[]>([]);
  const [immediateAttention, setImmediateAttention] = useState<any[]>([]);
  const [verifiableItems, setVerifiableItems] = useState<any[]>([]);
  const [systemsInPlace, setSystemsInPlace] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);

  // Auto-populate person submitting and submission date
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', user.id)
          .single();

        if (profile && summary) {
          const updates: any = {};
          
          // Auto-populate person submitting if empty
          if (!summary.person_submitting) {
            const fullName = [profile.first_name, profile.last_name]
              .filter(Boolean)
              .join(' ');
            
            if (fullName) {
              updates.person_submitting = fullName;
            }
          }
          
          // Auto-populate submission date if empty
          if (!summary.submission_date) {
            updates.submission_date = format(new Date(), 'yyyy-MM-dd');
          }
          
          // Only update if there are changes
          if (Object.keys(updates).length > 0) {
            setSummary({ ...summary, ...updates });
          }
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    };

    if (summary && !isLoading) {
      fetchUserProfile();
    }
  }, [summary?.id, isLoading]);

  // Load training data
  useEffect(() => {
    const loadTraining = async () => {
      if (!id) return;

      try {
        const { data: trainingData, error: trainingError } = await supabase
          .from('trainings')
          .select('*')
          .eq('id', id)
          .single();

        if (trainingError) throw trainingError;

        setTraining(trainingData);

        // Load all related data
        const [
          { data: approachData },
          { data: systemData },
          { data: attentionData },
          { data: verifiableData },
          { data: systemsPlaceData },
          { data: summaryData }
        ] = await Promise.all([
          supabase.from('training_delivery_approaches').select('*').eq('training_id', id),
          supabase.from('training_operating_systems').select('*').eq('training_id', id),
          supabase.from('training_immediate_attention').select('*').eq('training_id', id),
          supabase.from('training_verifiable_items').select('*').eq('training_id', id),
          supabase.from('training_systems_in_place').select('*').eq('training_id', id),
          supabase.from('training_summary').select('*').eq('training_id', id).single()
        ]);

        setDeliveryApproaches(approachData || []);
        setOperatingSystems(systemData || []);
        setImmediateAttention(attentionData || []);
        setVerifiableItems(verifiableData || []);
        setSystemsInPlace(systemsPlaceData || []);
        setSummary(summaryData || { training_id: id });

      } catch (error) {
        console.error('Error loading training:', error);
        toast({
          title: "Error",
          description: "Failed to load training report",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadTraining();
  }, [id, toast]);

  // Auto-save functionality
  const saveTraining = useCallback(async () => {
    if (!training || !id) return;

    setIsSaving(true);
    try {
      // Update main training record
      const { error: trainingError } = await supabase
        .from('trainings')
        .update({
          ...training,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (trainingError) throw trainingError;

      // Delete and re-insert all related records for simplicity
      await Promise.all([
        supabase.from('training_delivery_approaches').delete().eq('training_id', id),
        supabase.from('training_operating_systems').delete().eq('training_id', id),
        supabase.from('training_immediate_attention').delete().eq('training_id', id),
        supabase.from('training_verifiable_items').delete().eq('training_id', id),
        supabase.from('training_systems_in_place').delete().eq('training_id', id),
      ]);

      // Insert new records
      const insertPromises = [];
      
      if (deliveryApproaches.length > 0) {
        insertPromises.push(
          supabase.from('training_delivery_approaches').insert(
            deliveryApproaches.map(a => ({ ...a, training_id: id }))
          )
        );
      }

      if (operatingSystems.length > 0) {
        insertPromises.push(
          supabase.from('training_operating_systems').insert(
            operatingSystems.map(s => ({ ...s, training_id: id }))
          )
        );
      }

      if (immediateAttention.length > 0) {
        insertPromises.push(
          supabase.from('training_immediate_attention').insert(
            immediateAttention.map(i => ({ ...i, training_id: id }))
          )
        );
      }

      if (verifiableItems.length > 0) {
        insertPromises.push(
          supabase.from('training_verifiable_items').insert(
            verifiableItems.map(v => ({ ...v, training_id: id }))
          )
        );
      }

      if (systemsInPlace.length > 0) {
        insertPromises.push(
          supabase.from('training_systems_in_place').insert(
            systemsInPlace.map(s => ({ ...s, training_id: id }))
          )
        );
      }

      await Promise.all(insertPromises);

      // Update or insert summary
      if (summary) {
        const { data: existingSummary } = await supabase
          .from('training_summary')
          .select('id')
          .eq('training_id', id)
          .single();

        if (existingSummary) {
          await supabase
            .from('training_summary')
            .update(summary)
            .eq('training_id', id);
        } else {
          await supabase
            .from('training_summary')
            .insert({ ...summary, training_id: id });
        }
      }

      setLastSaved(new Date());
    } catch (error) {
      console.error('Error saving training:', error);
      toast({
        title: "Error",
        description: "Failed to save training report",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [training, id, deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, toast]);

  // Setup auto-save
  useEffect(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }

    autoSaveTimer.current = setTimeout(() => {
      if (isOnline && training) {
        saveTraining();
      }
    }, 30000); // Auto-save every 30 seconds

    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
    };
  }, [training, deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, isOnline, saveTraining]);

  const handleGeneratePDF = async () => {
    if (!id) return;

    setIsGeneratingPDF(true);
    try {
      // Save before generating PDF
      await saveTraining();

      const { data, error } = await supabase.functions.invoke('generate-training-pdf', {
        body: { trainingId: id }
      });

      if (error) throw error;

      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
        toast({
          title: "Success",
          description: "Training report PDF generated successfully",
        });
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: "Error",
        description: "Failed to generate PDF report",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const updateTrainingField = (field: string, value: any) => {
    setTraining({ ...training, [field]: value });
  };

  const updateSummaryField = (field: string, value: any) => {
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
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/dashboard')}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Training Report</h1>
                <p className="text-sm text-muted-foreground">
                  {training?.organization || 'New Training Report'}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {!isOnline && (
                <Badge variant="secondary" className="gap-1">
                  <WifiOff className="h-3 w-3" />
                  Offline
                </Badge>
              )}
              {isOnline && (
                <Badge variant="secondary" className="gap-1">
                  <Wifi className="h-3 w-3" />
                  Online
                </Badge>
              )}
              {lastSaved && (
                <span className="text-sm text-muted-foreground">
                  Saved {lastSaved.toLocaleTimeString()}
                </span>
              )}
              <Button
                onClick={saveTraining}
                disabled={isSaving || !isOnline}
                variant="outline"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save
                  </>
                )}
              </Button>
              <Button
                onClick={handleGeneratePDF}
                disabled={isGeneratingPDF || !isOnline}
              >
                {isGeneratingPDF ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="mr-2 h-4 w-4" />
                    Generate PDF
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <Tabs defaultValue="info" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="delivery">Training Format</TabsTrigger>
            <TabsTrigger value="systems">Systems</TabsTrigger>
            <TabsTrigger value="attention">Attention</TabsTrigger>
            <TabsTrigger value="verifiable">Verifiable</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="photos">Photos</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-6">
            <TrainingHeader training={training} onUpdate={updateTrainingField} />
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
            <PhotoGallery
              inspectionId={id || ''}
              section="training"
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
