import { useState, useRef, useCallback } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
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
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface EquipmentTypeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options: string[];
  onAddOption: (label: string) => void;
  onDeleteOption?: (label: string) => void;
  placeholder?: string;
  className?: string;
}

export function EquipmentTypeCombobox({
  value,
  onChange,
  onBlur,
  options,
  onAddOption,
  onDeleteOption,
  placeholder = "Enter or select type",
  className,
}: EquipmentTypeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const triggerInputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(searchValue.toLowerCase())
  );

  const isNewEntry =
    searchValue.trim() &&
    !options.some(
      (opt) => opt.toLowerCase() === searchValue.trim().toLowerCase()
    );

  const handleSelect = useCallback(
    (selectedValue: string) => {
      onChange(selectedValue);
      setOpen(false);
      setSearchValue("");
      setIsEditing(false);
      setConfirmingDelete(null);
      onBlur?.();
    },
    [onChange, onBlur]
  );

  const handleCreateNew = useCallback(() => {
    const newValue = searchValue.trim();
    if (newValue) {
      onAddOption(newValue);
      handleSelect(newValue);
    }
  }, [searchValue, onAddOption, handleSelect]);

  const handleDeleteConfirm = useCallback(
    (label: string, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onDeleteOption?.(label);
      setConfirmingDelete(null);
    },
    [onDeleteOption]
  );

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmingDelete(null);
  }, []);

  const placeCursorAtEnd = useCallback(() => {
    const input = triggerInputRef.current;
    if (!input) return;
    const setCaret = () => {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    };
    setCaret();
    requestAnimationFrame(setCaret);
    setTimeout(setCaret, 0);
  }, []);

  const normalizeTriggerSelection = useCallback(() => {
    const input = triggerInputRef.current;
    if (!input) return;
    if (
      input.value.length > 0 &&
      input.selectionStart === 0 &&
      input.selectionEnd === input.value.length
    ) {
      placeCursorAtEnd();
    }
  }, [placeCursorAtEnd]);

  const handleTriggerFocus = useCallback(() => {
    setIsEditing(true);
    setSearchValue(value);
    setConfirmingDelete(null);
    placeCursorAtEnd();
    if (!open) setOpen(true);
  }, [value, open, placeCursorAtEnd]);

  const handleTriggerBlur = useCallback(() => {
    setTimeout(() => {
      if (!open) {
        if (searchValue.trim()) {
          const trimmed = searchValue.trim();
          if (trimmed !== value) {
            const isNew = !options.some(
              (opt) => opt.toLowerCase() === trimmed.toLowerCase()
            );
            if (isNew) {
              onAddOption(trimmed);
            }
            onChange(trimmed);
          }
        }
        setIsEditing(false);
        setConfirmingDelete(null);
        onBlur?.();
      }
    }, 200);
  }, [open, searchValue, value, options, onChange, onAddOption, onBlur]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        if (isEditing && searchValue.trim()) {
          const trimmed = searchValue.trim();
          if (trimmed !== value) {
            const isNew = !options.some(
              (opt) => opt.toLowerCase() === trimmed.toLowerCase()
            );
            if (isNew) {
              onAddOption(trimmed);
            }
            onChange(trimmed);
          }
        }
        setIsEditing(false);
        setConfirmingDelete(null);
        onBlur?.();
      }
      setOpen(isOpen);
    },
    [isEditing, searchValue, value, options, onChange, onAddOption, onBlur]
  );

  return (
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
                const trimmed = searchValue.trim();
                const isNew = !options.some(
                  (opt) => opt.toLowerCase() === trimmed.toLowerCase()
                );
                if (isNew) {
                  onAddOption(trimmed);
                }
                handleSelect(trimmed);
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
            className={cn(
              "w-full font-normal transition-none",
              isEditing &&
                "border-2 border-foreground ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-[2px_2px_0px_0px_hsl(var(--foreground))]",
              !value && !isEditing && "text-muted-foreground",
              className
            )}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type new..."
            value={searchValue}
            onValueChange={setSearchValue}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchValue.trim()) {
                e.preventDefault();
                const trimmed = searchValue.trim();
                const isNew = !options.some(
                  (opt) => opt.toLowerCase() === trimmed.toLowerCase()
                );
                if (isNew) {
                  onAddOption(trimmed);
                }
                handleSelect(trimmed);
              }
            }}
          />
          <CommandList>
            {filteredOptions.length === 0 && !isNewEntry && (
              <CommandEmpty>No entries found. Start typing to create one.</CommandEmpty>
            )}

            {isNewEntry && (
              <CommandGroup heading="Create new">
                <CommandItem onSelect={handleCreateNew} className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4 text-primary" />
                  <span>Create "{searchValue.trim()}"</span>
                </CommandItem>
              </CommandGroup>
            )}

            {filteredOptions.length > 0 && (
              <CommandGroup heading="Equipment types">
                {filteredOptions.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      if (confirmingDelete !== opt) {
                        handleSelect(opt);
                      }
                    }}
                    className="cursor-pointer flex items-center justify-between gap-2"
                  >
                    {confirmingDelete === opt ? (
                      <div className="flex items-center justify-between w-full gap-2">
                        <span className="text-sm text-destructive font-medium whitespace-normal break-words">
                          Delete "{opt}"?
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleDeleteConfirm(opt, e)}
                            className="p-1 rounded-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                            aria-label="Confirm delete"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteCancel}
                            className="p-1 rounded-sm hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Cancel delete"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Check
                            className={cn(
                              "h-4 w-4 shrink-0",
                              value === opt ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span
                            className="whitespace-normal break-words text-sm"
                            title={opt}
                          >
                            {opt}
                          </span>
                        </div>
                        {onDeleteOption && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setConfirmingDelete(opt);
                            }}
                            className="shrink-0 p-1 rounded-sm text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            aria-label={`Delete ${opt}`}
                            tabIndex={-1}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
