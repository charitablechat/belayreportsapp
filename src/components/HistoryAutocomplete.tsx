import { useState, useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { keepOpenIfAnchor } from "@/lib/popover-anchor-guard";
import { Input } from "@/components/ui/input";
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
import { supabase } from "@/integrations/supabase/client";

interface HistoryAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  storageKey: string;
  placeholder?: string;
  className?: string;
  /** Enable syncing to global database for cross-report memory */
  syncToDatabase?: boolean;
  /** Field type for database storage (e.g., 'equipment_type', 'zipline_name') */
  fieldType?: string;
}

export default function HistoryAutocomplete({
  value,
  onChange,
  onBlur,
  storageKey,
  placeholder = "Select or type...",
  className,
  syncToDatabase = false,
  fieldType,
}: HistoryAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [historyOptions, setHistoryOptions] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const hasFetchedFromDb = useRef(false);
  const lastSavedValue = useRef<string | null>(null);
  const triggerInputRef = useRef<HTMLInputElement>(null);

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

  // PERFORMANCE: Fetch global history from database on-demand (when popover opens)
  // instead of on mount to avoid competing network requests during initial load
  const fetchGlobalHistory = async () => {
    if (!syncToDatabase || !fieldType || hasFetchedFromDb.current) return;
    
    try {
      const { data, error } = await supabase
        .from('global_field_history')
        .select('value')
        .eq('field_type', fieldType)
        .order('usage_count', { ascending: false })
        .limit(200);
      
      if (error) {
        console.error('Failed to fetch global history:', error);
        return;
      }
      
      if (data && data.length > 0) {
        const globalValues = data.map(d => d.value);
        
        // Merge with localStorage, deduplicate (case-insensitive)
        setHistoryOptions(prev => {
          const combined = [...prev, ...globalValues];
          const uniqueMap = new Map<string, string>();
          combined.forEach(val => {
            const key = val.toLowerCase();
            if (!uniqueMap.has(key)) {
              uniqueMap.set(key, val);
            }
          });
          return Array.from(uniqueMap.values()).sort((a, b) => 
            a.toLowerCase().localeCompare(b.toLowerCase())
          );
        });
      }
      
      hasFetchedFromDb.current = true;
    } catch (err) {
      console.error('Error fetching global history:', err);
    }
  };

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
      
      // Sync to database if enabled (only once per unique value)
      if (syncToDatabase && fieldType && trimmed !== lastSavedValue.current) {
        lastSavedValue.current = trimmed;
        
        // Fire and forget - don't block UI
        supabase
          .from('global_field_history')
          .upsert({
            field_type: fieldType,
            value: trimmed,
            usage_count: 1,
            last_used_at: new Date().toISOString()
          }, { 
            onConflict: 'field_type,value',
            ignoreDuplicates: false 
          })
          .then(({ error }) => {
            if (error) {
              console.error('Failed to save to global history:', error);
            }
          });
      }
    }
  }, [value, historyOptions, storageKey, syncToDatabase, fieldType]);

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
    
    // Note: We don't delete from the global database - shared history persists
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      if (!hasFetchedFromDb.current && syncToDatabase && fieldType) {
        fetchGlobalHistory();
      }
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setHistoryOptions(prev => {
            const combined = [...prev, ...(Array.isArray(parsed) ? parsed : [])];
            const uniqueMap = new Map<string, string>();
            combined.forEach(val => {
              const key = val.toLowerCase();
              if (!uniqueMap.has(key)) {
                uniqueMap.set(key, val);
              }
            });
            return Array.from(uniqueMap.values()).sort((a, b) => 
              a.toLowerCase().localeCompare(b.toLowerCase())
            );
          });
        } catch (e) {
          console.error("Failed to load history", e);
        }
      }
    } else {
      // Commit on close
      if (isEditing && inputValue.trim()) {
        const trimmed = inputValue.trim();
        if (trimmed !== value) {
          onChange(trimmed);
        }
      }
      setIsEditing(false);
    }
    setOpen(isOpen);
  };

  const placeCursorAtEnd = () => {
    const input = triggerInputRef.current;
    if (!input) return;

    const setCaret = () => {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    };

    setCaret();
    requestAnimationFrame(setCaret);
    setTimeout(setCaret, 0);
  };

  const normalizeTriggerSelection = () => {
    const input = triggerInputRef.current;
    if (!input) return;

    if (
      input.value.length > 0 &&
      input.selectionStart === 0 &&
      input.selectionEnd === input.value.length
    ) {
      placeCursorAtEnd();
    }
  };

  const handleTriggerFocus = () => {
    // Only seed the local buffer when transitioning into edit mode.
    // Re-seeding on every focus event clobbers in-flight local edits.
    if (!isEditing) {
      setIsEditing(true);
      setInputValue(value);
      placeCursorAtEnd();
    }
    if (!open) setOpen(true);
  };

  const handleTriggerBlur = () => {
    setTimeout(() => {
      if (!open) {
        if (inputValue.trim()) {
          const trimmed = inputValue.trim();
          if (trimmed !== value) {
            onChange(trimmed);
          }
        }
        setIsEditing(false);
        onBlur?.();
      }
    }, 200);
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      handleSelect(inputValue.trim());
      setIsEditing(false);
      triggerInputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setInputValue(value);
      setIsEditing(false);
      setOpen(false);
      triggerInputRef.current?.blur();
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onChange("");
    setInputValue("");
    setOpen(false);
    setIsEditing(false);
    onBlur?.();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div className="relative w-full">
          <Input
            ref={triggerInputRef}
            role="combobox"
            aria-expanded={open}
            value={isEditing ? inputValue : value}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (!isEditing) setIsEditing(true);
              if (!open) setOpen(true);
            }}
            onFocus={handleTriggerFocus}
            onMouseUp={normalizeTriggerSelection}
            onTouchEnd={normalizeTriggerSelection}
            onBlur={handleTriggerBlur}
            onKeyDown={handleTriggerKeyDown}
            placeholder={placeholder}
            className={cn(
              "w-full pr-14 font-normal transition-none",
              isEditing && "border-2 border-foreground ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-[2px_2px_0px_0px_hsl(var(--foreground))]",
              !value && !isEditing && "text-muted-foreground",
              className
            )}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 rounded-sm hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear value"
                tabIndex={-1}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] sm:w-[300px] max-w-[300px] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
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
