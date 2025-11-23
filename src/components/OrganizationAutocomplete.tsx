import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

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

  const { data: organizations = [], isLoading } = useQuery({
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

  // Filter organizations based on search
  const filteredOrgs = organizations.filter((org) =>
    org.name.toLowerCase().includes(search.toLowerCase())
  );

  const isNewOrganization = value && !organizations.some(
    (org) => org.name.toLowerCase() === value.toLowerCase()
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          {value || "Select or type organization..."}
          {isNewOrganization && value && (
            <span className="ml-2 text-xs text-muted-foreground">(New)</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search or type organization..." 
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {search ? (
                <div className="p-4 text-sm">
                  <p className="font-medium">Create "{search}"</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Press Enter to create a new organization
                  </p>
                </div>
              ) : (
                "No organizations found."
              )}
            </CommandEmpty>
            {filteredOrgs.length > 0 && (
              <CommandGroup>
                {filteredOrgs.map((org) => (
                  <CommandItem
                    key={org.id}
                    value={org.name}
                    onSelect={() => {
                      onChange(org.name);
                      setOpen(false);
                      setSearch("");
                    }}
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
            {search && !filteredOrgs.some(org => 
              org.name.toLowerCase() === search.toLowerCase()
            ) && (
              <CommandGroup>
                <CommandItem
                  value={search}
                  onSelect={() => {
                    onChange(search);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="font-medium"
                >
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  Create "{search}" (New)
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
