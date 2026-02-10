interface OlympicRingsProps {
  className?: string;
}

export function OlympicRings({ className = "" }: OlympicRingsProps) {
  const colors = ["#0081C8", "#FCB131", "#000000", "#00A651", "#EE334E"];
  return (
    <div className={`absolute -top-1 left-0 right-0 pointer-events-none z-10 flex justify-center ${className}`}>
      <svg viewBox="0 0 120 30" className="w-24 h-6 opacity-60">
        {colors.map((color, i) => (
          <circle
            key={i}
            cx={18 + i * 22}
            cy={i % 2 === 0 ? 12 : 18}
            r={9}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
        ))}
      </svg>
    </div>
  );
}
