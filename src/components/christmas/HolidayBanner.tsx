import { useState } from "react";
import { X } from "lucide-react";
import { Sparkles } from "./Sparkles";

export function HolidayBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem("holiday-banner-dismissed") === "true";
  });

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("holiday-banner-dismissed", "true");
  };

  if (dismissed) return null;

  return (
    <div className="relative nye-gradient text-white overflow-hidden">
      {/* Sparkles on top */}
      <div className="absolute top-0 left-0 right-0">
        <Sparkles />
      </div>
      
      {/* Banner content */}
      <div className="relative pt-10 pb-3 px-4">
        <div className="flex items-center justify-center gap-2 text-center">
          <span className="text-xl" role="img" aria-label="Fireworks">🎆</span>
          <span className="font-semibold text-sm sm:text-base">
            Happy New Year from Rope Works!
          </span>
          <span className="text-xl" role="img" aria-label="Champagne">🍾</span>
        </div>
        
        {/* Decorative stars */}
        <div className="absolute top-10 left-4 text-amber-300/40 text-xs animate-twinkle">✦</div>
        <div className="absolute top-12 right-8 text-amber-300/40 text-xs animate-twinkle" style={{ animationDelay: '0.5s' }}>✦</div>
        <div className="absolute bottom-2 left-1/4 text-amber-300/30 text-xs animate-twinkle" style={{ animationDelay: '1s' }}>✦</div>
        <div className="absolute top-11 left-1/3 text-purple-300/30 text-xs animate-twinkle" style={{ animationDelay: '0.3s' }}>⭐</div>
        <div className="absolute bottom-1 right-1/4 text-amber-300/30 text-xs animate-twinkle" style={{ animationDelay: '0.7s' }}>✦</div>
        
        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          className="absolute top-10 right-2 p-1 rounded-full hover:bg-white/10 transition-colors"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
