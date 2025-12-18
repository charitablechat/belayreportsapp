interface IciclesProps {
  className?: string;
}

export function Icicles({ className = "" }: IciclesProps) {
  return (
    <div className={`absolute -bottom-3 left-0 right-0 pointer-events-none z-10 ${className}`}>
      <svg
        viewBox="0 0 200 20"
        preserveAspectRatio="none"
        className="w-full h-5"
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
          <radialGradient id="dropletGradient" cx="50%" cy="30%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#c0e0f0" stopOpacity="0.7" />
          </radialGradient>
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
        
        {/* Animated water droplets using native SVG animations */}
        <circle cx="128" cy="14" r="1" fill="url(#dropletGradient)">
          <animate attributeName="cy" values="14;20;14" dur="3s" repeatCount="indefinite" keyTimes="0;0.9;1" />
          <animate attributeName="opacity" values="0.8;1;0.6;0;0.8" dur="3s" repeatCount="indefinite" keyTimes="0;0.1;0.9;0.99;1" />
        </circle>
        <circle cx="48" cy="13" r="0.8" fill="url(#dropletGradient)">
          <animate attributeName="cy" values="13;19;13" dur="3.5s" repeatCount="indefinite" keyTimes="0;0.9;1" begin="1.2s" />
          <animate attributeName="opacity" values="0.8;1;0.6;0;0.8" dur="3.5s" repeatCount="indefinite" keyTimes="0;0.1;0.9;0.99;1" begin="1.2s" />
        </circle>
        <circle cx="168" cy="12" r="0.9" fill="url(#dropletGradient)">
          <animate attributeName="cy" values="12;18;12" dur="4s" repeatCount="indefinite" keyTimes="0;0.9;1" begin="2.4s" />
          <animate attributeName="opacity" values="0.8;1;0.6;0;0.8" dur="4s" repeatCount="indefinite" keyTimes="0;0.1;0.9;0.99;1" begin="2.4s" />
        </circle>
      </svg>
    </div>
  );
}
