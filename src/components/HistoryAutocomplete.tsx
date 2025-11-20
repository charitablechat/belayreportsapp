import { useState, useEffect } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface HistoryAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  storageKey: string;
  placeholder?: string;
  className?: string;
}

export default function HistoryAutocomplete({
  value,
  onChange,
  storageKey,
  placeholder = "Select or type...",
  className,
}: HistoryAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [historyOptions, setHistoryOptions] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");

  // Load history from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setHistoryOptions(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        console.error("Failed to load history", e);
        setHistoryOptions([]);
      }
    }
  }, [storageKey]);

  // Save to history when value changes (if it's a new value)
  useEffect(() => {
    if (value && value.trim()) {
      const trimmed = value.trim();
      const lowerValue = trimmed.toLowerCase();
      
      // Check if this value already exists (case-insensitive)
      const exists = historyOptions.some(
        opt => opt.toLowerCase() === lowerValue
      );

      if (!exists) {
        const updated = [...historyOptions, trimmed].sort((a, b) => 
          a.toLowerCase().localeCompare(b.toLowerCase())
        );
        setHistoryOptions(updated);
        localStorage.setItem(storageKey, JSON.stringify(updated));
      }
    }
  }, [value, historyOptions, storageKey]);

  // Sorted options for display
  const sortedOptions = [...historyOptions].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    setOpen(false);
  };

  const handleInputChange = (searchValue: string) => {
    setInputValue(searchValue);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      onChange(inputValue.trim());
      setOpen(false);
      setInputValue("");
    }
  };

  const handleDelete = (optionToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = historyOptions.filter(opt => opt !== optionToDelete);
    setHistoryOptions(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput
            placeholder={placeholder}
            value={inputValue}
            onValueChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
          />
          <CommandList>
            <CommandEmpty>
              <div className="text-sm text-muted-foreground p-2">
                {inputValue.trim() 
                  ? `Press Enter to add "${inputValue}"`
                  : "No previous entries. Type to add new."}
              </div>
            </CommandEmpty>
            {sortedOptions.length > 0 && (
              <CommandGroup heading="Previous entries">
                <ScrollArea className="h-[200px]">
                  {sortedOptions.map((option) => (
                    <CommandItem
                      key={option}
                      value={option}
                      onSelect={() => handleSelect(option)}
                      className="flex items-center justify-between group"
                    >
                      <div className="flex items-center flex-1">
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === option ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {option}
                      </div>
                      <button
                        onClick={(e) => handleDelete(option, e)}
                        className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity p-1"
                        aria-label={`Delete ${option}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </CommandItem>
                  ))}
                </ScrollArea>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
