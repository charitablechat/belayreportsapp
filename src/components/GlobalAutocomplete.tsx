import { useState, useEffect, useRef } from "react";
import { Check, ChevronsUpDown, X, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
  PopoverAnchor,
  PopoverContent,
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
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const hasFetchedFromDb = useRef(false);
  const lastSavedValue = useRef<string | null>(null);
  const triggerInputRef = useRef<HTMLInputElement>(null);
  
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
    setIsEditing(false);
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

  const handleDelete = (option: HistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    // Remove from local state
    setHistoryOptions(prev => prev.filter(opt => opt.value !== option.value));
    
    // Update localStorage
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const existing = JSON.parse(saved);
      localStorage.setItem(storageKey, JSON.stringify(
        existing.filter((v: string) => v !== option.value)
      ));
    }
    
    // Delete from database (fire-and-forget)
    if (!option.id.startsWith('local-')) {
      supabase
        .from('global_field_history')
        .delete()
        .eq('id', option.id)
        .then(({ error }) => {
          if (error) console.error('Failed to delete from global history:', error);
        });
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      if (!hasFetchedFromDb.current) {
        fetchGlobalHistory();
      }
    } else {
      // Commit on close
      if (isEditing && inputValue.trim()) {
        const trimmed = inputValue.trim();
        if (trimmed !== value) {
          onChange(trimmed);
          saveToGlobalHistory(trimmed);
        }
      }
      setIsEditing(false);
    }
    setOpen(isOpen);
  };

  const handleTriggerFocus = () => {
    setIsEditing(true);
    setInputValue(value);
    if (!open) {
      setOpen(true);
    }
  };

  const handleTriggerBlur = () => {
    // Delay to allow popover click to register
    setTimeout(() => {
      if (!open) {
        if (inputValue.trim()) {
          const trimmed = inputValue.trim();
          if (trimmed !== value) {
            onChange(trimmed);
            saveToGlobalHistory(trimmed);
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
      <PopoverAnchor asChild>
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
            onBlur={handleTriggerBlur}
            onKeyDown={handleTriggerKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              "w-full pr-14 font-normal transition-none",
              isEditing && "border-2 border-foreground ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-[2px_2px_0px_0px_hsl(var(--foreground))]",
              !value && !isEditing && "text-muted-foreground",
              className
            )}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {value && !disabled && (
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
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent className="min-w-[--radix-popover-trigger-width] w-auto max-w-[calc(100vw-2rem)] p-0 shadow-lg border" align="start">
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
                      className="cursor-pointer px-3 py-2.5 rounded-md mx-1 my-0.5"
                    >
                      <Plus className="mr-2 h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Create "{inputValue.trim()}"</span>
                    </CommandItem>
                  </CommandGroup>
                )}
                
                {filteredOptions.length > 0 && (
                  <CommandGroup heading="Previous entries">
                    <ScrollArea className="h-[240px]">
                      {filteredOptions.map((option) => (
                        <CommandItem
                          key={option.id}
                          value={option.value}
                          onSelect={() => handleSelect(option.value)}
                          className="flex items-center justify-between cursor-pointer px-3 py-2.5 rounded-md mx-1 my-0.5"
                        >
                          <div className="flex items-center flex-1 min-w-0 gap-2">
                            <Check
                              className={cn(
                                "h-4 w-4 shrink-0 text-primary",
                                value === option.value ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="whitespace-nowrap text-sm font-medium">{option.value}</span>
                          </div>
                          <button
                            onClick={(e) => handleDelete(option, e)}
                            className="ml-3 shrink-0 text-muted-foreground/50 hover:text-destructive transition-colors p-1 rounded-sm hover:bg-destructive/10"
                            aria-label={`Remove ${option.value} from suggestions`}
                          >
                            <X className="h-3.5 w-3.5" />
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
