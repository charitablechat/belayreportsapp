import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export default function NewDailyAssessment() {
  const navigate = useNavigate();

  useEffect(() => {
    const createNewAssessment = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          navigate("/");
          return;
        }

        const assessmentId = crypto.randomUUID();
        const newAssessment = {
          id: assessmentId,
          inspector_id: user.id,
          site: '',
          assessment_date: new Date().toISOString().split('T')[0],
          status: 'draft',
          organization: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          synced_at: null as string | null,
        };

        // Save offline first
        const { saveDailyAssessmentOffline, queueAssessmentOperation } = await import('@/lib/offline-storage');
        await saveDailyAssessmentOffline(newAssessment);

        if (navigator.onLine) {
          try {
            const { error } = await supabase
              .from('daily_assessments')
              .insert([newAssessment]);

            if (error) throw error;

            // Update synced_at
            newAssessment.synced_at = new Date().toISOString();
            await saveDailyAssessmentOffline(newAssessment);
          } catch (error) {
            console.error('Error syncing to database:', error);
            // Queue for later sync
            await queueAssessmentOperation('create', assessmentId, newAssessment);
          }
        } else {
          // Queue for later sync
          await queueAssessmentOperation('create', assessmentId, newAssessment);
        }

        navigate(`/daily-assessment/${assessmentId}`);
      } catch (error) {
        console.error('Error creating daily assessment:', error);
        navigate("/dashboard");
      }
    };

    createNewAssessment();
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto" />
        <p className="text-muted-foreground">Creating new daily assessment...</p>
      </div>
    </div>
  );
}
