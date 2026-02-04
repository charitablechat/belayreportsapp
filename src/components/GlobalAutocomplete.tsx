import { useState, useEffect, useRef } from "react";
import { Check, ChevronsUpDown, X, Plus, Loader2 } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";

/**
 * Comprehensive field type covering ALL autocomplete fields in the application.
 * Each field type is strictly scoped - entries from one type will NEVER appear in another.
 */
export type GlobalFieldType = 
  // Header fields (previously DatabaseAutocomplete)
  | "inspector_name"
  | "previous_inspector"
  | "onsite_contact"
  | "trainer_name"
  | "organization"
  // Equipment fields
  | "equipment_type"
  // Operating systems
  | "operating_system_element"
  | "system_type"
  // Ziplines
  | "zipline_name"
  | "braking_system"
  | "ead_system"
  | "cable_type";

interface GlobalAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  fieldType: GlobalFieldType;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

interface HistoryItem {
  id: string;
  value: string;
  usage_count: number;
}

/**
 * GlobalAutocomplete - Unified, globally-shared autocomplete component.
 * 
 * Features:
 * - Uses `global_field_history` table exclusively for cross-user sharing
 * - Strictly scoped by `fieldType` - values from one field never pollute another
 * - Lazy-loads suggestions when popover opens (performance optimization)
 * - Fire-and-forget upserts to avoid blocking UI
 * - Maintains localStorage as offline fallback
 */
export function GlobalAutocomplete({
  value,
  onChange,
  onBlur,
  fieldType,
  placeholder = "Select or type...",
  className,
  disabled = false,
}: GlobalAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [historyOptions, setHistoryOptions] = useState<HistoryItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const hasFetchedFromDb = useRef(false);
  const lastSavedValue = useRef<string | null>(null);
  
  // LocalStorage key for offline fallback
  const storageKey = `global-autocomplete-${fieldType}`;

  // Load from localStorage on mount (offline fallback)
  useEffect(() => {
    const loadLocalHistory = () => {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setHistoryOptions(parsed.map((v: string, i: number) => ({
              id: `local-${i}`,
              value: v,
              usage_count: 1
            })));
          }
        } catch (e) {
          console.error("Failed to load local history", e);
        }
      }
    };
    loadLocalHistory();
  }, [storageKey]);

  // Fetch global history from database (on-demand when popover opens)
  const fetchGlobalHistory = async () => {
    if (hasFetchedFromDb.current) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('global_field_history')
        .select('id, value, usage_count')
        .eq('field_type', fieldType)
        .order('usage_count', { ascending: false })
        .order('last_used_at', { ascending: false })
        .limit(200);
      
      if (error) {
        console.error('Failed to fetch global history:', error);
        return;
      }
      
      if (data && data.length > 0) {
        // Merge with localStorage, deduplicate (case-insensitive)
        setHistoryOptions(prev => {
          const combined = [...data, ...prev];
          const uniqueMap = new Map<string, HistoryItem>();
          combined.forEach(item => {
            const key = item.value.toLowerCase();
            if (!uniqueMap.has(key) || (item.usage_count || 0) > (uniqueMap.get(key)?.usage_count || 0)) {
              uniqueMap.set(key, item);
            }
          });
          return Array.from(uniqueMap.values()).sort((a, b) => 
            (b.usage_count || 0) - (a.usage_count || 0)
          );
        });
        
        // Update localStorage with merged results
        const values = data.map(d => d.value);
        localStorage.setItem(storageKey, JSON.stringify(values));
      }
      
      hasFetchedFromDb.current = true;
    } catch (err) {
      console.error('Error fetching global history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Save value to global history (fire-and-forget)
  const saveToGlobalHistory = (newValue: string) => {
    const trimmed = newValue.trim();
    if (!trimmed || trimmed === lastSavedValue.current) return;
    
    lastSavedValue.current = trimmed;
    
    // Add to local state immediately
    setHistoryOptions(prev => {
      const exists = prev.some(opt => opt.value.toLowerCase() === trimmed.toLowerCase());
      if (exists) return prev;
      return [{ id: `local-new-${Date.now()}`, value: trimmed, usage_count: 1 }, ...prev];
    });
    
    // Update localStorage
    const saved = localStorage.getItem(storageKey);
    const existing = saved ? JSON.parse(saved) : [];
    if (!existing.some((v: string) => v.toLowerCase() === trimmed.toLowerCase())) {
      localStorage.setItem(storageKey, JSON.stringify([trimmed, ...existing]));
    }
    
    // Fire-and-forget database upsert
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
  };

  // Filter options based on search
  const filteredOptions = historyOptions.filter(opt =>
    opt.value.toLowerCase().includes(inputValue.toLowerCase())
  );

  // Check if input is a new entry
  const isNewEntry = inputValue.trim() && 
    !historyOptions.some(opt => opt.value.toLowerCase() === inputValue.toLowerCase().trim());

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    saveToGlobalHistory(selectedValue);
    setOpen(false);
    setInputValue("");
    onBlur?.();
  };

  const handleInputChange = (searchValue: string) => {
    setInputValue(searchValue);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      handleSelect(inputValue.trim());
    }
  };

  const handleDelete = (optionToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Remove from local state
    setHistoryOptions(prev => prev.filter(opt => opt.value !== optionToDelete));
    
    // Update localStorage
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const existing = JSON.parse(saved);
      localStorage.setItem(storageKey, JSON.stringify(
        existing.filter((v: string) => v !== optionToDelete)
      ));
    }
    
    // Note: Don't delete from database - shared history persists globally
    // Super admins can delete via separate admin interface if needed
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      // Fetch global history on first open
      if (!hasFetchedFromDb.current) {
        fetchGlobalHistory();
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
          disabled={disabled}
          onBlur={() => {
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
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={inputValue}
            onValueChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {filteredOptions.length === 0 && !isNewEntry && (
                  <CommandEmpty>
                    <div className="text-sm text-muted-foreground p-2">
                      No entries found. Type to add new.
                    </div>
                  </CommandEmpty>
                )}
                
                {isNewEntry && (
                  <CommandGroup heading="Create new">
                    <CommandItem
                      onSelect={() => handleSelect(inputValue.trim())}
                      className="cursor-pointer"
                    >
                      <Plus className="mr-2 h-4 w-4 text-primary" />
                      <span>Create "{inputValue.trim()}"</span>
                    </CommandItem>
                  </CommandGroup>
                )}
                
                {filteredOptions.length > 0 && (
                  <CommandGroup heading="Previous entries">
                    <ScrollArea className="h-[200px]">
                      {filteredOptions.map((option) => (
                        <CommandItem
                          key={option.id}
                          value={option.value}
                          onSelect={() => handleSelect(option.value)}
                          className="flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center flex-1">
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                value === option.value ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="truncate">{option.value}</span>
                          </div>
                          <button
                            onClick={(e) => handleDelete(option.value, e)}
                            className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity p-1"
                            aria-label={`Remove ${option.value} from suggestions`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </CommandItem>
                      ))}
                    </ScrollArea>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default GlobalAutocomplete;
