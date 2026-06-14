import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

interface DashboardSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function DashboardSearchBar({ value, onChange }: DashboardSearchBarProps) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => onChange(local), 300);
    return () => clearTimeout(t);
  }, [local, onChange]);

  useEffect(() => {
    // Intentionally omitting `local` from deps to avoid infinite loops
    if (value !== local) setLocal(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        placeholder="Search by name, location, or assignee..."
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className="pl-9 pr-9 glass-input"
      />
      {local && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={() => { setLocal(''); onChange(''); }}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}
