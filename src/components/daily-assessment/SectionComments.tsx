/**
 * Section Comments Component
 * Terminal-style, developer-focused comments textarea for Daily Assessment sections
 */
import { DebouncedTextarea } from "@/components/inspection/DebouncedTextarea";
import { Label } from "@/components/ui/label";
import { MessageSquare } from "lucide-react";

interface SectionCommentsProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  label?: string;
}

export function SectionComments({ 
  value, 
  onChange, 
  onBlur,
  placeholder = "Add notes or comments...",
  label = "Section Notes"
}: SectionCommentsProps) {
  return (
    <div className="mt-4 pt-4 border-t border-amber-300/50 dark:border-amber-700/50 border-l-4 border-l-amber-500 pl-3">
      <Label className="flex items-center gap-2 text-sm font-medium mb-2 text-amber-700 dark:text-amber-400">
        <MessageSquare className="h-4 w-4" />
        {label}
      </Label>
      <DebouncedTextarea
        value={value || ''}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={3}
        className="font-mono text-sm bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 focus:border-amber-500 placeholder:text-amber-800/40 dark:placeholder:text-amber-300/40 text-black dark:text-amber-100 resize-y"
      />
    </div>
  );
}
