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

    // Generate snowflakes
    const flakes: Snowflake[] = [];
    const count = window.innerWidth < 768 ? 30 : 50;

    for (let i = 0; i < count; i++) {
      flakes.push({
        id: i,
        left: Math.random() * 100,
        animationDuration: 8 + Math.random() * 12,
        animationDelay: Math.random() * -20,
        size: 4 + Math.random() * 8,
        opacity: 0.3 + Math.random() * 0.5,
      });
    }

    setSnowflakes(flakes);
  }, [prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-10">
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
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-full h-full text-white drop-shadow-sm"
          >
            <path d="M12 0L12.5 3H11.5L12 0ZM12 24L11.5 21H12.5L12 24ZM0 12L3 11.5V12.5L0 12ZM24 12L21 12.5V11.5L24 12ZM3.51 3.51L5.64 5.64L4.93 6.35L3.51 3.51ZM20.49 20.49L18.36 18.36L19.07 17.65L20.49 20.49ZM3.51 20.49L6.35 19.07L5.64 18.36L3.51 20.49ZM20.49 3.51L17.65 4.93L18.36 5.64L20.49 3.51ZM12 6A6 6 0 1 0 12 18A6 6 0 1 0 12 6ZM12 8A4 4 0 1 1 12 16A4 4 0 1 1 12 8Z" />
          </svg>
        </div>
      ))}
    </div>
  );
}
