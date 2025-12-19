import { useEffect, useState } from "react";

interface Snowflake {
  id: number;
  left: number;
  animationDuration: number;
  animationDelay: number;
  size: number;
  opacity: number;
}

export function Snowfall() {
  const [snowflakes, setSnowflakes] = useState<Snowflake[]>([]);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check for reduced motion preference
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;

    // Generate snowflakes - doubled count for more visibility
    const flakes: Snowflake[] = [];
    const count = window.innerWidth < 768 ? 60 : 100;

    for (let i = 0; i < count; i++) {
      flakes.push({
        id: i,
        left: Math.random() * 100,
        animationDuration: 8 + Math.random() * 12,
        animationDelay: Math.random() * -20,
        size: 12 + Math.random() * 12, // 12-24px (bigger snowflakes)
        opacity: 0.6 + Math.random() * 0.3, // 0.6-0.9
      });
    }

    setSnowflakes(flakes);
  }, [prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      {snowflakes.map((flake) => (
        <div
          key={flake.id}
          className="absolute animate-snowfall"
          style={{
            left: `${flake.left}%`,
            animationDuration: `${flake.animationDuration}s`,
            animationDelay: `${flake.animationDelay}s`,
            width: `${flake.size}px`,
            height: `${flake.size}px`,
            opacity: flake.opacity,
          }}
        >
          <svg
            viewBox="0 0 100 100"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="w-full h-full text-white drop-shadow-[0_1px_3px_rgba(255,255,255,0.6)]"
          >
            {/* Main 6 arms */}
            <line x1="50" y1="5" x2="50" y2="95" />
            <line x1="11" y1="27.5" x2="89" y2="72.5" />
            <line x1="11" y1="72.5" x2="89" y2="27.5" />
            
            {/* Crystal branches - top */}
            <line x1="50" y1="20" x2="38" y2="32" />
            <line x1="50" y1="20" x2="62" y2="32" />
            
            {/* Crystal branches - bottom */}
            <line x1="50" y1="80" x2="38" y2="68" />
            <line x1="50" y1="80" x2="62" y2="68" />
            
            {/* Crystal branches - diagonal arms */}
            <line x1="24" y1="35" x2="28" y2="22" />
            <line x1="24" y1="35" x2="14" y2="38" />
            <line x1="76" y1="65" x2="72" y2="78" />
            <line x1="76" y1="65" x2="86" y2="62" />
            <line x1="24" y1="65" x2="28" y2="78" />
            <line x1="24" y1="65" x2="14" y2="62" />
            <line x1="76" y1="35" x2="72" y2="22" />
            <line x1="76" y1="35" x2="86" y2="38" />
          </svg>
        </div>
      ))}
    </div>
  );
}
