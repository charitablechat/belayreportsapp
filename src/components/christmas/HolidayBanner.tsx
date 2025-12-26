import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Sparkles } from "./Sparkles";

function useCountdown(targetDate: Date) {
  const [timeLeft, setTimeLeft] = useState(() => calculateTimeLeft(targetDate));

  function calculateTimeLeft(target: Date) {
    const now = new Date();
    const difference = target.getTime() - now.getTime();

    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, isNewYear: true };
    }

    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((difference / 1000 / 60) % 60),
      seconds: Math.floor((difference / 1000) % 60),
      isNewYear: false,
    };
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(targetDate));
    }, 1000);

    return () => clearInterval(timer);
  }, [targetDate]);

  return timeLeft;
}

export function HolidayBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem("holiday-banner-dismissed") === "true";
  });

  // Target: Midnight on January 1, 2026
  const newYearDate = new Date("2026-01-01T00:00:00");
  const { days, hours, minutes, seconds, isNewYear } = useCountdown(newYearDate);

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
        <div className="flex flex-col items-center justify-center gap-1 text-center">
          <div className="flex items-center gap-2">
            <span className="text-xl" role="img" aria-label="Fireworks">🎆</span>
            <span className="font-semibold text-sm sm:text-base">
              {isNewYear ? "Happy New Year 2026!" : "Happy New Year from Rope Works!"}
            </span>
            <span className="text-xl" role="img" aria-label="Champagne">🍾</span>
          </div>
          
          {/* Countdown Timer */}
          {!isNewYear && (
            <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm mt-1">
              <div className="flex flex-col items-center bg-white/10 rounded px-1.5 sm:px-2 py-0.5">
                <span className="font-bold text-amber-300">{days}</span>
                <span className="text-[10px] text-white/70">days</span>
              </div>
              <span className="text-white/50">:</span>
              <div className="flex flex-col items-center bg-white/10 rounded px-1.5 sm:px-2 py-0.5">
                <span className="font-bold text-amber-300">{hours.toString().padStart(2, '0')}</span>
                <span className="text-[10px] text-white/70">hrs</span>
              </div>
              <span className="text-white/50">:</span>
              <div className="flex flex-col items-center bg-white/10 rounded px-1.5 sm:px-2 py-0.5">
                <span className="font-bold text-amber-300">{minutes.toString().padStart(2, '0')}</span>
                <span className="text-[10px] text-white/70">min</span>
              </div>
              <span className="text-white/50">:</span>
              <div className="flex flex-col items-center bg-white/10 rounded px-1.5 sm:px-2 py-0.5">
                <span className="font-bold text-amber-300">{seconds.toString().padStart(2, '0')}</span>
                <span className="text-[10px] text-white/70">sec</span>
              </div>
            </div>
          )}
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
