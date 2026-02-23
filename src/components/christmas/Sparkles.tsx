import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
}

const SPARKLE_COLORS = [
  "hsl(145, 70%, 40%)",   // Emerald green
  "hsl(120, 60%, 55%)",   // Lime green
  "hsl(45, 100%, 55%)",   // Gold
  "hsl(0, 0%, 100%)",     // White
  "hsl(150, 80%, 25%)",   // Dark green
];

export function useSparkles() {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const triggerSparkles = useCallback((event: React.MouseEvent) => {
    // Use viewport coordinates for portal rendering
    const x = event.clientX;
    const y = event.clientY;

    const newSparkles: Sparkle[] = Array.from({ length: 10 }, (_, i) => ({
      id: Date.now() + i,
      x: x + (Math.random() - 0.5) * 60,
      y: y + (Math.random() - 0.5) * 60,
      size: 8 + Math.random() * 12,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      delay: Math.random() * 0.15,
    }));

    setSparkles(prev => [...prev, ...newSparkles]);

    setTimeout(() => {
      setSparkles(prev => prev.filter(s => !newSparkles.find(ns => ns.id === s.id)));
    }, 800);
  }, []);

  return { sparkles, triggerSparkles };
}

interface SparkleContainerProps {
  sparkles: Sparkle[];
}

export function SparkleContainer({ sparkles }: SparkleContainerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || sparkles.length === 0) return null;

  // Render sparkles in a portal at the document body level
  return createPortal(
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 9999 }}>
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className="absolute animate-sparkle-burst"
          style={{
            left: sparkle.x,
            top: sparkle.y,
            transform: 'translate(-50%, -50%)',
            animationDelay: `${sparkle.delay}s`,
          }}
        >
          <svg
            width={sparkle.size}
            height={sparkle.size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ 
              filter: `drop-shadow(0 0 4px ${sparkle.color}) drop-shadow(0 0 8px ${sparkle.color})` 
            }}
          >
            <g fill={sparkle.color}>
              <ellipse cx="12" cy="7" rx="3" ry="5" />
              <ellipse cx="12" cy="17" rx="3" ry="5" />
              <ellipse cx="7" cy="12" rx="5" ry="3" />
              <ellipse cx="17" cy="12" rx="5" ry="3" />
              <line x1="12" y1="17" x2="12" y2="23" stroke={sparkle.color} strokeWidth="1.5" />
            </g>
          </svg>
        </div>
      ))}
    </div>,
    document.body
  );
}

// Hook for hover sparkles - creates sparkles on mouse movement
export function useHoverSparkles() {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    // Only create sparkle 30% of the time
    if (Math.random() > 0.3) return;

    const x = event.clientX;
    const y = event.clientY;

    const newSparkle: Sparkle = {
      id: Date.now() + Math.random(),
      x: x + (Math.random() - 0.5) * 30,
      y: y + (Math.random() - 0.5) * 30,
      size: 6 + Math.random() * 8,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      delay: 0,
    };

    setSparkles(prev => [...prev, newSparkle]);

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
    const x = event.clientX;
    const y = event.clientY;

    const newSparkles: Sparkle[] = Array.from({ length: 10 }, (_, i) => ({
      id: Date.now() + i,
      x: x + (Math.random() - 0.5) * 60,
      y: y + (Math.random() - 0.5) * 60,
      size: 8 + Math.random() * 12,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
      delay: Math.random() * 0.15,
    }));

    setSparkles(prev => [...prev, ...newSparkles]);

    setTimeout(() => {
      setSparkles(prev => prev.filter(s => !newSparkles.find(ns => ns.id === s.id)));
    }, 800);
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (Math.random() > 0.25) return;

    const x = event.clientX;
    const y = event.clientY;

    const newSparkle: Sparkle = {
      id: Date.now() + Math.random(),
      x: x + (Math.random() - 0.5) * 30,
      y: y + (Math.random() - 0.5) * 30,
      size: 6 + Math.random() * 8,
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