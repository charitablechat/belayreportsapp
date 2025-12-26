export function Sparkles() {
  const colors = [
    "hsl(45, 100%, 50%)",   // Gold
    "hsl(39, 77%, 83%)",    // Champagne
    "hsl(0, 0%, 75%)",      // Silver
    "hsl(45, 100%, 60%)",   // Light Gold
    "hsl(270, 70%, 60%)",   // Purple
  ];

  const sparkleCount = 20;

  return (
    <div className="relative w-full overflow-hidden h-8">
      {/* Wire/string */}
      <div className="absolute top-3 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-700/40 to-transparent" />
      
      {/* Sparkles */}
      <div className="flex justify-between px-2">
        {Array.from({ length: sparkleCount }).map((_, i) => (
          <div
            key={i}
            className="relative animate-nye-sparkle"
            style={{
              animationDelay: `${(i % 5) * 0.15}s`,
            }}
          >
            {/* Wire connector */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-amber-700/40" />
            
            {/* Star sparkle */}
            <div
              className="w-3 h-3 mt-3 relative flex items-center justify-center"
              style={{
                color: colors[i % colors.length],
                textShadow: `0 0 8px ${colors[i % colors.length]}`,
              }}
            >
              <span className="text-xs">✦</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
