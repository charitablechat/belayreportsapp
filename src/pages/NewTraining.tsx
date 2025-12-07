import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export default function NewTraining() {
  const navigate = useNavigate();

  useEffect(() => {
    const createNewTraining = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          navigate("/");
          return;
        }

        // Fetch user profile to get their name
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', user.id)
          .single();

        const fullName = profile 
          ? [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
          : '';

        const now = new Date().toISOString();
        const newTraining = {
          inspector_id: user.id,
          organization: '',
          start_date: now.split('T')[0],
          end_date: now.split('T')[0],
          status: 'draft',
          trainer_of_record: fullName || null,
          created_at: now,
          updated_at: now,
          synced_at: now,
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
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto" />
        <p className="text-muted-foreground">Creating new training report...</p>
      </div>
    </div>
  );
}
