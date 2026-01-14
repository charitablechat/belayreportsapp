import { useEffect, useState } from "react";

type ChocolateType = "darkHeart" | "milkHeart" | "redFoilHeart" | "whiteHeart" | "squareSwirl" | "roundTruffle";

interface Chocolate {
  id: number;
  type: ChocolateType;
  left: number;
  top: number;
  size: number;
  rotation: number;
  delay: number;
}

export function ChocolateDecorations() {
  const [chocolates, setChocolates] = useState<Chocolate[]>([]);
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

    const types: ChocolateType[] = ["darkHeart", "milkHeart", "redFoilHeart", "whiteHeart", "squareSwirl", "roundTruffle"];
    const count = window.innerWidth < 768 ? 8 : 12;
    const items: Chocolate[] = [];

    for (let i = 0; i < count; i++) {
      items.push({
        id: i,
        type: types[Math.floor(Math.random() * types.length)],
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 24 + Math.random() * 16,
        rotation: Math.random() * 30 - 15,
        delay: Math.random() * 2,
      });
    }

    setChocolates(items);
  }, [prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  const renderChocolate = (type: ChocolateType) => {
    switch (type) {
      case "darkHeart": return <DarkChocolateHeart />;
      case "milkHeart": return <MilkChocolateHeart />;
      case "redFoilHeart": return <RedFoilHeart />;
      case "whiteHeart": return <WhiteChocolateHeart />;
      case "squareSwirl": return <SquareChocolate />;
      case "roundTruffle": return <RoundTruffle />;
    }
  };

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-[40]">
      {chocolates.map((choco) => (
        <div
          key={choco.id}
          className="absolute animate-float-gentle opacity-70 hover:opacity-90 transition-opacity"
          style={{
            left: `${choco.left}%`,
            top: `${choco.top}%`,
            width: `${choco.size}px`,
            height: `${choco.size}px`,
            transform: `rotate(${choco.rotation}deg)`,
            animationDelay: `${choco.delay}s`,
          }}
        >
          {renderChocolate(choco.type)}
        </div>
      ))}
    </div>
  );
}

function DarkChocolateHeart() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
      <defs>
        <linearGradient id="darkHeartGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4A2C2A" />
          <stop offset="40%" stopColor="#2D1810" />
          <stop offset="100%" stopColor="#1A0F0A" />
        </linearGradient>
        <radialGradient id="darkHeartShine" cx="30%" cy="30%" r="50%">
          <stop offset="0%" stopColor="#6B4540" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#2D1810" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M50 85 C20 55 5 35 5 22 C5 8 18 2 32 2 C44 2 50 12 50 12 C50 12 56 2 68 2 C82 2 95 8 95 22 C95 35 80 55 50 85Z"
        fill="url(#darkHeartGrad)"
      />
      <path
        d="M50 85 C20 55 5 35 5 22 C5 8 18 2 32 2 C44 2 50 12 50 12 C50 12 56 2 68 2 C82 2 95 8 95 22 C95 35 80 55 50 85Z"
        fill="url(#darkHeartShine)"
      />
      <path
        d="M35 25 Q45 20 50 28 Q55 20 65 25"
        stroke="#5C3D38"
        strokeWidth="2.5"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}

function MilkChocolateHeart() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
      <defs>
        <linearGradient id="milkHeartGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A0674B" />
          <stop offset="40%" stopColor="#7B4A35" />
          <stop offset="100%" stopColor="#5C3628" />
        </linearGradient>
        <radialGradient id="milkHeartShine" cx="25%" cy="25%" r="40%">
          <stop offset="0%" stopColor="#C4916E" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#7B4A35" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M50 85 C20 55 5 35 5 22 C5 8 18 2 32 2 C44 2 50 12 50 12 C50 12 56 2 68 2 C82 2 95 8 95 22 C95 35 80 55 50 85Z"
        fill="url(#milkHeartGrad)"
      />
      <path
        d="M50 85 C20 55 5 35 5 22 C5 8 18 2 32 2 C44 2 50 12 50 12 C50 12 56 2 68 2 C82 2 95 8 95 22 C95 35 80 55 50 85Z"
        fill="url(#milkHeartShine)"
      />
      <path
        d="M30 30 Q40 22 50 32 Q60 22 70 30"
        stroke="#C4916E"
        strokeWidth="2"
        fill="none"
        opacity="0.4"
      />
    </svg>
  );
}

