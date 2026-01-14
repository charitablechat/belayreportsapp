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
          <div className="flex justify-center items-center gap-3 md:gap-6 text-sm md:text-base">
            {/* Left candy hearts - 3 in a horizontal row */}
            <div className="hidden md:flex flex-row gap-2 items-center">
              <div className="relative animate-candy-wiggle">
                <svg width="42" height="38" viewBox="0 0 50 45" className="drop-shadow-md">
                  <defs>
                    <linearGradient id="candyL1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="hsl(340, 70%, 88%)" />
                      <stop offset="100%" stopColor="hsl(340, 60%, 80%)" />
                    </linearGradient>
                  </defs>
                  <path d="M25 42 C25 42 5 28 5 15 C5 8 10 3 17 3 C21 3 24 5 25 8 C26 5 29 3 33 3 C40 3 45 8 45 15 C45 28 25 42 25 42Z" fill="url(#candyL1)" stroke="hsl(340, 50%, 75%)" strokeWidth="1"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[6px] font-bold pt-0.5" style={{ color: "hsl(340, 50%, 40%)" }}>BE MINE</span>
              </div>
              <div className="relative animate-candy-wiggle" style={{ animationDelay: "0.2s" }}>
                <svg width="42" height="38" viewBox="0 0 50 45" className="drop-shadow-md">
                  <defs>
                    <linearGradient id="candyL2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="hsl(280, 50%, 88%)" />
                      <stop offset="100%" stopColor="hsl(280, 40%, 80%)" />
                    </linearGradient>
                  </defs>
                  <path d="M25 42 C25 42 5 28 5 15 C5 8 10 3 17 3 C21 3 24 5 25 8 C26 5 29 3 33 3 C40 3 45 8 45 15 C45 28 25 42 25 42Z" fill="url(#candyL2)" stroke="hsl(280, 40%, 75%)" strokeWidth="1"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold pt-0.5" style={{ color: "hsl(280, 40%, 40%)" }}>XOXO</span>
              </div>
              <div className="relative animate-candy-wiggle" style={{ animationDelay: "0.4s" }}>
                <svg width="42" height="38" viewBox="0 0 50 45" className="drop-shadow-md">
                  <defs>
                    <linearGradient id="candyL3" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="hsl(0, 0%, 95%)" />
                      <stop offset="100%" stopColor="hsl(0, 0%, 88%)" />
                    </linearGradient>
                  </defs>
                  <path d="M25 42 C25 42 5 28 5 15 C5 8 10 3 17 3 C21 3 24 5 25 8 C26 5 29 3 33 3 C40 3 45 8 45 15 C45 28 25 42 25 42Z" fill="url(#candyL3)" stroke="hsl(0, 0%, 80%)" strokeWidth="1"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[6px] font-bold pt-0.5" style={{ color: "hsl(340, 30%, 45%)" }}>CUTIE</span>
              </div>
            </div>
            
            {/* Countdown boxes */}
            <div className="flex gap-3 md:gap-4">
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
            
            {/* Right candy hearts - 3 in a horizontal row */}
            <div className="hidden md:flex flex-row gap-2 items-center">
              <div className="relative animate-candy-wiggle" style={{ animationDelay: "0.5s" }}>
                <svg width="42" height="38" viewBox="0 0 50 45" className="drop-shadow-md">
                  <defs>
                    <linearGradient id="candyR1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="hsl(50, 80%, 90%)" />
                      <stop offset="100%" stopColor="hsl(50, 70%, 82%)" />
                    </linearGradient>
                  </defs>
                  <path d="M25 42 C25 42 5 28 5 15 C5 8 10 3 17 3 C21 3 24 5 25 8 C26 5 29 3 33 3 C40 3 45 8 45 15 C45 28 25 42 25 42Z" fill="url(#candyR1)" stroke="hsl(50, 60%, 75%)" strokeWidth="1"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[6px] font-bold pt-0.5" style={{ color: "hsl(50, 50%, 35%)" }}>SWEET</span>
              </div>
              <div className="relative animate-candy-wiggle" style={{ animationDelay: "0.7s" }}>
                <svg width="42" height="38" viewBox="0 0 50 45" className="drop-shadow-md">
                  <defs>
                    <linearGradient id="candyR2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="hsl(160, 50%, 85%)" />
                      <stop offset="100%" stopColor="hsl(160, 40%, 78%)" />
                    </linearGradient>
                  </defs>
                  <path d="M25 42 C25 42 5 28 5 15 C5 8 10 3 17 3 C21 3 24 5 25 8 C26 5 29 3 33 3 C40 3 45 8 45 15 C45 28 25 42 25 42Z" fill="url(#candyR2)" stroke="hsl(160, 40%, 70%)" strokeWidth="1"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold pt-0.5" style={{ color: "hsl(160, 40%, 35%)" }}>LOVE</span>
              </div>
              <div className="relative animate-candy-wiggle" style={{ animationDelay: "0.9s" }}>
                <svg width="42" height="38" viewBox="0 0 50 45" className="drop-shadow-md">
                  <defs>
                    <linearGradient id="candyR3" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="hsl(340, 55%, 82%)" />
                      <stop offset="100%" stopColor="hsl(340, 50%, 75%)" />
                    </linearGradient>
                  </defs>
                  <path d="M25 42 C25 42 5 28 5 15 C5 8 10 3 17 3 C21 3 24 5 25 8 C26 5 29 3 33 3 C40 3 45 8 45 15 C45 28 25 42 25 42Z" fill="url(#candyR3)" stroke="hsl(340, 45%, 70%)" strokeWidth="1"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold pt-0.5" style={{ color: "hsl(340, 45%, 40%)" }}>HUG ME</span>
              </div>
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
