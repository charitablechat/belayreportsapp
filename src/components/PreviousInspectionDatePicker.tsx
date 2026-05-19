import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Ban, HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseLocalDate } from "@/lib/date-utils";

// Special values stored in database
const SPECIAL_VALUES = {
  NA: "N/A",
  UNKNOWN: "Unknown",
} as const;

interface PreviousInspectionDatePickerProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function PreviousInspectionDatePicker({ value, onChange, disabled }: PreviousInspectionDatePickerProps) {
  const [open, setOpen] = useState(false);

  // Determine what type of value we have
  const isNA = value === SPECIAL_VALUES.NA;
  const isUnknown = value === SPECIAL_VALUES.UNKNOWN;
  const isDate = value && !isNA && !isUnknown;
  const parsedDate = isDate ? parseLocalDate(value) : undefined;

  const handleSelect = (selection: string) => {
    onChange(selection);
    setOpen(false);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date && !isNaN(date.getTime())) {
      // Format as YYYY-MM-DD for database storage
      const formatted = format(date, "yyyy-MM-dd");
      // Guard: only persist canonical ISO date format (defends against
      // partial values from native iOS pickers in edge cases)
      if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
        onChange(formatted);
        setOpen(false);
      }
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  // Determine display text and icon
  const getDisplayContent = () => {
    if (isNA) {
      return { icon: Ban, text: "N/A - Never inspected", className: "text-muted-foreground" };
    }
    if (isUnknown) {
      return { icon: HelpCircle, text: "Unknown", className: "text-muted-foreground" };
    }
    if (parsedDate) {
      return { icon: CalendarIcon, text: format(parsedDate, "PPP"), className: "" };
    }
    return { icon: CalendarIcon, text: "Select date...", className: "text-muted-foreground" };
  };

  const display = getDisplayContent();
  const Icon = display.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal h-10",
            display.className
          )}
        >
          <Icon className="mr-2 h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{display.text}</span>
          {value && !disabled && (
            <X 
              className="h-4 w-4 shrink-0 opacity-50 hover:opacity-100 ml-2" 
              onClick={handleClear}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
        align="start"
        sideOffset={6}
        collisionPadding={12}
      >
        {/* Quick select options */}
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={isNA ? "default" : "outline"}
              size="sm"
              className="justify-start h-auto py-2"
              onClick={() => handleSelect(SPECIAL_VALUES.NA)}
            >
              <Ban className="mr-2 h-4 w-4 shrink-0" />
              <div className="text-left">
                <div className="font-medium">N/A</div>
                <div className="text-xs opacity-70">Never inspected</div>
              </div>
            </Button>
            <Button
              variant={isUnknown ? "default" : "outline"}
              size="sm"
              className="justify-start h-auto py-2"
              onClick={() => handleSelect(SPECIAL_VALUES.UNKNOWN)}
            >
              <HelpCircle className="mr-2 h-4 w-4 shrink-0" />
              <div className="text-left">
                <div className="font-medium">Unknown</div>
                <div className="text-xs opacity-70">Date not recorded</div>
              </div>
            </Button>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-popover px-2 text-muted-foreground">or select date</span>
            </div>
          </div>
        </div>
        <Calendar
          mode="single"
          selected={parsedDate}
          onSelect={handleDateSelect}
          initialFocus
          className="pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
