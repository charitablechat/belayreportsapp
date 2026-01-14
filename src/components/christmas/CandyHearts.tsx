interface CandyHeart {
  color: string;
  gradientEnd: string;
  message: string;
}

const CANDY_HEARTS: CandyHeart[] = [
  { color: "hsl(340, 60%, 85%)", gradientEnd: "hsl(340, 50%, 78%)", message: "BE MINE" },
  { color: "hsl(280, 40%, 85%)", gradientEnd: "hsl(280, 35%, 78%)", message: "XOXO" },
  { color: "hsl(50, 70%, 88%)", gradientEnd: "hsl(50, 60%, 80%)", message: "SWEET" },
  { color: "hsl(160, 40%, 82%)", gradientEnd: "hsl(160, 35%, 75%)", message: "LOVE" },
  { color: "hsl(0, 0%, 95%)", gradientEnd: "hsl(0, 0%, 88%)", message: "CUTIE" },
  { color: "hsl(340, 50%, 80%)", gradientEnd: "hsl(340, 45%, 73%)", message: "HUG ME" },
  { color: "hsl(280, 35%, 88%)", gradientEnd: "hsl(280, 30%, 80%)", message: "TRUE" },
  { color: "hsl(50, 60%, 85%)", gradientEnd: "hsl(50, 55%, 78%)", message: "KISS" },
  { color: "hsl(160, 35%, 85%)", gradientEnd: "hsl(160, 30%, 78%)", message: "ANGEL" },
  { color: "hsl(340, 55%, 82%)", gradientEnd: "hsl(340, 50%, 75%)", message: "DEAR" },
  { color: "hsl(0, 0%, 92%)", gradientEnd: "hsl(0, 0%, 85%)", message: "YOURS" },
  { color: "hsl(280, 45%, 83%)", gradientEnd: "hsl(280, 40%, 76%)", message: "CALL ME" },
  { color: "hsl(50, 65%, 86%)", gradientEnd: "hsl(50, 60%, 79%)", message: "DREAM" },
  { color: "hsl(160, 38%, 80%)", gradientEnd: "hsl(160, 33%, 73%)", message: "SMILE" },
  { color: "hsl(340, 65%, 78%)", gradientEnd: "hsl(340, 60%, 71%)", message: "♥" },
];

export function CandyHearts() {
  return (
    <div className="relative w-full overflow-hidden h-10">
      {/* Decorative ribbon */}
      <div className="absolute top-4 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-pink-300/40 to-transparent rounded-full" />
      
      {/* Candy hearts */}
      <div className="flex justify-between px-1">
        {CANDY_HEARTS.map((heart, i) => (
          <div
            key={i}
            className="relative animate-candy-shimmer"
            style={{
              animationDelay: `${(i % 5) * 0.2}s`,
            }}
          >
            {/* Ribbon connector */}
            <div 
              className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-4 rounded-full"
              style={{ backgroundColor: "hsl(340, 50%, 75%, 0.5)" }}
            />
            
            {/* Heart-shaped candy */}
            <div className="mt-4 relative animate-candy-wiggle" style={{ animationDelay: `${i * 0.15}s` }}>
              <svg 
                width="22" 
                height="20" 
                viewBox="0 0 50 45" 
                className="drop-shadow-sm"
              >
                <defs>
                  <linearGradient id={`candyTop${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={heart.color} />
                    <stop offset="100%" stopColor={heart.gradientEnd} />
                  </linearGradient>
                </defs>
                <path 
                  d="M25 42 C25 42 5 28 5 15 C5 8 10 3 17 3 C21 3 24 5 25 8 C26 5 29 3 33 3 C40 3 45 8 45 15 C45 28 25 42 25 42Z" 
                  fill={`url(#candyTop${i})`}
                  stroke={heart.gradientEnd}
                  strokeWidth="0.5"
                />
              </svg>
              {/* Heart icon on all screens */}
              <span 
                className="absolute inset-0 flex items-center justify-center text-[5px] leading-none select-none pt-0.5"
                style={{ color: "hsl(340, 50%, 45%)" }}
              >
                ♥
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}