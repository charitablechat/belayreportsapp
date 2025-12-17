interface SnowPileProps {
  className?: string;
}

export function SnowPile({ className = "" }: SnowPileProps) {
  return (
    <div className={`absolute -top-1 left-0 right-0 pointer-events-none z-10 ${className}`}>
      <svg
        viewBox="0 0 200 12"
        preserveAspectRatio="none"
        className="w-full h-3"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="snowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e8f4fc" />
          </linearGradient>
          <filter id="snowShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="0.5" floodOpacity="0.15" />
          </filter>
        </defs>
        <path
          d="M0,12 
             L0,6 
             Q10,4 20,5 
             Q30,3 40,4 
             Q50,2 60,3 
             Q70,1 80,2 
             Q90,0 100,1 
             Q110,0 120,2 
             Q130,1 140,3 
             Q150,2 160,4 
             Q170,3 180,5 
             Q190,4 200,6 
             L200,12 
             Z"
          fill="url(#snowGradient)"
          filter="url(#snowShadow)"
        />
        {/* Small snow bumps for organic look */}
        <circle cx="25" cy="5" r="1.5" fill="#ffffff" opacity="0.8" />
        <circle cx="75" cy="3" r="2" fill="#ffffff" opacity="0.9" />
        <circle cx="125" cy="3" r="1.8" fill="#ffffff" opacity="0.85" />
        <circle cx="175" cy="5" r="1.5" fill="#ffffff" opacity="0.8" />
      </svg>
    </div>
  );
}
