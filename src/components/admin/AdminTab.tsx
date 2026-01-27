import { TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { LucideIcon } from "lucide-react";

interface AdminTabProps {
  value: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

export const AdminTab = ({ value, icon: Icon, title, description }: AdminTabProps) => {
  const isMobile = useIsMobile();
  
  const tabContent = (
    <TabsTrigger 
      value={value} 
      className="justify-start gap-3 w-full overflow-hidden group hover:bg-accent/50 data-[state=active]:bg-accent"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary group-data-[state=active]:text-primary" />
      <span className="shrink-0">{title}</span>
      <span className="text-xs text-muted-foreground font-normal truncate">— {description}</span>
    </TabsTrigger>
  );

  if (isMobile) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <div className="w-full">{tabContent}</div>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-auto max-w-xs text-sm p-3">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground text-xs mt-1">{description}</p>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {tabContent}
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
};
