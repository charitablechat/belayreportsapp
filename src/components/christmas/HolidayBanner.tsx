import { useState, useEffect, useMemo } from "react";
import { X, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CandyHearts } from "./CandyHearts";

function useCountdown(targetDate: Date) {
  const [timeLeft, setTimeLeft] = useState(() => {
    const now = new Date();
    const difference = targetDate.getTime() - now.getTime();
    
    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, isPast: true };
    }
    
    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((difference / 1000 / 60) % 60),
      seconds: Math.floor((difference / 1000) % 60),
      isPast: false,
    };
  });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      const difference = targetDate.getTime() - now.getTime();

      if (difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, isPast: true };
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
        isPast: false,
      };
    };

    const timer = setInterval(() => setTimeLeft(calculateTimeLeft()), 1000);
    return () => clearInterval(timer);
  }, [targetDate]);

  return timeLeft;
}

export function HolidayBanner() {
  const [isDismissed, setIsDismissed] = useState(() => {
    return sessionStorage.getItem("valentine-banner-dismissed") === "true";
  });

  // Valentine's Day 2026 - memoized to prevent infinite re-renders
  const valentinesDay = useMemo(() => new Date("2026-02-14T00:00:00"), []);
  const { days, hours, minutes, seconds, isPast } = useCountdown(valentinesDay);

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem("valentine-banner-dismissed", "true");
  };

  if (isDismissed) return null;

  return (
    <div className="relative overflow-hidden rounded-lg valentine-gradient text-white mb-6 shadow-lg">
      {/* Candy hearts decoration at top */}
      <div className="absolute top-0 left-0 right-0">
        <CandyHearts />
      </div>

      {/* Content */}
      <div className="relative z-10 px-4 py-6 pt-10 text-center">
        {/* Dismiss button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 text-white/70 hover:text-white hover:bg-white/10 h-7 w-7"
          onClick={handleDismiss}
        >
          <X className="h-4 w-4" />
        </Button>

        {/* Floating hearts decoration */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <Heart className="absolute top-4 left-[10%] w-4 h-4 text-pink-200/30 animate-heart-pulse" style={{ animationDelay: "0s" }} fill="currentColor" />
          <Heart className="absolute top-8 right-[15%] w-3 h-3 text-red-200/25 animate-heart-pulse" style={{ animationDelay: "0.5s" }} fill="currentColor" />
          <Heart className="absolute bottom-6 left-[20%] w-3 h-3 text-pink-100/20 animate-heart-pulse" style={{ animationDelay: "1s" }} fill="currentColor" />
          <Heart className="absolute bottom-4 right-[25%] w-4 h-4 text-red-100/25 animate-heart-pulse" style={{ animationDelay: "0.3s" }} fill="currentColor" />
          <Heart className="absolute top-12 left-[40%] w-2 h-2 text-pink-200/30 animate-heart-pulse" style={{ animationDelay: "0.7s" }} fill="currentColor" />
        </div>

        {/* Emojis */}
        <div className="text-2xl mb-2 flex justify-center gap-2">
          💕 🍫 🌹 💝 ❤️
        </div>

        {/* Message */}
        <h3 className="text-lg md:text-xl font-bold mb-3 drop-shadow-md">
          {isPast ? "Happy Valentine's Day!" : "Valentine's Day Countdown"}
        </h3>

        {!isPast && (
          <div className="flex justify-center gap-3 md:gap-4 text-sm md:text-base">
            <div className="bg-white/15 backdrop-blur-sm rounded-lg px-3 py-2 min-w-[60px]">
              <div className="text-xl md:text-2xl font-bold">{days}</div>
              <div className="text-xs text-white/80">days</div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-lg px-3 py-2 min-w-[60px]">
              <div className="text-xl md:text-2xl font-bold">{hours}</div>
              <div className="text-xs text-white/80">hours</div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-lg px-3 py-2 min-w-[60px]">
              <div className="text-xl md:text-2xl font-bold">{minutes}</div>
              <div className="text-xs text-white/80">min</div>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-lg px-3 py-2 min-w-[60px]">
              <div className="text-xl md:text-2xl font-bold">{seconds}</div>
              <div className="text-xs text-white/80">sec</div>
            </div>
          </div>
        )}

        {isPast && (
          <p className="text-white/90 text-sm md:text-base">
            Wishing you love and happiness! 💖
          </p>
        )}

        <p className="text-xs text-white/70 mt-3">
          From all of us at Rope Works
        </p>
      </div>

      {/* Bottom decorative gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-400/50 via-red-400/50 to-pink-400/50" />
    </div>
  );
}
