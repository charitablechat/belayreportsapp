import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UseInvoicedStatusProps {
  reportId: string | undefined;
  reportType: 'inspection' | 'training' | 'daily';
  enabled: boolean; // only query when admin + completed
}

export function useInvoicedStatus({ reportId, reportType, enabled }: UseInvoicedStatusProps) {
  const [isInvoiced, setIsInvoiced] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!enabled || !reportId) return;
    
    supabase
      .from('invoiced_reports')
      .select('id')
      .eq('report_id', reportId)
      .eq('report_type', reportType)
      .maybeSingle()
      .then(({ data }) => {
        setIsInvoiced(!!data);
      });
  }, [reportId, reportType, enabled]);

  const toggleInvoiced = useCallback(async () => {
    if (!reportId || toggling) return;
    setToggling(true);
    try {
      if (isInvoiced) {
        const { error } = await supabase
          .from('invoiced_reports')
          .delete()
          .eq('report_id', reportId)
          .eq('report_type', reportType);
        if (error) throw error;
        setIsInvoiced(false);
        toast.success("Invoice mark removed");
      } else {
        const { error } = await supabase
          .from('invoiced_reports')
          .insert({ report_id: reportId, report_type: reportType });
        if (error) throw error;
        setIsInvoiced(true);
        toast.success("Marked as invoiced");
      }
    } catch (err: any) {
      console.error('[useInvoicedStatus] toggle error:', err);
      toast.error("Failed to update invoice status");
    } finally {
      setToggling(false);
    }
  }, [reportId, reportType, isInvoiced, toggling]);

  return { isInvoiced, toggling, toggleInvoiced };
}
