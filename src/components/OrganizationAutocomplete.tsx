import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, Pencil, Trash2, Plus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { toast } from "sonner";

interface HistoryItem {
  id: string;
  value: string;
  usage_count: number;
  last_used_at: string;
}

interface OrganizationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const OrganizationAutocomplete = ({
  value,
  onChange,
  disabled = false,
}: OrganizationAutocompleteProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deletingItem, setDeletingItem] = useState<HistoryItem | null>(null);
  const queryClient = useQueryClient();

  // Fetch user's organization history from database
  const { data: historyItems = [], isLoading: isLoadingHistory } = useQuery({
    queryKey: ["field-history", "organization"],
    queryFn: async () => {
      const user = await getUserWithCache();
      if (!user) return [];

      const { data, error } = await supabase
        .from("user_field_history")
        .select("id, value, usage_count, last_used_at")
        .eq("user_id", user.id)
        .eq("field_type", "organization")
        .order("usage_count", { ascending: false })
        .order("last_used_at", { ascending: false });

      if (error) {
        console.error("Error fetching organization history:", error);
        return [];
      }
      return data as HistoryItem[];
    },
  });

  // Also fetch from organizations table for global suggestions
  const { data: organizations = [], isLoading: isLoadingOrgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name");

      if (error) throw error;
      return data;
    },
  });

  // Combine and deduplicate: user history first, then global orgs
  const allOptions = [...historyItems.map(h => h.value)];
  organizations.forEach(org => {
    if (!allOptions.some(v => v.toLowerCase() === org.name.toLowerCase())) {
      allOptions.push(org.name);
    }
  });

  // Filter based on search
  const filteredOptions = allOptions.filter((opt) =>
    opt.toLowerCase().includes(search.toLowerCase())
  );

  // Check if search is a new entry
  const isNewEntry = search.trim() && 
    !allOptions.some(opt => opt.toLowerCase() === search.toLowerCase().trim());

  // Get history item by value
  const getHistoryItem = (val: string) => 
    historyItems.find(h => h.value.toLowerCase() === val.toLowerCase());

  // Mutation to save/update history
  const saveMutation = useMutation({
    mutationFn: async (newValue: string) => {
      const user = await getUserWithCache();
      if (!user) throw new Error("Not authenticated");

      const trimmedValue = newValue.trim();
      if (!trimmedValue) return;

      const { error } = await supabase
        .from("user_field_history")
        .upsert(
          {
            user_id: user.id,
            field_type: "organization",
            value: trimmedValue,
            usage_count: 1,
            last_used_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,field_type,value",
          }
        );

      if (error) {
        console.error("Error saving organization history:", error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["field-history", "organization"] });
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
      queryClient.invalidateQueries({ queryKey: ["field-history", "organization"] });
      toast.success("Entry updated");
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
      queryClient.invalidateQueries({ queryKey: ["field-history", "organization"] });
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
    setSearch("");
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

  const isLoading = isLoadingHistory || isLoadingOrgs;

  const [isEditing, setIsEditing] = useState(false);
  const triggerInputRef = useRef<HTMLInputElement>(null);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      if (isEditing && search.trim()) {
        const trimmed = search.trim();
        if (trimmed !== value) {
          handleSelect(trimmed);
        }
      }
      setIsEditing(false);
    }
    setOpen(isOpen);
  };

  const handleTriggerFocus = () => {
    setIsEditing(true);
    setSearch(value);
    if (!open) setOpen(true);
  };

  const handleTriggerBlur = () => {
    setTimeout(() => {
      if (!open) {
        if (search.trim()) {
          const trimmed = search.trim();
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
    setSearch("");
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
              value={isEditing ? search : value}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!isEditing) setIsEditing(true);
                if (!open) setOpen(true);
              }}
              onFocus={handleTriggerFocus}
              onBlur={handleTriggerBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter" && search.trim()) {
                  e.preventDefault();
                  handleSelect(search.trim());
                  setIsEditing(false);
                  triggerInputRef.current?.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setSearch(value);
                  setIsEditing(false);
                  setOpen(false);
                  triggerInputRef.current?.blur();
                }
              }}
              placeholder="Select or type organization..."
              disabled={disabled}
              className={cn(
                "w-full pr-14 font-normal transition-none",
                isEditing && "border-2 border-foreground ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-[2px_2px_0px_0px_hsl(var(--foreground))]",
                !value && !isEditing && "text-muted-foreground"
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
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput 
              placeholder="Search or type organization..." 
              value={search}
              onValueChange={setSearch}
              onKeyDown={(e) => {
                if (e.key === "Enter" && search.trim()) {
                  e.preventDefault();
                  handleSelect(search.trim());
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
                  {filteredOptions.length === 0 && !isNewEntry && (
                    <CommandEmpty>No organizations found. Start typing to create one.</CommandEmpty>
                  )}
                  
                  {isNewEntry && (
                    <CommandGroup heading="Create new">
                      <CommandItem
                        onSelect={() => handleSelect(search.trim())}
                        className="cursor-pointer"
                      >
                        <Plus className="mr-2 h-4 w-4 text-primary" />
                        <span>Create "{search.trim()}"</span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                  
                  {historyItems.length > 0 && (
                    <CommandGroup heading="Your recent entries">
                      {historyItems
                        .filter(item => item.value.toLowerCase().includes(search.toLowerCase()))
                        .map((item) => (
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
                  
                  {organizations.filter(org => 
                    org.name.toLowerCase().includes(search.toLowerCase()) &&
                    !historyItems.some(h => h.value.toLowerCase() === org.name.toLowerCase())
                  ).length > 0 && (
                    <CommandGroup heading="All organizations">
                      {organizations
                        .filter(org => 
                          org.name.toLowerCase().includes(search.toLowerCase()) &&
                          !historyItems.some(h => h.value.toLowerCase() === org.name.toLowerCase())
                        )
                        .map((org) => (
                          <CommandItem
                            key={org.id}
                            value={org.name}
                            onSelect={() => handleSelect(org.name)}
                            className="cursor-pointer"
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                value.toLowerCase() === org.name.toLowerCase()
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            {org.name}
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
            <AlertDialogTitle>Edit Organization</AlertDialogTitle>
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
            <AlertDialogTitle>Delete Organization</AlertDialogTitle>
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
};