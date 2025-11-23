import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CheckCircle, Loader2 } from 'lucide-react';

export const BulletMigrationButton = () => {
  const [isRunning, setIsRunning] = useState(false);

  const runMigration = async () => {
    setIsRunning(true);
    try {
      console.log('Starting bullet migration...');
      
      const { data, error } = await supabase.functions.invoke('migrate-circle-bullets');

      if (error) throw error;

      console.log('Migration result:', data);
      
      toast.success('Migration Complete', {
        description: `${data.updatedCount} inspection summaries converted to checkmark lists`,
      });

      // Refresh the page to show updated content
      setTimeout(() => window.location.reload(), 1500);
      
    } catch (error) {
      console.error('Migration error:', error);
      toast.error('Migration Failed', {
        description: error instanceof Error ? error.message : 'Failed to convert bullets',
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Button
      onClick={runMigration}
      disabled={isRunning}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      {isRunning ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Converting...
        </>
      ) : (
        <>
          <CheckCircle className="h-4 w-4" />
          Convert ○ to ✓ Lists
        </>
      )}
    </Button>
  );
};
