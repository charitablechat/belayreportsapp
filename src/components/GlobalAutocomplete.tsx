import { useState, useEffect, useRef } from "react";
import { Check, X, Plus, Loader2 } from "lucide-react";
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
import { focusNextCell } from "@/lib/table-focus-utils";
import {
  getAutocompleteHistory,
  putAutocompleteEntry,
  deleteAutocompleteEntry,
  getUnsyncedAutocompleteEntries,
  bulkPutAutocompleteEntries,
  type AutocompleteEntry,
} from "@/lib/offline-storage";

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
  existingValues?: string[];
}

interface HistoryItem {
  id: string;
  value: string;
  usage_count: number;
}

// Module-level cache: shared across all GlobalAutocomplete instances
const _globalHistoryCache = new Map<string, HistoryItem[]>();

// Track which field types have been migrated from localStorage
const _migratedFields = new Set<string>();

/**
 * Make a compound key for IndexedDB entries.
 */
function makeKey(fieldType: string, value: string): string {
  return `${fieldType}::${value}`;
}

/**
 * One-time migration from localStorage to IndexedDB for a field type.
 */
async function migrateLocalStorageToIDB(fieldType: string): Promise<void> {
  if (_migratedFields.has(fieldType)) return;
  _migratedFields.add(fieldType);

  const storageKey = `global-autocomplete-${fieldType}`;
  const saved = localStorage.getItem(storageKey);
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) return;

    const entries: AutocompleteEntry[] = parsed.map((v: string) => ({
      id: makeKey(fieldType, v),
      field_type: fieldType,
      value: v,
      usage_count: 1,
      last_used_at: new Date().toISOString(),
      synced: false,
    }));

    await bulkPutAutocompleteEntries(entries);
    localStorage.removeItem(storageKey);

    if (import.meta.env.DEV) {
      console.log(`[GlobalAutocomplete] Migrated ${entries.length} entries from localStorage for ${fieldType}`);
    }
  } catch (e) {
    console.error('[GlobalAutocomplete] Migration failed:', e);
  }
}

/**
 * GlobalAutocomplete - Unified, globally-shared autocomplete component.
 * 
 * Features:
 * - IndexedDB-first persistence with circuit breaker protection
 * - Background sync to `global_field_history` table when online
 * - Strictly scoped by `fieldType` - values from one field never pollute another
 * - Module-level in-memory cache for instant cross-instance access
 * - localStorage → IndexedDB migration (one-time, transparent)
 */
