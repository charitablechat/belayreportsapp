interface HeartsBorderProps {
  className?: string;
}

export function HeartsBorder({ className = "" }: HeartsBorderProps) {
  return (
    <div className={`absolute -top-1 left-0 right-0 pointer-events-none z-10 ${className}`}>
      <svg
        viewBox="0 0 200 12"
        preserveAspectRatio="none"
        className="w-full h-3"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="heartsGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(340, 70%, 75%)" />
            <stop offset="100%" stopColor="hsl(350, 80%, 65%)" />
          </linearGradient>
          <filter id="heartShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="0.5" floodColor="hsl(350, 80%, 50%)" floodOpacity="0.2" />
          </filter>
        </defs>
        
        {/* Decorative wave with hearts */}
        <path
          d="M0,12 
             L0,8 
             Q10,6 20,7 
             Q30,5 40,6 
             Q50,4 60,5 
             Q70,3 80,4 
             Q90,2 100,3 
             Q110,2 120,4 
             Q130,3 140,5 
             Q150,4 160,6 
             Q170,5 180,7 
             Q190,6 200,8 
             L200,12 
             Z"
          fill="url(#heartsGradient)"
          filter="url(#heartShadow)"
          opacity="0.85"
        />
        
        {/* Small heart decorations */}
        <g fill="hsl(350, 80%, 60%)" opacity="0.9">
          {/* Heart at 20% */}
          <path transform="translate(38, 4) scale(0.25)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          
          {/* Heart at 50% */}
          <path transform="translate(97, 2) scale(0.3)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          
          {/* Heart at 80% */}
          <path transform="translate(158, 4) scale(0.25)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </g>
        
        {/* Highlight hearts in lighter pink */}
        <g fill="hsl(340, 80%, 80%)" opacity="0.7">
          <path transform="translate(18, 5) scale(0.2)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          
          <path transform="translate(68, 3) scale(0.22)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          
          <path transform="translate(128, 3) scale(0.22)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          
          <path transform="translate(178, 5) scale(0.2)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </g>
      </svg>
    </div>
  );
}
