interface IciclesProps {
  className?: string;
}

export function Icicles({ className = "" }: IciclesProps) {
  return (
    <div className={`absolute -bottom-3 left-0 right-0 pointer-events-none z-10 ${className}`}>
      <svg
        viewBox="0 0 200 16"
        preserveAspectRatio="none"
        className="w-full h-4"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="icicleGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e8f4fc" />
            <stop offset="50%" stopColor="#d4ebf7" />
            <stop offset="100%" stopColor="#c0e0f0" />
          </linearGradient>
          <filter id="icicleShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="0.5" floodOpacity="0.2" />
          </filter>
        </defs>
        {/* Icicle shapes hanging down */}
        <path
          d="M0,0 L200,0 L200,2 
             L190,2 L188,8 L186,2 
             L170,2 L168,12 L166,2 
             L150,2 L148,6 L146,2 
             L130,2 L128,14 L126,2 
             L110,2 L108,7 L106,2 
             L90,2 L88,10 L86,2 
             L70,2 L68,5 L66,2 
             L50,2 L48,13 L46,2 
             L30,2 L28,8 L26,2 
             L15,2 L13,11 L11,2 
             L0,2 Z"
          fill="url(#icicleGradient)"
          filter="url(#icicleShadow)"
        />
        {/* Highlight reflections on icicles */}
        <line x1="168" y1="3" x2="168" y2="10" stroke="#ffffff" strokeWidth="0.5" opacity="0.6" />
        <line x1="128" y1="3" x2="128" y2="12" stroke="#ffffff" strokeWidth="0.5" opacity="0.6" />
        <line x1="88" y1="3" x2="88" y2="8" stroke="#ffffff" strokeWidth="0.5" opacity="0.6" />
        <line x1="48" y1="3" x2="48" y2="11" stroke="#ffffff" strokeWidth="0.5" opacity="0.6" />
        <line x1="13" y1="3" x2="13" y2="9" stroke="#ffffff" strokeWidth="0.5" opacity="0.6" />
      </svg>
    </div>
  );
}