export function GlobalAutocomplete({
  value,
  onChange,
  onBlur,
  fieldType,
  placeholder = "Select or type...",
  className,
  disabled = false,
  existingValues = [],
}: GlobalAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [historyOptions, setHistoryOptions] = useState<HistoryItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const hasFetchedFromDb = useRef(false);
  const lastSavedValue = useRef<string | null>(null);
  const triggerInputRef = useRef<HTMLInputElement>(null);
  // Set true for a short window after a dropdown selection so the focus-
  // restore that fires when PopoverContent unmounts (Radix FocusScope's
  // `onCloseAutoFocus`) does NOT re-enter edit mode and reopen the popover.
  // Without this guard, picking a contact from the dropdown immediately
  // reopens the popover with the selected value as a search query — looking
  // (to inspectors) as if the field "didn't persist" even though the parent
  // state has already been updated.
  const justSelectedRef = useRef(false);

  // Load from IndexedDB on mount, then optionally sync with server
  useEffect(() => {
    // Check module-level cache first (instant, cross-instance)
    const cached = _globalHistoryCache.get(fieldType);
    if (cached) {
      setHistoryOptions(cached);
      hasFetchedFromDb.current = true;
      return;
    }

    // Load from IndexedDB (with localStorage migration)
    loadFromIndexedDB();
  }, [fieldType]);

  const loadFromIndexedDB = async () => {
    // Migrate localStorage → IndexedDB if needed (one-time)
    await migrateLocalStorageToIDB(fieldType);

    const entries = await getAutocompleteHistory(fieldType);
    if (entries.length > 0) {
      const items: HistoryItem[] = entries.map(e => ({
        id: e.id,
        value: e.value,
        usage_count: e.usage_count,
      }));
      setHistoryOptions(items);
      _globalHistoryCache.set(fieldType, items);
    }

    // Eagerly fetch from server on mount
    if (!hasFetchedFromDb.current) {
      fetchGlobalHistory();
    }
  };

  // Fetch global history from database and merge with IndexedDB
  const fetchGlobalHistory = async () => {
    if (hasFetchedFromDb.current) return;
    
    if (historyOptions.length === 0) {
      setIsLoading(true);
    }
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
        hasFetchedFromDb.current = true;
        return;
      }
      
      if (data && data.length > 0) {
        // Merge server data with local IndexedDB data
        const localEntries = await getAutocompleteHistory(fieldType);
        const mergedMap = new Map<string, AutocompleteEntry>();

        // Add server entries (marked as synced)
        for (const item of data) {
          const key = makeKey(fieldType, item.value);
          mergedMap.set(item.value.toLowerCase(), {
            id: key,
            field_type: fieldType,
            value: item.value,
            usage_count: item.usage_count || 1,
            last_used_at: new Date().toISOString(),
            synced: true,
          });
        }

        // Merge local entries (keep higher usage_count, preserve unsynced)
        for (const local of localEntries) {
          const lowerKey = local.value.toLowerCase();
          const existing = mergedMap.get(lowerKey);
          if (!existing) {
            mergedMap.set(lowerKey, local);
          } else if ((local.usage_count || 0) > (existing.usage_count || 0)) {
            mergedMap.set(lowerKey, { ...existing, usage_count: local.usage_count });
          }
        }

        const mergedEntries = Array.from(mergedMap.values());

        // Persist merged data to IndexedDB
        await bulkPutAutocompleteEntries(mergedEntries);

        // Update in-memory state
        const items: HistoryItem[] = mergedEntries
          .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
          .map(e => ({ id: e.id, value: e.value, usage_count: e.usage_count }));

        setHistoryOptions(items);
        _globalHistoryCache.set(fieldType, items);
      }

      // Push unsynced entries to server
      await pushUnsyncedEntries();
      
      hasFetchedFromDb.current = true;
    } catch (err) {
      console.error('Error fetching global history:', err);
      hasFetchedFromDb.current = true;
    } finally {
      setIsLoading(false);
    }
  };

  // Push locally-created entries to the server
  const pushUnsyncedEntries = async () => {
    try {
      const unsynced = await getUnsyncedAutocompleteEntries();
      if (unsynced.length === 0) return;

      for (const entry of unsynced) {
        const { error } = await supabase
          .from('global_field_history')
          .upsert({
            field_type: entry.field_type,
            value: entry.value,
            usage_count: entry.usage_count,
            last_used_at: entry.last_used_at,
          }, {
            onConflict: 'field_type,value',
            ignoreDuplicates: false,
          });

        if (!error) {
          // Mark as synced in IndexedDB
          await putAutocompleteEntry({ ...entry, synced: true });
        }
      }
    } catch (err) {
      // Non-critical — will retry next fetch cycle
      if (import.meta.env.DEV) {
        console.log('[GlobalAutocomplete] Failed to push unsynced entries:', err);
      }
    }
  };

  // Save value to IndexedDB + fire-and-forget to server
  const saveToHistory = (newValue: string) => {
    const trimmed = newValue.trim();
    if (!trimmed || trimmed === lastSavedValue.current) return;
    
    lastSavedValue.current = trimmed;
    const key = makeKey(fieldType, trimmed);
    
    // Update local state immediately
    setHistoryOptions(prev => {
      const exists = prev.some(opt => opt.value.toLowerCase() === trimmed.toLowerCase());
      if (exists) return prev;
      const updated = [{ id: key, value: trimmed, usage_count: 1 }, ...prev];
      _globalHistoryCache.set(fieldType, updated);
      return updated;
    });
    
    // Write to IndexedDB (with synced: false)
    const entry: AutocompleteEntry = {
      id: key,
      field_type: fieldType,
      value: trimmed,
      usage_count: 1,
      last_used_at: new Date().toISOString(),
      synced: false,
    };
    putAutocompleteEntry(entry);
    
    // Fire-and-forget database upsert; mark synced on success
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
        if (!error) {
          putAutocompleteEntry({ ...entry, synced: true });
        } else {
          console.error('Failed to save to global history:', error);
        }
      });
  };

  // Merge existingValues into history options (deduped, case-insensitive)
  const mergedOptions = (() => {
    if (existingValues.length === 0) return historyOptions;
    const lowerSet = new Set(historyOptions.map(o => o.value.toLowerCase()));
    const extras: HistoryItem[] = [];
    for (const val of existingValues) {
      const trimmed = val?.trim();
      if (trimmed && !lowerSet.has(trimmed.toLowerCase())) {
        extras.push({ id: `existing::${trimmed}`, value: trimmed, usage_count: 0 });
        lowerSet.add(trimmed.toLowerCase());
      }
    }
    return [...historyOptions, ...extras];
  })();

  // Filter options based on search
  const filteredOptions = mergedOptions.filter(opt =>
    opt.value.toLowerCase().includes(inputValue.toLowerCase())
  );

  // Check if input is a new entry
  const isNewEntry = inputValue.trim() && 
    !mergedOptions.some(opt => opt.value.toLowerCase() === inputValue.toLowerCase().trim());

  const handleSelect = (selectedValue: string) => {
    // Mark the upcoming focus-restore as "ignore me" BEFORE we mutate any
    // state — handleTriggerFocus may fire during the same React batch when
    // PopoverContent unmounts and Radix's FocusScope returns focus to the
    // trigger Input. Without this, the just-dismissed popover reopens.
    // The flag is consumed by the next focus event OR cleared by the timer
    // below, whichever fires first. The timer guarantees that a later
    // genuine user re-focus is never permanently suppressed if focus moved
    // elsewhere first (e.g. Enter → focusNextCell).
    justSelectedRef.current = true;
    setTimeout(() => { justSelectedRef.current = false; }, 400);
    onChange(selectedValue);
    saveToHistory(selectedValue);
    setOpen(false);
    // Mirror the selected value into local input state instead of "" so that
    // any race window where the trigger Input briefly renders with
    // `isEditing=true` (e.g. focus restoration before parent state commits)
    // still shows the selection rather than an empty field. When isEditing
    // flips back to false, the input falls through to the prop `value` which
    // is the same selected value — so this is a strict robustness improvement
    // with no behaviour change in the happy path.
    setInputValue(selectedValue);
    setIsEditing(false);
    // Defer onBlur (which usually triggers an immediate save) so React commits
    // the onChange above before the parent reads state in performSave. Calling
    // it synchronously races setState and ships the stale (empty) value — same
    // pattern as the dropdown commit fix.
    if (onBlur) setTimeout(() => onBlur(), 0);
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
    setHistoryOptions(prev => {
      const updated = prev.filter(opt => opt.value !== option.value);
      _globalHistoryCache.set(fieldType, updated);
      return updated;
    });
    
    // Delete from IndexedDB
    deleteAutocompleteEntry(option.id);
    
    // Delete from database (fire-and-forget)
    if (!option.id.startsWith('local-')) {
      supabase
        .from('global_field_history')
        .delete()
        .eq('field_type', fieldType)
        .eq('value', option.value)
        .then(({ error }) => {
          if (error) console.error('Failed to delete from global history:', error);
        });
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Commit on close. Never silently wipe a previously non-empty value
      // with an empty buffer — that turns "tap the field, change my mind,
      // tap outside" into a data-loss event on tablets where the popover
      // is often hidden under the soft keyboard.
      if (isEditing && inputValue.trim()) {
        const trimmed = inputValue.trim();
        if (trimmed !== value) {
          onChange(trimmed);
          saveToHistory(trimmed);
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
    setTimeout(setCaret, 50);
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
    // Suppress this focus event if it's the auto-restore that fires when
    // Radix's FocusScope unmounts after a dropdown selection. Otherwise the
    // popover would reopen immediately, defeating the user's commit gesture.
    // Consume the flag once — a genuine subsequent re-focus from the user
    // (tap, tab, etc.) opens the popover normally.
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    // Only seed inputValue from the prop `value` when transitioning into
    // edit mode (from non-editing). Re-seeding on every focus event clobbers
    // any in-flight local edit the user has typed but not yet committed —
    // a frequent tablet failure mode where soft-keyboard / autocorrect bar
    // briefly steals focus and returns it.
    if (!isEditing) {
      setIsEditing(true);
      setInputValue(value);
      placeCursorAtEnd();
    }
    if (!open) {
      setOpen(true);
    }
    if (!hasFetchedFromDb.current) {
      fetchGlobalHistory();
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
            saveToHistory(trimmed);
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
      if (triggerInputRef.current) {
        focusNextCell(triggerInputRef.current);
      }
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
    // Defer onBlur for the same reason as handleSelect — let onChange("") commit first.
    if (onBlur) setTimeout(() => onBlur(), 0);
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
              if (!open) {
                setOpen(true);
                if (!hasFetchedFromDb.current) {
                  fetchGlobalHistory();
                }
              }
            }}
            onFocus={handleTriggerFocus}
            onMouseUp={normalizeTriggerSelection}
            onTouchEnd={normalizeTriggerSelection}
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
            
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="min-w-[--radix-popover-trigger-width] w-auto max-w-[calc(100vw-2rem)] p-0 shadow-lg border"
        align="start"
        onOpenAutoFocus={(e) => {
          // Keep focus on the trigger Input. Without this, Radix's
          // FocusScope moves focus into the inner CommandInput, which on
          // tablets hides under the soft keyboard — users then type into
          // a filter box thinking they're editing the field, and on close
          // the search term silently overwrites the field value.
          e.preventDefault();
        }}
      >
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
