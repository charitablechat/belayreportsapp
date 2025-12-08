import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface SwipeBackIndicatorProps {
  progress: number;
  isActive: boolean;
}

/**
 * Visual indicator showing swipe-to-go-back progress
 * Appears as an edge glow on the left side of the screen
 */
export function SwipeBackIndicator({ progress, isActive }: SwipeBackIndicatorProps) {
  if (progress <= 0) return null;

  return (
    <div
      className={cn(
        "fixed left-0 top-0 bottom-0 z-50 pointer-events-none transition-opacity duration-150",
        progress > 0 ? "opacity-100" : "opacity-0"
      )}
      style={{
        width: `${Math.min(progress * 60 + 20, 80)}px`,
      }}
    >
      {/* Edge glow gradient */}
      <div
        className="absolute inset-0 bg-gradient-to-r from-primary/30 to-transparent"
        style={{
          opacity: Math.min(progress * 0.8, 0.6),
        }}
      />
      
      {/* Arrow indicator */}
      <div
        className={cn(
          "absolute top-1/2 -translate-y-1/2 flex items-center justify-center",
          "w-10 h-10 rounded-full bg-primary/20 backdrop-blur-sm border border-primary/30",
          "transition-all duration-150",
          isActive && "bg-primary/40 border-primary/50 scale-110"
        )}
        style={{
          left: `${Math.min(progress * 40, 30)}px`,
          opacity: Math.min(progress * 1.5, 1),
          transform: `translateY(-50%) scale(${0.7 + progress * 0.3})`,
        }}
      >
        <ArrowLeft 
          className={cn(
            "w-5 h-5 text-primary transition-transform duration-150",
            isActive && "text-primary-foreground"
          )}
          style={{
            transform: `translateX(${isActive ? -2 : 0}px)`,
          }}
        />
      </div>

      {/* "Release to go back" text hint */}
      {isActive && (
        <div
          className="absolute top-1/2 left-16 -translate-y-1/2 whitespace-nowrap text-xs font-medium text-primary animate-fade-in"
        >
          Release to go back
        </div>
      )}
    </div>
  );
}
