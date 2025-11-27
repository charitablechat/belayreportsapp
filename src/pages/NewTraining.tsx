import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { saveTrainingOffline, queueTrainingOperation } from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { Loader2 } from "lucide-react";

export default function NewTraining() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();

  useEffect(() => {
    const createNewTraining = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          navigate("/");
          return;
        }

        const newTraining = {
          inspector_id: user.id,
          organization: '',
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0],
          status: 'draft',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from('trainings')
          .insert([newTraining])
          .select()
          .single();

        if (error) throw error;

        navigate(`/training/${data.id}`);
      } catch (error) {
        console.error('Error creating training:', error);
        navigate("/dashboard");
      }
    };

    createNewTraining();
  }, [navigate, toast]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto" />
        <p className="text-muted-foreground">Creating new training report...</p>
      </div>
    </div>
  );
}
