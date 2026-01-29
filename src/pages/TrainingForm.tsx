import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, FileDown, FileText, ChevronLeft, WifiOff, Wifi, Mail, CheckCircle, Info, Users, Settings, AlertTriangle, ClipboardCheck, FileCheck, LogOut, User, CloudOff, ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ropeWorksLogo from "@/assets/rope-works-logo.png";

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
import { triggerValentineConfetti } from "@/lib/confetti";
import { triggerHaptic } from "@/lib/haptics";
import { useReportSync } from "@/hooks/useReportSync";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SwipeBackIndicator } from "@/components/SwipeBackIndicator";

import { Check } from "lucide-react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useSaveShortcut } from "@/hooks/useKeyboardShortcuts";
import { useEmptyReportCleanup } from "@/hooks/useEmptyReportCleanup";
import { useReportEditPermission } from "@/hooks/useReportEditPermission";

export default function TrainingForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const isMobile = useIsMobile();
  const { syncReport } = useReportSync(id, 'training');
  
  // Check edit permissions - Super Admins are view-only, only owners can edit
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const { canEdit, isReadOnly, isSuperAdmin, readOnlyReason } = useReportEditPermission({
    inspectorId,
    reportType: 'training'
  });
  
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
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  
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

  // Empty report cleanup
  const { cleanupEmptyReport } = useEmptyReportCleanup({
    type: 'training',
    id,
    status: training?.status,
    data: training,
    relatedData: {
      deliveryApproaches,
      operatingSystems,
      immediateAttention,
      verifiableItems,
      systemsInPlace,
      summary,
    }
  });

  // Cleanup empty reports on unmount
  useEffect(() => {
    return () => {
      // Only cleanup if navigating away without saving
      if (training?.status === 'draft') {
        cleanupEmptyReport();
      }
    };
  }, [training?.status, cleanupEmptyReport]);

  // Auto-retry on network reconnect is now handled by useAutoSync hook

  // Fetch current user
  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  // Fetch inspector profile (the report owner, not current user)
  useEffect(() => {
    const fetchInspectorProfile = async () => {
      if (!inspectorId) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_url, first_name, last_name')
        .eq('id', inspectorId)
        .single();
      setUserProfile(profile);
    };
    fetchInspectorProfile();
  }, [inspectorId]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

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
          setTraining(offlineTraining);
          setInspectorId(offlineTraining.inspector_id);
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
        }

        // If online, fetch from Supabase and update offline storage
        if (isOnline) {
          const { data: trainingData, error: trainingError } = await supabase
            .from('trainings')
            .select('*')
            .eq('id', id)
            .maybeSingle();

          // Handle training not found - redirect to dashboard
          if (!trainingData && !offlineTraining) {
            console.warn('[TrainingForm] Training not found:', id);
            toast({
              title: "Training not found",
              description: "This training may have been deleted or doesn't exist.",
              variant: "destructive",
            });
            navigate('/dashboard');
            return;
          }

          if (trainingError) throw trainingError;
          
          if (trainingData) {
            setTraining(trainingData);
            setInspectorId(trainingData.inspector_id);
            await saveTrainingOffline(trainingData);

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

            setDeliveryApproaches(approachData || []);
            setOperatingSystems(systemData || []);
            setImmediateAttention(attentionData || []);
            setVerifiableItems(verifiableData || []);
            setSystemsInPlace(systemsPlaceData || []);
            // Initialize summary with a proper UUID if not exists
            setSummary(summaryResult || { 
              id: crypto.randomUUID(),
              training_id: id 
            });

            // Save related data offline
            await Promise.all([
              saveTrainingDataOffline('delivery_approaches', id, approachData || []),
              saveTrainingDataOffline('operating_systems', id, systemData || []),
              saveTrainingDataOffline('immediate_attention', id, attentionData || []),
              saveTrainingDataOffline('verifiable_items', id, verifiableData || []),
              saveTrainingDataOffline('systems_in_place', id, systemsPlaceData || []),
              summaryResult && saveTrainingDataOffline('summary', id, summaryResult)
            ]);
          }
        } else if (!offlineTraining) {
          // Offline and no cached data
          toast({
            title: "Training not available offline",
            description: "Please connect to the internet to load this training.",
            variant: "destructive",
          });
          navigate('/dashboard');
          return;
        }
      } catch (error) {
        console.error('Error loading training:', error);
        toast({
          title: "Failed to load training",
          description: "An error occurred while loading the training.",
          variant: "destructive",
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
    if (!training || !id) return;

    // Prevent duplicate save calls
    if (saveInProgressRef.current) {
      console.log('[Training Save] Save already in progress, skipping');
      return;
    }

    console.log('[Training Save] Starting save...');
    saveInProgressRef.current = true;
    setIsSaving(true);

    // Safety timeout - ensure saving state is cleared after max 30 seconds
    const safetyTimeout = setTimeout(() => {
      console.warn('[Training Save] Safety timeout reached, forcing save state reset');
      setIsSaving(false);
      saveInProgressRef.current = false;
    }, 30000);

    try {
      const updatedTraining = {
        ...training,
        updated_at: new Date().toISOString(),
      };

      // Save offline first with timeout protection
      try {
        await Promise.race([
          Promise.all([
            saveTrainingOffline(updatedTraining),
            saveTrainingDataOffline('delivery_approaches', id, deliveryApproaches),
            saveTrainingDataOffline('operating_systems', id, operatingSystems),
            saveTrainingDataOffline('immediate_attention', id, immediateAttention),
            saveTrainingDataOffline('verifiable_items', id, verifiableItems),
            saveTrainingDataOffline('systems_in_place', id, systemsInPlace),
            summary && saveTrainingDataOffline('summary', id, summary)
          ]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Offline save timeout')), 5000))
        ]);
        console.log('[Training Save] Offline storage completed');
      } catch (offlineError) {
        console.warn('[Training Save] Offline storage failed or timed out:', offlineError);
        // Continue with online save
      }

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

          // Use upsert for all related tables to prevent data loss
          // This is safer than delete+insert as it's atomic
          const upsertPromises = [];
          
          if (deliveryApproaches.length > 0) {
            // Delete approaches not in current list, then upsert
            const approachIds = deliveryApproaches.filter(a => a.id && !a.id.startsWith('temp-')).map(a => a.id);
            if (approachIds.length > 0) {
              await supabase.from('training_delivery_approaches').delete().eq('training_id', id).not('id', 'in', `(${approachIds.join(',')})`);
            } else {
              await supabase.from('training_delivery_approaches').delete().eq('training_id', id);
            }
            upsertPromises.push(
              supabase.from('training_delivery_approaches').upsert(
                deliveryApproaches.map(a => ({ 
                  ...a, 
                  training_id: id,
                  id: a.id?.startsWith('temp-') ? undefined : a.id 
                }))
              )
            );
          } else {
            await supabase.from('training_delivery_approaches').delete().eq('training_id', id);
          }

          if (operatingSystems.length > 0) {
            const systemIds = operatingSystems.filter(s => s.id && !s.id.startsWith('temp-')).map(s => s.id);
            if (systemIds.length > 0) {
              await supabase.from('training_operating_systems').delete().eq('training_id', id).not('id', 'in', `(${systemIds.join(',')})`);
            } else {
              await supabase.from('training_operating_systems').delete().eq('training_id', id);
            }
            upsertPromises.push(
              supabase.from('training_operating_systems').upsert(
                operatingSystems.map(s => ({ 
                  ...s, 
                  training_id: id,
                  id: s.id?.startsWith('temp-') ? undefined : s.id 
                }))
              )
            );
          } else {
            await supabase.from('training_operating_systems').delete().eq('training_id', id);
          }

          if (immediateAttention.length > 0) {
            const attentionIds = immediateAttention.filter(i => i.id && !i.id.startsWith('temp-')).map(i => i.id);
            if (attentionIds.length > 0) {
              await supabase.from('training_immediate_attention').delete().eq('training_id', id).not('id', 'in', `(${attentionIds.join(',')})`);
            } else {
              await supabase.from('training_immediate_attention').delete().eq('training_id', id);
            }
            upsertPromises.push(
              supabase.from('training_immediate_attention').upsert(
                immediateAttention.map(i => ({ 
                  ...i, 
                  training_id: id,
                  id: i.id?.startsWith('temp-') ? undefined : i.id 
                }))
              )
            );
          } else {
            await supabase.from('training_immediate_attention').delete().eq('training_id', id);
          }

          if (verifiableItems.length > 0) {
            const verifiableIds = verifiableItems.filter(v => v.id && !v.id.startsWith('temp-')).map(v => v.id);
            if (verifiableIds.length > 0) {
              await supabase.from('training_verifiable_items').delete().eq('training_id', id).not('id', 'in', `(${verifiableIds.join(',')})`);
            } else {
              await supabase.from('training_verifiable_items').delete().eq('training_id', id);
            }
            upsertPromises.push(
              supabase.from('training_verifiable_items').upsert(
                verifiableItems.map(v => ({ 
                  ...v, 
                  training_id: id,
                  id: v.id?.startsWith('temp-') ? undefined : v.id 
                }))
              )
            );
          } else {
            await supabase.from('training_verifiable_items').delete().eq('training_id', id);
          }

          if (systemsInPlace.length > 0) {
            const placeIds = systemsInPlace.filter(s => s.id && !s.id.startsWith('temp-')).map(s => s.id);
            if (placeIds.length > 0) {
              await supabase.from('training_systems_in_place').delete().eq('training_id', id).not('id', 'in', `(${placeIds.join(',')})`);
            } else {
              await supabase.from('training_systems_in_place').delete().eq('training_id', id);
            }
            upsertPromises.push(
              supabase.from('training_systems_in_place').upsert(
                systemsInPlace.map(s => ({ 
                  ...s, 
                  training_id: id,
                  id: s.id?.startsWith('temp-') ? undefined : s.id 
                }))
              )
            );
          } else {
            await supabase.from('training_systems_in_place').delete().eq('training_id', id);
          }

          await Promise.all(upsertPromises);

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
          console.log('[Training Save] Synced to database');
        } catch (error) {
          console.log('[Training Save] Failed to sync, queuing operation:', error);
          await queueTrainingOperation('update', id, updatedTraining);
        }
      } else {
        // Queue for later sync
        console.log('[Training Save] Offline - queuing for sync');
        await queueTrainingOperation('update', id, updatedTraining);
      }

      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('[Training Save] Error saving training:', error);
    } finally {
      clearTimeout(safetyTimeout);
      console.log('[Training Save] Completed, setting isSaving to false');
      setIsSaving(false);
      saveInProgressRef.current = false;
    }
  }, [training, id, deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary, isOnline]);

  // Auto-save/sync retry is now handled by useAutoSync hook

  // Debounce timer for 3-second auto-save after field changes
  const saveDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced auto-save on data changes (3-second debounce) - immediate persistence
  useEffect(() => {
    if (isLoading || !training) return;
    
    // Mark as having unsaved changes
    setHasUnsavedChanges(true);
    
    // Clear existing debounce timer
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
    }
    
    // Set new debounce timer - 3 seconds after last change
    saveDebounceTimerRef.current = setTimeout(() => {
      if (!isSaving) {
        console.log('[Training AutoSave] Debounced save triggered');
        saveTraining();
      }
    }, 3000);
    
    return () => {
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
    };
  }, [deliveryApproaches, operatingSystems, immediateAttention, verifiableItems, systemsInPlace, summary]);

  // Backup auto-save interval (every 30 seconds) - fallback only
  useEffect(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }

    autoSaveTimer.current = setInterval(() => {
      if (hasUnsavedChanges && !isSaving && !isLoading && training) {
        console.log('[Training AutoSave] Interval save triggered');
        saveTraining();
      }
    }, 30000);

    return () => {
      if (autoSaveTimer.current) {
        clearInterval(autoSaveTimer.current);
      }
    };
  }, [hasUnsavedChanges, isSaving, isLoading, training]);

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
      
      // Trigger Valentine's celebration on first completion
      if (!wasAlreadyCompleted) {
        triggerValentineConfetti();
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
              <AutoSaveIndicator
                lastSaved={lastSaved}
                isSaving={isSaving}
                hasUnsavedChanges={hasUnsavedChanges}
                className="hidden sm:flex"
              />
            </div>
            
            <div className="flex items-center gap-2">
              {!isReadOnly && (
              <>
              <Button 
                variant="outline" 
                size={isMobile ? "default" : "sm"} 
                onClick={saveTraining} 
                disabled={isSaving || !isOnline}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Save className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                    {isMobile ? "" : "Save Progress"}
                  </>
                )}
              </Button>
              <Button 
                size={isMobile ? "default" : "sm"} 
                onClick={completeTraining} 
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
              )}
            </div>
          </div>
        </div>
      </header>

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
            <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6 gap-1 lg:gap-0 h-auto p-1.5 lg:p-1">
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
            </TabsList>
          </div>

          <TabsContent value="info" className="space-y-6">
            <TrainingHeader training={training} onUpdate={isReadOnly ? () => {} : updateTrainingField} isReadOnly={isReadOnly} />
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

      </div>
    </>
  );
}
