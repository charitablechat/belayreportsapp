import { Badge } from "@/components/ui/badge";

interface VersionBadgeProps {
  compact?: boolean;
}

export function VersionBadge({ compact = false }: VersionBadgeProps) {
  const version = import.meta.env.APP_VERSION || '0.0.0';
  
  return (
    <div className={compact ? "flex justify-center py-2" : "flex justify-center py-6"}>
      <Badge 
        variant="outline" 
        className="text-xs font-mono text-muted-foreground/60 border-muted-foreground/20 px-3 py-1"
      >
        v{version}
      </Badge>
    </div>
  );
}
