interface OlympicRingsProps {
  className?: string;
}

export function OlympicRings({ className = "" }: OlympicRingsProps) {
  // Official Olympic ring colors
  const blue = "#0081C8";
  const yellow = "#FCB131";
  const black = "#000000";
  const green = "#00A651";
  const red = "#EE334E";

  // Geometry: viewBox 0 0 504 228
  // Ring radius: 72, stroke: 10
  // Top row centers (y=82): Blue(82,82), Black(168+84=252,82)... 
  // Centers: Blue(82,82), Yellow(168,146), Black(252,82), Green(336,146), Red(420,82)
  const r = 72;
  const sw = 10;

  return (
    <div className={`absolute -top-1 left-0 right-0 pointer-events-none z-10 flex justify-center ${className}`}>
      <svg viewBox="0 0 504 228" className="w-24 h-6 opacity-60">
        {/* Layer 1: Draw all 5 rings as full circles (back layer) */}
        <circle cx={82} cy={82} r={r} fill="none" stroke={blue} strokeWidth={sw} />
        <circle cx={168} cy={146} r={r} fill="none" stroke={yellow} strokeWidth={sw} />
        <circle cx={252} cy={82} r={r} fill="none" stroke={black} strokeWidth={sw} />
        <circle cx={336} cy={146} r={r} fill="none" stroke={green} strokeWidth={sw} />
        <circle cx={420} cy={82} r={r} fill="none" stroke={red} strokeWidth={sw} />

        {/* Layer 2: Interlocking overlaps - redraw arc segments on top */}
        
        {/* Yellow ring passes OVER blue's right side */}
        {/* Draw the portion of yellow that crosses over blue (bottom-left arc of yellow) */}
        <path
          d="M 110.5,119 A 72,72 0 0,0 96,146"
          fill="none"
          stroke={yellow}
          strokeWidth={sw}
        />

        {/* Black ring passes OVER yellow's right side */}
        {/* Draw the portion of black that crosses over yellow (bottom-left arc of black) */}
        <path
          d="M 196,119 A 72,72 0 0,0 180,146"
          fill="none"
          stroke={black}
          strokeWidth={sw}
          strokeLinecap="butt"
        />

        {/* Green ring passes OVER black's right side */}
        {/* Draw the portion of green that crosses over black (bottom-left arc of green) */}
        <path
          d="M 280,119 A 72,72 0 0,0 264,146"
          fill="none"
          stroke={green}
          strokeWidth={sw}
        />

        {/* Red ring passes OVER green's right side */}
        {/* Draw the portion of red that crosses over green (bottom-left arc of red) */}
        <path
          d="M 364,119 A 72,72 0 0,0 348,146"
          fill="none"
          stroke={red}
          strokeWidth={sw}
          strokeLinecap="butt"
        />

        {/* Now handle the other crossing points where bottom rings go UNDER top rings */}
        {/* Yellow goes UNDER black - redraw black's bottom-right over yellow's top-right */}
        <path
          d="M 224,119 A 72,72 0 0,1 240,146"
          fill="none"
          stroke={black}
          strokeWidth={sw}
        />

        {/* Green goes UNDER red - redraw red's bottom-left over green's top-right */}
        <path
          d="M 392,119 A 72,72 0 0,1 408,146"
          fill="none"
          stroke={red}
          strokeWidth={sw}
        />
      </svg>
    </div>
  );
}
