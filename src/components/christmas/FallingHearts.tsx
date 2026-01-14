import { useEffect, useState } from "react";

interface Heart {
  id: number;
  left: string;
  animationDuration: string;
  animationDelay: string;
  size: number;
  opacity: number;
  color: string;
}

const HEART_COLORS = [
  "hsl(350, 80%, 60%)",   // Red
  "hsl(340, 70%, 70%)",   // Pink
  "hsl(350, 80%, 75%)",   // Light pink
  "hsl(15, 60%, 65%)",    // Rose gold
  "hsl(340, 60%, 80%)",   // Soft pink
];

export function FallingHearts() {
  const [hearts, setHearts] = useState<Heart[]>([]);
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

    // Reduce count on mobile for performance
    const isMobile = window.innerWidth < 768;
    const heartCount = isMobile ? 8 : 15;

    const newHearts: Heart[] = Array.from({ length: heartCount }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      animationDuration: `${8 + Math.random() * 12}s`,
      animationDelay: `${Math.random() * 10}s`,
      size: 10 + Math.random() * 14,
      opacity: 0.4 + Math.random() * 0.4,
      color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)],
    }));

    setHearts(newHearts);
  }, [prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[45] overflow-hidden">
      {hearts.map((heart) => (
        <div
          key={heart.id}
          className="absolute animate-heartfall"
          style={{
            left: heart.left,
            animationDuration: heart.animationDuration,
            animationDelay: heart.animationDelay,
            opacity: heart.opacity,
          }}
        >
          <svg
            width={heart.size}
            height={heart.size}
            viewBox="0 0 24 24"
            fill={heart.color}
            xmlns="http://www.w3.org/2000/svg"
            style={{
              filter: `drop-shadow(0 0 3px ${heart.color})`,
            }}
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </div>
      ))}
    </div>
  );
}
