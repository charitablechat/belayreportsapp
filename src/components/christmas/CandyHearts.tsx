interface CandyHeart {
  color: string;
  message: string;
}

const CANDY_HEARTS: CandyHeart[] = [
  { color: "hsl(340, 60%, 85%)", message: "BE MINE" },
  { color: "hsl(280, 40%, 85%)", message: "XOXO" },
  { color: "hsl(50, 70%, 88%)", message: "SWEET" },
  { color: "hsl(160, 40%, 82%)", message: "LOVE" },
  { color: "hsl(0, 0%, 95%)", message: "CUTIE" },
  { color: "hsl(340, 50%, 80%)", message: "HUG ME" },
  { color: "hsl(280, 35%, 88%)", message: "TRUE" },
  { color: "hsl(50, 60%, 85%)", message: "KISS" },
  { color: "hsl(160, 35%, 85%)", message: "ANGEL" },
  { color: "hsl(340, 55%, 82%)", message: "DEAR" },
  { color: "hsl(0, 0%, 92%)", message: "YOURS" },
  { color: "hsl(280, 45%, 83%)", message: "CALL ME" },
  { color: "hsl(50, 65%, 86%)", message: "DREAM" },
  { color: "hsl(160, 38%, 80%)", message: "SMILE" },
  { color: "hsl(340, 65%, 78%)", message: "♥" },
];

export function CandyHearts() {
  return (
    <div className="relative w-full overflow-hidden h-8">
      {/* Decorative ribbon */}
      <div className="absolute top-3 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-pink-300/40 to-transparent rounded-full" />
      
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
              className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-3 rounded-full"
              style={{ backgroundColor: "hsl(340, 50%, 75%, 0.5)" }}
            />
            
            {/* Candy heart shape */}
            <div
              className="mt-3 px-1 py-0.5 rounded-sm animate-candy-wiggle flex items-center justify-center"
              style={{
                backgroundColor: heart.color,
                animationDelay: `${i * 0.15}s`,
                minWidth: "18px",
                boxShadow: `
                  inset 0 1px 2px rgba(255,255,255,0.6),
                  inset 0 -1px 2px rgba(0,0,0,0.1),
                  0 1px 2px rgba(0,0,0,0.15)
                `,
              }}
              aria-label={heart.message}
            >
              {/* Tiny text - only visible on larger screens */}
              <span 
                className="hidden sm:block text-[5px] font-bold leading-none select-none"
                style={{ color: "hsl(340, 50%, 35%)" }}
              >
                {heart.message.length <= 4 ? heart.message : "♥"}
              </span>
              {/* Heart icon on mobile */}
              <span 
                className="sm:hidden text-[6px] leading-none select-none"
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
