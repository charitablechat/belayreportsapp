import { useState, useCallback } from "react";

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
}

const SPARKLE_COLORS = [
  "hsl(350, 80%, 65%)",   // Rose red
  "hsl(340, 70%, 75%)",   // Pink
  "hsl(45, 100%, 70%)",   // Gold
  "hsl(0, 0%, 100%)",     // White
  "hsl(320, 60%, 70%)",   // Magenta pink
];

export function useSparkles() {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const triggerSparkles = useCallback((event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const newSparkles: Sparkle[] = Array.from({ length: 8 }, (_, i) => ({
      id: Date.now() + i,
      x: x + (Math.random() - 0.5) * 40,
      y: y + (Math.random() - 0.5) * 40,
      size: 4 + Math.random() * 8,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      delay: Math.random() * 0.1,
    }));

    setSparkles(prev => [...prev, ...newSparkles]);

    // Clean up sparkles after animation
    setTimeout(() => {
      setSparkles(prev => prev.filter(s => !newSparkles.find(ns => ns.id === s.id)));
    }, 700);
  }, []);

  return { sparkles, triggerSparkles };
}

interface SparkleContainerProps {
  sparkles: Sparkle[];
}

export function SparkleContainer({ sparkles }: SparkleContainerProps) {
  if (sparkles.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-[100]" style={{ overflow: 'visible' }}>
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className="absolute animate-sparkle-burst"
          style={{
            left: sparkle.x,
            top: sparkle.y,
            animationDelay: `${sparkle.delay}s`,
          }}
        >
          <svg
            width={sparkle.size}
            height={sparkle.size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ filter: `drop-shadow(0 0 3px ${sparkle.color})` }}
          >
            <path
              d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"
              fill={sparkle.color}
            />
          </svg>
        </div>
      ))}
    </div>
  );
}

// Hook for hover sparkles - creates sparkles on mouse movement
export function useHoverSparkles() {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    // Only create sparkle 25% of the time to avoid too many
    if (Math.random() > 0.25) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const newSparkle: Sparkle = {
      id: Date.now() + Math.random(),
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 20,
      size: 3 + Math.random() * 5,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      delay: 0,
    };

    setSparkles(prev => [...prev, newSparkle]);

    // Clean up sparkle after animation
    setTimeout(() => {
      setSparkles(prev => prev.filter(s => s.id !== newSparkle.id));
    }, 600);
  }, []);

  return { sparkles, handleMouseMove };
}

// Combined hook for both click and hover sparkles
export function useClickAndHoverSparkles() {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const triggerSparkles = useCallback((event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const newSparkles: Sparkle[] = Array.from({ length: 8 }, (_, i) => ({
      id: Date.now() + i,
      x: x + (Math.random() - 0.5) * 40,
      y: y + (Math.random() - 0.5) * 40,
      size: 4 + Math.random() * 8,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      delay: Math.random() * 0.1,
    }));

    setSparkles(prev => [...prev, ...newSparkles]);

    setTimeout(() => {
      setSparkles(prev => prev.filter(s => !newSparkles.find(ns => ns.id === s.id)));
    }, 700);
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (Math.random() > 0.2) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const newSparkle: Sparkle = {
      id: Date.now() + Math.random(),
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 20,
      size: 3 + Math.random() * 5,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      delay: 0,
    };

    setSparkles(prev => [...prev, newSparkle]);

    setTimeout(() => {
      setSparkles(prev => prev.filter(s => s.id !== newSparkle.id));
    }, 600);
  }, []);

  return { sparkles, triggerSparkles, handleMouseMove };
}
