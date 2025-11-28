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
  onBlur?: () => void;
  storageKey: string;
  placeholder?: string;
  className?: string;
}

export default function HistoryAutocomplete({
  value,
  onChange,
  onBlur,
  storageKey,
  placeholder = "Select or type...",
  className,
}: HistoryAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [historyOptions, setHistoryOptions] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");

  // Load history from localStorage on mount
  useEffect(() => {
    const loadHistory = () => {
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
    };
    
    loadHistory();
  }, [storageKey]);

  // Listen for storage changes (cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setHistoryOptions(Array.isArray(parsed) ? parsed : []);
        } catch (err) {
          console.error("Failed to parse storage change", err);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [storageKey]);

  // Listen for custom history update events (same-tab sync)
  useEffect(() => {
    const handleHistoryUpdate = (e: CustomEvent) => {
      if (e.detail?.storageKey === storageKey && e.detail?.options) {
        setHistoryOptions(e.detail.options);
      }
    };
    
    window.addEventListener('history-update', handleHistoryUpdate as EventListener);
    return () => window.removeEventListener('history-update', handleHistoryUpdate as EventListener);
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
        
        // Dispatch custom event for same-tab sync
        window.dispatchEvent(new CustomEvent('history-update', { 
          detail: { storageKey, options: updated } 
        }));
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
      onBlur?.();
    }
  };

  const handleDelete = (optionToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = historyOptions.filter(opt => opt !== optionToDelete);
    setHistoryOptions(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    
    // Dispatch custom event for same-tab sync
    window.dispatchEvent(new CustomEvent('history-update', { 
      detail: { storageKey, options: updated } 
    }));
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      // Refresh history from localStorage when opening
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setHistoryOptions(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.error("Failed to load history", e);
        }
      }
    }
    setOpen(isOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
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
          onBlur={() => {
            // Delay to allow selection to complete
            setTimeout(() => {
              if (!open && value) {
                onBlur?.();
              }
            }, 200);
          }}
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
