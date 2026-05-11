import { useState, useEffect, useRef } from "react";
import { Check, Pencil, Trash2, X, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type FieldType = 
  | "organization" 
  | "trainer_name" 
  | "onsite_contact" 
  | "inspector_name" 
  | "equipment_type" 
  | "zipline_name" 
  | "system_element";

interface HistoryItem {
  id: string;
  value: string;
  usage_count: number;
  last_used_at: string;
}

interface DatabaseAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  fieldType: FieldType;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DatabaseAutocomplete({
  value,
  onChange,
  fieldType,
  placeholder = "Select or enter...",
  disabled = false,
  className,
}: DatabaseAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deletingItem, setDeletingItem] = useState<HistoryItem | null>(null);
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch history items for this field type
  const { data: historyItems = [], isLoading } = useQuery({
    queryKey: ["field-history", fieldType],
    queryFn: async () => {
      const user = await getUserWithCache();
      if (!user) return [];

      const { data, error } = await supabase
        .from("user_field_history")
        .select("id, value, usage_count, last_used_at")
        .eq("user_id", user.id)
        .eq("field_type", fieldType)
        .order("usage_count", { ascending: false })
        .order("last_used_at", { ascending: false });

      if (error) {
        console.error("Error fetching field history:", error);
        return [];
      }
      return data as HistoryItem[];
    },
  });

  // Filter items based on search
  const filteredItems = historyItems.filter((item) =>
    item.value.toLowerCase().includes(searchValue.toLowerCase())
  );

  // Check if search value is a new entry
  const isNewEntry = searchValue.trim() && 
    !historyItems.some(item => item.value.toLowerCase() === searchValue.toLowerCase().trim());

  // Mutation to save/update history
  const saveMutation = useMutation({
    mutationFn: async (newValue: string) => {
      const user = await getUserWithCache();
      if (!user) return; // Skip saving history when auth unavailable (e.g. offline)

      const trimmedValue = newValue.trim();
      if (!trimmedValue) return;

      // Try to upsert - increment usage count if exists, create if not
      const { error } = await supabase
        .from("user_field_history")
        .upsert(
          {
            user_id: user.id,
            field_type: fieldType,
            value: trimmedValue,
            usage_count: 1,
            last_used_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,field_type,value",
          }
        );

      if (error) {
        // If upsert failed, try to update
        const { error: updateError } = await supabase
          .from("user_field_history")
          .update({
            usage_count: supabase.rpc ? undefined : 1, // Will increment via SQL
            last_used_at: new Date().toISOString(),
          })
          .eq("user_id", user.id)
          .eq("field_type", fieldType)
          .eq("value", trimmedValue);

        if (updateError) {
          console.error("Error saving history:", updateError);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["field-history", fieldType] });
    },
  });

  // Mutation to update an item
  const updateMutation = useMutation({
    mutationFn: async ({ id, newValue }: { id: string; newValue: string }) => {
      const { error } = await supabase
        .from("user_field_history")
        .update({ value: newValue.trim() })
        .eq("id", id);

      if (error) throw error;
      return { id, newValue: newValue.trim() };
    },
    onSuccess: ({ newValue }) => {
      queryClient.invalidateQueries({ queryKey: ["field-history", fieldType] });
      toast.success("Entry updated");
      // Update current value if it was the one being edited
      if (editingItem && value === editingItem.value) {
        onChange(newValue);
      }
      setEditingItem(null);
      setEditValue("");
    },
    onError: (error) => {
      console.error("Error updating entry:", error);
      toast.error("Failed to update entry");
    },
  });

  // Mutation to delete an item
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("user_field_history")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["field-history", fieldType] });
      toast.success("Entry deleted");
      setDeletingItem(null);
    },
    onError: (error) => {
      console.error("Error deleting entry:", error);
      toast.error("Failed to delete entry");
    },
  });

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue);
    saveMutation.mutate(selectedValue);
    setOpen(false);
    setSearchValue("");
  };

  const handleCreateNew = () => {
    const newValue = searchValue.trim();
    if (newValue) {
      handleSelect(newValue);
    }
  };

  const handleEditClick = (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    setEditingItem(item);
    setEditValue(item.value);
  };

  const handleEditSave = () => {
    if (editingItem && editValue.trim()) {
      updateMutation.mutate({ id: editingItem.id, newValue: editValue });
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    setDeletingItem(item);
  };

  const handleDeleteConfirm = () => {
    if (deletingItem) {
      deleteMutation.mutate(deletingItem.id);
    }
  };

  const [isEditing, setIsEditing] = useState(false);
  const triggerInputRef = useRef<HTMLInputElement>(null);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      if (isEditing && searchValue.trim()) {
        const trimmed = searchValue.trim();
        if (trimmed !== value) {
          handleSelect(trimmed);
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
    // Re-seeding on every focus event clobbers in-flight local edits
    // when soft-keyboard / autocorrect briefly steals and restores focus.
    if (!isEditing) {
      setIsEditing(true);
      setSearchValue(value);
      placeCursorAtEnd();
    }
    if (!open) setOpen(true);
  };

  const handleTriggerBlur = () => {
    setTimeout(() => {
      if (!open) {
        if (searchValue.trim()) {
          const trimmed = searchValue.trim();
          if (trimmed !== value) {
            handleSelect(trimmed);
          }
        }
        setIsEditing(false);
      }
    }, 200);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onChange("");
    setSearchValue("");
    setOpen(false);
    setIsEditing(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <div className="relative w-full">
            <Input
              ref={triggerInputRef}
              role="combobox"
              aria-expanded={open}
              value={isEditing ? searchValue : value}
              onChange={(e) => {
                setSearchValue(e.target.value);
                if (!isEditing) setIsEditing(true);
                if (!open) setOpen(true);
              }}
              onFocus={handleTriggerFocus}
              onMouseUp={normalizeTriggerSelection}
              onTouchEnd={normalizeTriggerSelection}
              onBlur={handleTriggerBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchValue.trim()) {
                  e.preventDefault();
                  handleSelect(searchValue.trim());
                  setIsEditing(false);
                  triggerInputRef.current?.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchValue(value);
                  setIsEditing(false);
                  setOpen(false);
                  triggerInputRef.current?.blur();
                }
              }}
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
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search or type new...`}
              value={searchValue}
              onValueChange={setSearchValue}
              ref={inputRef}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchValue.trim()) {
                  e.preventDefault();
                  handleSelect(searchValue.trim());
                }
              }}
            />
            <CommandList>
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {filteredItems.length === 0 && !isNewEntry && (
                    <CommandEmpty>No entries found. Start typing to create one.</CommandEmpty>
                  )}
                  
                  {isNewEntry && (
                    <CommandGroup heading="Create new">
                      <CommandItem
                        onSelect={handleCreateNew}
                        className="cursor-pointer"
                      >
                        <Plus className="mr-2 h-4 w-4 text-primary" />
                        <span>Create "{searchValue.trim()}"</span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                  
                  {filteredItems.length > 0 && (
                    <CommandGroup heading="Recent entries">
                      {filteredItems.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={item.value}
                          onSelect={() => handleSelect(item.value)}
                          className="cursor-pointer group"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === item.value ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="flex-1 truncate">{item.value}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => handleEditClick(e, item)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={(e) => handleDeleteClick(e, item)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Edit Dialog */}
      <AlertDialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Update this saved entry. This won't change existing reports.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="Enter new value"
            className="mt-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleEditSave}
              disabled={!editValue.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingItem} onOpenChange={(open) => !open && setDeletingItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingItem?.value}"? This won't affect existing reports.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}