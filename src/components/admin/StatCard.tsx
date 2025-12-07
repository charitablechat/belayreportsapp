import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { LucideIcon, Info } from "lucide-react";

export interface StatCardHoverContent {
  title: string;
  description: string;
  details?: { label: string; value: string | number }[];
  tip?: string;
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  onClick?: () => void;
  hoverContent?: StatCardHoverContent;
}

export const StatCard = ({ title, value, icon: Icon, description, onClick, hoverContent }: StatCardProps) => {
  const cardContent = (
    <Card 
      className={onClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="flex items-center gap-1.5">
          {hoverContent && (
            <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
          )}
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );

  if (!hoverContent) {
    return cardContent;
  }

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        {cardContent}
      </HoverCardTrigger>
      <HoverCardContent className="w-72" align="start">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{hoverContent.title}</h4>
          <p className="text-sm text-muted-foreground">{hoverContent.description}</p>
          
          {hoverContent.details && hoverContent.details.length > 0 && (
            <ul className="space-y-1 text-sm">
              {hoverContent.details.map((detail, idx) => (
                <li key={idx} className="flex justify-between">
                  <span className="text-muted-foreground">• {detail.label}</span>
                  <span className="font-medium">{detail.value}</span>
                </li>
              ))}
            </ul>
          )}
          
          {hoverContent.tip && (
            <p className="text-xs text-primary/80 pt-1 border-t">
              💡 {hoverContent.tip}
            </p>
          )}
          
          {onClick && (
            <p className="text-xs text-muted-foreground pt-1">
              Click for more details →
            </p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
