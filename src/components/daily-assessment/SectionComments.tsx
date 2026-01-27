/**
 * Section Comments Component
 * Terminal-style, developer-focused comments textarea for Daily Assessment sections
 */
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MessageSquare } from "lucide-react";

interface SectionCommentsProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function SectionComments({ 
  value, 
  onChange, 
  placeholder = "Add notes or comments...",
  label = "Section Notes"
}: SectionCommentsProps) {
  return (
    <div className="mt-4 pt-4 border-t border-border/50">
      <Label className="flex items-center gap-2 text-sm font-medium mb-2 text-muted-foreground">
        <MessageSquare className="h-4 w-4" />
        {label}
      </Label>
      <Textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="font-mono text-sm bg-slate-900/5 dark:bg-slate-900/50 border-slate-300 dark:border-slate-700 focus:border-primary placeholder:text-muted-foreground/60 resize-y"
      />
    </div>
  );
}
