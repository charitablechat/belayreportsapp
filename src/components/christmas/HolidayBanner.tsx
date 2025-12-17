import { useState } from "react";
import { X } from "lucide-react";
import { ChristmasLights } from "./ChristmasLights";

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
    <div className="relative bg-gradient-to-r from-red-900/90 via-green-900/90 to-red-900/90 text-white overflow-hidden">
      {/* Christmas lights on top */}
      <div className="absolute top-0 left-0 right-0">
        <ChristmasLights />
      </div>
      
      {/* Banner content */}
      <div className="relative pt-10 pb-3 px-4">
        <div className="flex items-center justify-center gap-2 text-center">
          <span className="text-xl" role="img" aria-label="Christmas tree">🎄</span>
          <span className="font-semibold text-sm sm:text-base">
            Happy Holidays from Rope Works!
          </span>
          <span className="text-xl" role="img" aria-label="Santa">🎅</span>
        </div>
        
        {/* Decorative snowflakes */}
        <div className="absolute top-10 left-4 text-white/30 text-xs">❄</div>
        <div className="absolute top-12 right-8 text-white/30 text-xs">❄</div>
        <div className="absolute bottom-2 left-1/4 text-white/20 text-xs">❄</div>
        
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
