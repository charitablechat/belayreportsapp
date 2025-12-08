import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, FileDown, FileText, ChevronLeft, WifiOff, Wifi, Mail, CheckCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutoSaveIndicator } from "@/components/AutoSaveIndicator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import TrainingHeader from "@/components/training/TrainingHeader";
import DeliveryApproachSection from "@/components/training/DeliveryApproachSection";
import OperatingSystemsSection from "@/components/training/OperatingSystemsSection";
import ImmediateAttentionSection from "@/components/training/ImmediateAttentionSection";
import VerifiableItemsSection from "@/components/training/VerifiableItemsSection";
import TrainingSummarySection from "@/components/training/TrainingSummarySection";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SwipeBackIndicator } from "@/components/SwipeBackIndicator";
import { FloatingActionButton } from "@/components/ui/floating-action-button";
import { Check } from "lucide-react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useSaveShortcut } from "@/hooks/useKeyboardShortcuts";

export default function TrainingForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isGeneratingHTML, setIsGeneratingHTML] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
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
  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const [htmlViewerOpen, setHtmlViewerOpen] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>('');
  
  // Tab navigation state
  const [currentTab, setCurrentTab] = useState("info");
  const tabOrder = ["info", "delivery", "systems", "attention", "verifiable", "summary"];
  
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
        navigate('/dashboard');
      }
    },
  });

  // Unsaved changes protection
  const { isBlocked, confirmNavigation, cancelNavigation } = useUnsavedChanges({
    hasUnsavedChanges,
    message: "You have unsaved changes to this training report. Are you sure you want to leave?",
  });

  // Keyboard shortcut for save (Ctrl/Cmd+S)
  useSaveShortcut(() => saveTraining(), hasUnsavedChanges && !isSaving);

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
        // Try loading from offline storage first
        const offlineTraining = await getOfflineTraining(id);
        const [
          delivery_approaches,
          operating_systems,
          immediate_attention,
          verifiable_items,
          systems_in_place,
          summary
        ] = await Promise.all([
          getTrainingDataOffline('delivery_approaches', id),
          getTrainingDataOffline('operating_systems', id),
          getTrainingDataOffline('immediate_attention', id),
          getTrainingDataOffline('verifiable_items', id),
          getTrainingDataOffline('systems_in_place', id),
          getTrainingDataOffline('summary', id).then(d => d[0])
        ]);

        if (offlineTraining) {
          setTraining(offlineTraining);
          setDeliveryApproaches(delivery_approaches || []);
          setOperatingSystems(operating_systems || []);
          setImmediateAttention(immediate_attention || []);
          setVerifiableItems(verifiable_items || []);
          setSystemsInPlace(systems_in_place || []);
          setSummary(summary || { training_id: id });
        }

        // If online, fetch from Supabase and update offline storage
        if (isOnline) {
          const { data: trainingData, error: trainingError } = await supabase
            .from('trainings')
            .select('*')
            .eq('id', id)
            .single();

          if (!trainingError && trainingData) {
            setTraining(trainingData);
            await saveTrainingOffline(trainingData);

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

            // Save related data offline
            await Promise.all([
              saveTrainingDataOffline('delivery_approaches', id, approachData || []),
              saveTrainingDataOffline('operating_systems', id, systemData || []),
              saveTrainingDataOffline('immediate_attention', id, attentionData || []),
              saveTrainingDataOffline('verifiable_items', id, verifiableData || []),
              saveTrainingDataOffline('systems_in_place', id, systemsPlaceData || []),
              summaryData && saveTrainingDataOffline('summary', id, summaryData)
            ]);
          }
        }
      } catch (error) {
        console.error('Error loading training:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTraining();
  }, [id, isOnline]);

  // Auto-save functionality
  const saveTraining = useCallback(async () => {
    if (!training || !id) return;

    setIsSaving(true);
    try {
      const updatedTraining = {
        ...training,
        updated_at: new Date().toISOString(),
      };

      // Save offline first
      await saveTrainingOffline(updatedTraining);
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
          // Update main training record with synced_at
          const syncedTraining = {
            ...updatedTraining,
            synced_at: new Date().toISOString(),
          };
          const { error: trainingError } = await supabase
            .from('trainings')
            .update(syncedTraining)
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

          await saveTrainingOffline({
            ...updatedTraining,
            synced_at: new Date().toISOString()
          });
        } catch (error) {
          console.log('[Offline] Failed to sync, queuing operation');
          await queueTrainingOperation('update', id, updatedTraining);
        }
      } else {
        // Queue for later sync
        await queueTrainingOperation('update', id, updatedTraining);
      }

      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Error saving training:', error);
    } finally {
      setIsSaving(false);
    }
  }, [training, id, deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, isOnline]);

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
    
    try {
      await saveTraining();
      
      const { data, error } = await supabase.functions.invoke('generate-training-html', {
        body: { trainingId: id }
      });
      
      if (error) throw error;
      
      const html = data.html;
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
      console.error('Error generating HTML:', error);
    } finally {
      setIsGeneratingHTML(false);
    }
  };

  const completeTraining = useCallback(async () => {
    if (!training || !id) return;

    setIsSaving(true);
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

          // Delete and re-insert all related records
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

          await saveTrainingOffline({
            ...completedTraining,
            synced_at: new Date().toISOString()
          });
        } catch (error) {
          console.log('[Offline] Failed to sync, queuing operation');
          await queueTrainingOperation('update', id, completedTraining);
        }
      } else {
        // Queue for later sync
        await queueTrainingOperation('update', id, completedTraining);
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
        message="You have unsaved changes to this training report. Are you sure you want to leave?"
      />
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
              <AutoSaveIndicator
                lastSaved={lastSaved}
                isSaving={isSaving}
                hasUnsavedChanges={hasUnsavedChanges}
              />
              <Button
                onClick={saveTraining}
                disabled={isSaving || !isOnline}
                variant="outline"
              >
                {isSaving ? (
                  <>
                    <Loader2 className={isMobile ? "h-4 w-4 animate-spin" : "mr-2 h-4 w-4 animate-spin"} />
                    {!isMobile && "Saving..."}
                    {isMobile && "..."}
                  </>
                ) : (
                  <>
                    <Save className={isMobile ? "h-4 w-4" : "mr-2 h-4 w-4"} />
                    {!isMobile && "Save"}
                  </>
                )}
              </Button>
              <Button
                onClick={completeTraining}
                disabled={isSaving || !isOnline}
              >
                {isSaving ? (
                  <>
                    <Loader2 className={isMobile ? "h-4 w-4 animate-spin" : "mr-2 h-4 w-4 animate-spin"} />
                    {isMobile ? "..." : "Completing..."}
                  </>
                ) : (
                  <>
                    <CheckCircle className={isMobile ? "h-4 w-4" : "mr-2 h-4 w-4"} />
                    {isMobile ? "Complete" : "Complete & Submit"}
                  </>
                )}
              </Button>
              {/* PDF Button - Hidden but code preserved for future use
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
              */}
              
              <Button
                onClick={handleGenerateHTML}
                disabled={isGeneratingHTML || !isOnline}
                variant="outline"
              >
                {isGeneratingHTML ? (
                  <>
                    <Loader2 className={isMobile ? "h-4 w-4 animate-spin" : "mr-2 h-4 w-4 animate-spin"} />
                    {isMobile ? "..." : "Generating..."}
                  </>
                ) : (
                  <>
                    <FileText className={isMobile ? "h-4 w-4" : "mr-2 h-4 w-4"} />
                    {isMobile ? "Report" : "Generate Report"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Swipe back indicator for mobile */}
        {isMobile && isFirstTab && (
          <SwipeBackIndicator 
            progress={swipeState.swipeProgress} 
            isActive={swipeState.isSwipingBack} 
          />
        )}

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-6">
          <div ref={swipeContainerRef}>
            <TabsList className="grid w-full grid-cols-4 lg:grid-cols-6">
              <TabsTrigger value="info">Info</TabsTrigger>
              <TabsTrigger value="delivery">{isMobile ? "Format" : "Training Format"}</TabsTrigger>
              <TabsTrigger value="systems">{isMobile ? "OS" : "Trained OS"}</TabsTrigger>
              <TabsTrigger value="attention">{isMobile ? "Actions" : "Required Actions"}</TabsTrigger>
              <TabsTrigger value="verifiable">{isMobile ? "Verified" : "Verified During Training"}</TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
            </TabsList>
          </div>

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
      />

      {/* Mobile FAB */}
      <FloatingActionButton
        primaryAction={{
          icon: <Save className="h-6 w-6" />,
          label: "Save",
          onClick: saveTraining,
          loading: isSaving,
          disabled: isSaving,
        }}
        secondaryActions={
          training.status !== "completed"
            ? [
                {
                  icon: <Check className="h-5 w-5" />,
                  label: "Complete",
                  onClick: completeTraining,
                  disabled: isSaving,
                  variant: "success" as const,
                },
              ]
            : []
        }
      />
      </div>
    </>
  );
}
