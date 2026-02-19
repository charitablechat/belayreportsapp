import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LucideIcon, Info } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

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
  actions?: React.ReactNode;
}

export const StatCard = ({ title, value, icon: Icon, description, onClick, hoverContent, actions }: StatCardProps) => {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleCardClick = (e: React.MouseEvent) => {
    if (isMobile && hoverContent) {
      e.stopPropagation();
      setSheetOpen(true);
    } else if (onClick) {
      onClick();
    }
  };

  const handleSheetAction = () => {
    setSheetOpen(false);
    if (onClick) {
      onClick();
    }
  };

  const cardContent = (
    <Card 
      className={`glass-card card-lift ${onClick || (isMobile && hoverContent) ? "cursor-pointer" : ""}`}
      onClick={handleCardClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium tracking-wide uppercase text-muted-foreground">{title}</CardTitle>
        <div className="flex items-center gap-1.5">
          {hoverContent && (
            <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
          )}
          <Icon className="h-5 w-5 text-indigo-500" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="brutalist-metric">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {actions && <div className="mt-2">{actions}</div>}
      </CardContent>
    </Card>
  );

  const popupContent = hoverContent && (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{hoverContent.description}</p>
      
      {hoverContent.details && hoverContent.details.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {hoverContent.details.map((detail, idx) => (
            <li key={idx} className="flex justify-between">
              <span className="text-muted-foreground">• {detail.label}</span>
              <span className="font-medium">{detail.value}</span>
            </li>
          ))}
        </ul>
      )}
      
      {hoverContent.tip && (
        <p className="text-xs text-primary/80 pt-2 border-t">
          💡 {hoverContent.tip}
        </p>
      )}
      
      {onClick && (
        <button
          onClick={handleSheetAction}
          className="w-full text-sm text-primary hover:underline pt-2 text-left"
        >
          View more details →
        </button>
      )}
    </div>
  );

  // No hover content - just render the card
  if (!hoverContent) {
    return cardContent;
  }

  // Mobile: use Sheet for tap-to-view
  if (isMobile) {
    return (
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          {cardContent}
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-xl">
          <SheetHeader className="text-left">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <SheetTitle>{hoverContent.title}</SheetTitle>
            </div>
          </SheetHeader>
          <div className="mt-4">
            {popupContent}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: use HoverCard
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        {cardContent}
      </HoverCardTrigger>
      <HoverCardContent className="w-72" align="start">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{hoverContent.title}</h4>
          {popupContent}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