function RedFoilHeart() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
      <defs>
        <linearGradient id="redFoilGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E53E3E" />
          <stop offset="30%" stopColor="#C53030" />
          <stop offset="60%" stopColor="#9B2C2C" />
          <stop offset="100%" stopColor="#742A2A" />
        </linearGradient>
        <linearGradient id="redFoilShine" x1="0%" y1="0%" x2="50%" y2="50%">
          <stop offset="0%" stopColor="#FC8181" stopOpacity="0.8" />
          <stop offset="50%" stopColor="#E53E3E" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#C53030" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M50 85 C20 55 5 35 5 22 C5 8 18 2 32 2 C44 2 50 12 50 12 C50 12 56 2 68 2 C82 2 95 8 95 22 C95 35 80 55 50 85Z"
        fill="url(#redFoilGrad)"
      />
      <path
        d="M50 85 C20 55 5 35 5 22 C5 8 18 2 32 2 C44 2 50 12 50 12 C50 12 56 2 68 2 C82 2 95 8 95 22 C95 35 80 55 50 85Z"
        fill="url(#redFoilShine)"
      />
      {/* Foil crinkle lines */}
      <path d="M25 20 L30 25 L25 30" stroke="#FC8181" strokeWidth="1" fill="none" opacity="0.4" />
      <path d="M70 18 L75 23 L72 28" stroke="#FC8181" strokeWidth="1" fill="none" opacity="0.4" />
      <path d="M45 40 L50 45 L48 50" stroke="#FC8181" strokeWidth="1" fill="none" opacity="0.3" />
    </svg>
  );
}

function WhiteChocolateHeart() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
      <defs>
        <linearGradient id="whiteHeartGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFF8E7" />
          <stop offset="40%" stopColor="#F5E6D3" />
          <stop offset="100%" stopColor="#E8D5C4" />
        </linearGradient>
        <radialGradient id="whiteHeartShine" cx="30%" cy="25%" r="35%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#F5E6D3" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M50 85 C20 55 5 35 5 22 C5 8 18 2 32 2 C44 2 50 12 50 12 C50 12 56 2 68 2 C82 2 95 8 95 22 C95 35 80 55 50 85Z"
        fill="url(#whiteHeartGrad)"
        stroke="#D4C4B0"
        strokeWidth="0.5"
      />
      <path
        d="M50 85 C20 55 5 35 5 22 C5 8 18 2 32 2 C44 2 50 12 50 12 C50 12 56 2 68 2 C82 2 95 8 95 22 C95 35 80 55 50 85Z"
        fill="url(#whiteHeartShine)"
      />
      <path
        d="M35 28 Q45 22 50 30 Q55 22 65 28"
        stroke="#C4A67D"
        strokeWidth="2"
        fill="none"
        opacity="0.3"
      />
    </svg>
  );
}

function SquareChocolate() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
      <defs>
        <linearGradient id="squareGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5D4037" />
          <stop offset="50%" stopColor="#3E2723" />
          <stop offset="100%" stopColor="#2A1B18" />
        </linearGradient>
        <radialGradient id="squareShine" cx="25%" cy="25%" r="50%">
          <stop offset="0%" stopColor="#8D6E63" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#3E2723" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="15" y="15" width="70" height="70" rx="8" fill="url(#squareGrad)" />
      <rect x="15" y="15" width="70" height="70" rx="8" fill="url(#squareShine)" />
      {/* Decorative swirl on top */}
      <path
        d="M35 50 Q50 30 65 50 Q50 45 50 55 Q50 45 35 50"
        stroke="#8D6E63"
        strokeWidth="3"
        fill="none"
        opacity="0.6"
      />
      <circle cx="50" cy="50" r="4" fill="#6D4C41" opacity="0.7" />
    </svg>
  );
}

function RoundTruffle() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
      <defs>
        <radialGradient id="truffleGrad" cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#6D4C41" />
          <stop offset="50%" stopColor="#4E342E" />
          <stop offset="100%" stopColor="#3E2723" />
        </radialGradient>
        <radialGradient id="truffleShine" cx="30%" cy="30%" r="30%">
          <stop offset="0%" stopColor="#A1887F" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#4E342E" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="38" fill="url(#truffleGrad)" />
      <circle cx="50" cy="50" r="38" fill="url(#truffleShine)" />
      {/* Decorative drizzle on top */}
      <path
        d="M32 45 Q40 40 50 45 Q60 40 68 45"
        stroke="#8D6E63"
        strokeWidth="2.5"
        fill="none"
        opacity="0.6"
      />
      <path
        d="M35 52 Q45 48 55 52 Q62 48 65 52"
        stroke="#A1887F"
        strokeWidth="2"
        fill="none"
        opacity="0.4"
      />
      {/* Cocoa dust specks */}
      <circle cx="40" cy="60" r="1.5" fill="#3E2723" opacity="0.4" />
      <circle cx="58" cy="58" r="1" fill="#3E2723" opacity="0.3" />
      <circle cx="52" cy="65" r="1.2" fill="#3E2723" opacity="0.35" />
    </svg>
  );
}
