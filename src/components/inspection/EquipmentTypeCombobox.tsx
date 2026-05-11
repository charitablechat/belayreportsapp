import { useState, useCallback, useRef, useEffect } from "react";
import { Check, Plus, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const commandInputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(searchValue.toLowerCase())
  );

  const isNewEntry =
    searchValue.trim() &&
    !options.some(
      (opt) => opt.toLowerCase() === searchValue.trim().toLowerCase()
    );

  const commitValue = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      // Never silently wipe a previously non-empty value with an empty
      // search buffer. The user must use an explicit clear gesture.
      if (!trimmed) return;
      if (trimmed !== value) {
        const isNew = !options.some(
          (opt) => opt.toLowerCase() === trimmed.toLowerCase()
        );
        if (isNew) onAddOption(trimmed);
        onChange(trimmed);
      }
    },
    [value, options, onChange, onAddOption]
  );

  const handleSelect = useCallback(
    (selectedValue: string) => {
      commitValue(selectedValue);
      setSearchValue("");
      setOpen(false);
    },
    [commitValue]
  );

  const handleCreateNew = useCallback(() => {
    const newValue = searchValue.trim();
    if (newValue) handleSelect(newValue);
  }, [searchValue, handleSelect]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        if (searchValue.trim()) commitValue(searchValue);
        setSearchValue("");
        onBlur?.();
      }
      setOpen(isOpen);
    },
    [searchValue, commitValue, onBlur]
  );

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => commandInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal text-left",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          commandInputRef.current?.focus();
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            ref={commandInputRef}
            placeholder="Search or type new..."
            value={searchValue}
            onValueChange={setSearchValue}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchValue.trim()) {
                e.preventDefault();
                handleSelect(searchValue.trim());
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
