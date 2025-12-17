export function ChristmasLights() {
  const colors = [
    "hsl(0, 100%, 50%)",    // Red
    "hsl(120, 100%, 40%)",  // Green
    "hsl(45, 100%, 50%)",   // Gold
    "hsl(210, 100%, 50%)",  // Blue
    "hsl(300, 100%, 50%)",  // Purple
  ];

  const bulbCount = 20;

  return (
    <div className="relative w-full overflow-hidden h-8">
      {/* Wire */}
      <div className="absolute top-3 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-green-900/60 to-transparent" />
      
      {/* Light bulbs */}
      <div className="flex justify-between px-2">
        {Array.from({ length: bulbCount }).map((_, i) => (
          <div
            key={i}
            className="relative animate-christmas-glow"
            style={{
              animationDelay: `${(i % 5) * 0.2}s`,
            }}
          >
            {/* Wire connector */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-green-900/60" />
            
            {/* Bulb */}
            <div
              className="w-3 h-4 rounded-full mt-3 relative"
              style={{
                backgroundColor: colors[i % colors.length],
                boxShadow: `0 0 8px 2px ${colors[i % colors.length]}`,
              }}
            >
              {/* Highlight */}
              <div className="absolute top-0.5 left-0.5 w-1 h-1.5 rounded-full bg-white/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
