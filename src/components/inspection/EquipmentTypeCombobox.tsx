import { useState, useRef, useCallback } from "react";
import { Check, Plus } from "lucide-react";
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
  placeholder?: string;
  className?: string;
}

export function EquipmentTypeCombobox({
  value,
  onChange,
  onBlur,
  options,
  onAddOption,
  placeholder = "Enter or select type",
  className,
}: EquipmentTypeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
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
    setSearchValue("");
    if (!open) setOpen(true);
  }, [open]);

  const handleTriggerBlur = useCallback(() => {
    setTimeout(() => {
      if (!open) {
        if (searchValue.trim()) {
          const trimmed = searchValue.trim();
          if (trimmed !== value) {
            // Check if it's a new entry
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
                {filteredOptions.map((opt, index) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => handleSelect(opt)}
                    className={cn(
                      "cursor-pointer",
                      index % 2 === 0 ? "bg-blue-100" : "bg-gray-50"
                    )}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === opt ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="whitespace-normal break-words">{opt}</span>
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
