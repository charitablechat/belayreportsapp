import { useEffect, useState } from "react";

interface Chocolate {
  id: number;
  type: "heart" | "truffle" | "box";
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

    // Generate scattered chocolates
    const types: Array<"heart" | "truffle" | "box"> = ["heart", "truffle", "box"];
    const count = window.innerWidth < 768 ? 8 : 12;
    const items: Chocolate[] = [];

    for (let i = 0; i < count; i++) {
      items.push({
        id: i,
        type: types[Math.floor(Math.random() * types.length)],
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 20 + Math.random() * 16, // 20-36px
        rotation: Math.random() * 30 - 15, // -15 to 15 degrees
        delay: Math.random() * 2,
      });
    }

    setChocolates(items);
  }, [prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-[40]">
      {chocolates.map((choco) => (
        <div
          key={choco.id}
          className="absolute animate-float-gentle opacity-60 hover:opacity-90 transition-opacity"
          style={{
            left: `${choco.left}%`,
            top: `${choco.top}%`,
            width: `${choco.size}px`,
            height: `${choco.size}px`,
            transform: `rotate(${choco.rotation}deg)`,
            animationDelay: `${choco.delay}s`,
          }}
        >
          {choco.type === "heart" && <ChocolateHeart />}
          {choco.type === "truffle" && <ChocolateTruffle />}
          {choco.type === "box" && <ChocolateBox />}
        </div>
      ))}
    </div>
  );
}

function ChocolateHeart() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
      <defs>
        <linearGradient id="chocolateHeartGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B4513" />
          <stop offset="30%" stopColor="#6B3510" />
          <stop offset="70%" stopColor="#5C2D0E" />
          <stop offset="100%" stopColor="#4A2409" />
        </linearGradient>
        <linearGradient id="chocolateShine" x1="0%" y1="0%" x2="50%" y2="50%">
          <stop offset="0%" stopColor="#D4A574" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#8B4513" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M50 88 C20 60 5 40 5 25 C5 10 20 5 35 5 C45 5 50 15 50 15 C50 15 55 5 65 5 C80 5 95 10 95 25 C95 40 80 60 50 88Z"
        fill="url(#chocolateHeartGradient)"
      />
      <path
        d="M50 88 C20 60 5 40 5 25 C5 10 20 5 35 5 C45 5 50 15 50 15 C50 15 55 5 65 5 C80 5 95 10 95 25 C95 40 80 60 50 88Z"
        fill="url(#chocolateShine)"
      />
      {/* Decorative swirl */}
      <path
        d="M35 30 Q45 25 50 35 Q55 25 65 30"
        stroke="#D4A574"
        strokeWidth="2"
        fill="none"
        opacity="0.4"
      />
    </svg>
  );
}

function ChocolateTruffle() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
      <defs>
        <radialGradient id="truffleGradient" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#8B4513" />
          <stop offset="50%" stopColor="#5C2D0E" />
          <stop offset="100%" stopColor="#3D1F0A" />
        </radialGradient>
        <radialGradient id="truffleShine" cx="25%" cy="25%" r="30%">
          <stop offset="0%" stopColor="#D4A574" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#8B4513" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="url(#truffleGradient)" />
      <circle cx="50" cy="50" r="40" fill="url(#truffleShine)" />
      {/* Cocoa powder texture */}
      <circle cx="35" cy="35" r="3" fill="#4A2409" opacity="0.3" />
      <circle cx="60" cy="40" r="2" fill="#4A2409" opacity="0.3" />
      <circle cx="45" cy="55" r="2.5" fill="#4A2409" opacity="0.3" />
    </svg>
  );
}

function ChocolateBox() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-full drop-shadow-lg">
      <defs>
        <linearGradient id="boxGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#C41E3A" />
          <stop offset="50%" stopColor="#8B0000" />
          <stop offset="100%" stopColor="#5C0000" />
        </linearGradient>
        <linearGradient id="ribbonGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFD700" />
          <stop offset="50%" stopColor="#FFA500" />
          <stop offset="100%" stopColor="#FFD700" />
        </linearGradient>
      </defs>
      {/* Box */}
      <rect x="10" y="20" width="80" height="50" rx="3" fill="url(#boxGradient)" />
      {/* Lid */}
      <rect x="5" y="15" width="90" height="12" rx="2" fill="url(#boxGradient)" />
      {/* Ribbon horizontal */}
      <rect x="5" y="35" width="90" height="8" fill="url(#ribbonGradient)" opacity="0.9" />
      {/* Ribbon vertical */}
      <rect x="45" y="15" width="10" height="55" fill="url(#ribbonGradient)" opacity="0.9" />
      {/* Bow */}
      <ellipse cx="50" cy="18" rx="15" ry="8" fill="url(#ribbonGradient)" />
      <circle cx="50" cy="18" r="5" fill="#FFD700" />
    </svg>
  );
}
