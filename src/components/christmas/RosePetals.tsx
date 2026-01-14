import { useEffect, useState } from "react";

interface Petal {
  id: number;
  left: number;
  animationDuration: number;
  animationDelay: number;
  size: number;
  opacity: number;
  color: string;
  rotation: number;
}

const PETAL_COLORS = [
  "hsl(350, 80%, 55%)",   // Deep red
  "hsl(340, 70%, 65%)",   // Pink
  "hsl(355, 75%, 60%)",   // Rose red
  "hsl(345, 65%, 70%)",   // Light pink
  "hsl(5, 70%, 60%)",     // Coral red
];

export function RosePetals() {
  const [petals, setPetals] = useState<Petal[]>([]);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
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

    const isMobile = window.innerWidth < 768;
    const petalCount = isMobile ? 12 : 25;

    const newPetals: Petal[] = Array.from({ length: petalCount }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      animationDuration: 12 + Math.random() * 10,
      animationDelay: Math.random() * 15,
      size: 14 + Math.random() * 12,
      opacity: 0.5 + Math.random() * 0.35,
      color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
      rotation: Math.random() * 360,
    }));

    setPetals(newPetals);
  }, [prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[42] overflow-hidden">
      {petals.map((petal) => (
        <div
          key={petal.id}
          className="absolute animate-petalfall"
          style={{
            left: `${petal.left}%`,
            animationDuration: `${petal.animationDuration}s`,
            animationDelay: `${petal.animationDelay}s`,
            opacity: petal.opacity,
            transform: `rotate(${petal.rotation}deg)`,
          }}
        >
          <svg
            width={petal.size}
            height={petal.size * 1.3}
            viewBox="0 0 30 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.15))`,
            }}
          >
            <defs>
              <linearGradient id={`petalGradient-${petal.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={petal.color} />
                <stop offset="50%" stopColor={petal.color} stopOpacity="0.9" />
                <stop offset="100%" stopColor={petal.color} stopOpacity="0.7" />
              </linearGradient>
            </defs>
            {/* Rose petal shape */}
            <path
              d="M15 0 
                 C8 5 2 12 2 22 
                 C2 32 8 38 15 40 
                 C22 38 28 32 28 22 
                 C28 12 22 5 15 0Z"
              fill={`url(#petalGradient-${petal.id})`}
            />
            {/* Petal vein/texture */}
            <path
              d="M15 5 Q14 20 15 35"
              stroke={petal.color}
              strokeWidth="0.5"
              strokeOpacity="0.4"
              fill="none"
            />
            <path
              d="M10 15 Q15 18 15 25"
              stroke={petal.color}
              strokeWidth="0.3"
              strokeOpacity="0.3"
              fill="none"
            />
            <path
              d="M20 15 Q15 18 15 25"
              stroke={petal.color}
              strokeWidth="0.3"
              strokeOpacity="0.3"
              fill="none"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}
