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
      className={`
        backdrop-blur-md bg-white/5 dark:bg-white/[0.03] 
        border border-white/10 dark:border-white/[0.06]
        shadow-lg shadow-black/5
        rounded-xl
        transition-all duration-300 ease-out
        ${onClick || (isMobile && hoverContent) ? "cursor-pointer hover:-translate-y-0.5 hover:bg-white/10 dark:hover:bg-white/[0.06] hover:shadow-xl hover:border-white/20" : ""}
      `}
      onClick={handleCardClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/80">{title}</CardTitle>
        <div className="flex items-center gap-1.5">
          {hoverContent && (
            <Info className="h-3.5 w-3.5 text-muted-foreground/40" />
          )}
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-4xl font-black tracking-tight font-mono tabular-nums">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground/70 mt-1.5">{description}</p>
        )}
        {actions && <div className="mt-3">{actions}</div>}
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
