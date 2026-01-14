import React, { useEffect, useState } from 'react';

const ChocolateBoxDecoration: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg 
      viewBox="0 0 200 180" 
      className={className}
      style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))' }}
    >
      {/* Heart-shaped box base */}
      <defs>
        <linearGradient id="boxGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#C41E3A" />
          <stop offset="50%" stopColor="#8B0000" />
          <stop offset="100%" stopColor="#5C0000" />
        </linearGradient>
        <linearGradient id="goldTrim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#D4AF37" />
          <stop offset="50%" stopColor="#FFD700" />
          <stop offset="100%" stopColor="#D4AF37" />
        </linearGradient>
        <linearGradient id="darkChoc" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#4A3728" />
          <stop offset="100%" stopColor="#2D1810" />
        </linearGradient>
        <linearGradient id="milkChoc" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#8B6914" />
          <stop offset="100%" stopColor="#6B4423" />
        </linearGradient>
        <linearGradient id="whiteChoc" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFEF0" />
          <stop offset="100%" stopColor="#F5DEB3" />
        </linearGradient>
        <radialGradient id="paperCup" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8B6914" />
          <stop offset="100%" stopColor="#654321" />
        </radialGradient>
      </defs>

      {/* Box base - heart shape */}
      <path
        d="M100 170 C20 120 0 70 0 50 C0 20 25 0 55 0 C75 0 90 15 100 35 C110 15 125 0 145 0 C175 0 200 20 200 50 C200 70 180 120 100 170Z"
        fill="url(#boxGradient)"
        stroke="url(#goldTrim)"
        strokeWidth="3"
      />

      {/* Inner box shadow */}
      <path
        d="M100 160 C30 115 15 70 15 55 C15 30 35 15 60 15 C77 15 90 27 100 45 C110 27 123 15 140 15 C165 15 185 30 185 55 C185 70 170 115 100 160Z"
        fill="#1a0a05"
        opacity="0.3"
      />

      {/* Paper cup dividers - subtle grid inside */}
      <ellipse cx="55" cy="55" rx="18" ry="16" fill="url(#paperCup)" opacity="0.4" />
      <ellipse cx="100" cy="50" rx="18" ry="16" fill="url(#paperCup)" opacity="0.4" />
      <ellipse cx="145" cy="55" rx="18" ry="16" fill="url(#paperCup)" opacity="0.4" />
      <ellipse cx="70" cy="90" rx="18" ry="16" fill="url(#paperCup)" opacity="0.4" />
      <ellipse cx="130" cy="90" rx="18" ry="16" fill="url(#paperCup)" opacity="0.4" />
      <ellipse cx="100" cy="85" rx="18" ry="16" fill="url(#paperCup)" opacity="0.4" />
      <ellipse cx="100" cy="125" rx="18" ry="16" fill="url(#paperCup)" opacity="0.4" />

      {/* Dark truffle with swirl - top left */}
      <circle cx="55" cy="52" r="14" fill="url(#darkChoc)" />
      <ellipse cx="55" cy="48" rx="10" ry="5" fill="#5C4033" opacity="0.5" />
      <path d="M48 50 Q55 45 62 50 Q55 55 48 50" fill="#8B7355" opacity="0.6" />
      <circle cx="50" cy="47" r="2" fill="#FFF" opacity="0.3" />

      {/* Milk chocolate dome - top center */}
      <ellipse cx="100" cy="48" rx="14" ry="12" fill="url(#milkChoc)" />
      <ellipse cx="100" cy="44" rx="8" ry="4" fill="#A0825C" opacity="0.6" />
      <path d="M93 46 L100 42 L107 46" stroke="#F5DEB3" strokeWidth="2" fill="none" opacity="0.7" />
      <circle cx="94" cy="43" r="2" fill="#FFF" opacity="0.3" />

      {/* White chocolate truffle - top right */}
      <circle cx="145" cy="52" r="14" fill="url(#whiteChoc)" />
      <path d="M138 50 Q145 45 152 50" stroke="#D4AF37" strokeWidth="1.5" fill="none" opacity="0.5" />
      <circle cx="140" cy="47" r="2" fill="#FFF" opacity="0.5" />

      {/* Square dark chocolate - middle left */}
      <rect x="55" y="78" width="26" height="22" rx="3" fill="url(#darkChoc)" />
      <path d="M58 84 Q68 79 78 84 Q68 89 58 84" fill="#6B4423" opacity="0.5" />
      <path d="M58 90 Q68 85 78 90" stroke="#8B7355" strokeWidth="1" fill="none" opacity="0.4" />
      <rect x="57" y="79" width="4" height="3" rx="1" fill="#FFF" opacity="0.2" />

      {/* Round truffle with nuts - middle center */}
      <circle cx="100" cy="85" r="13" fill="url(#darkChoc)" />
      <circle cx="95" cy="82" r="2" fill="#C4916E" />
      <circle cx="102" cy="80" r="1.5" fill="#DEB887" />
      <circle cx="106" cy="83" r="2" fill="#C4916E" />
      <circle cx="98" cy="79" r="1" fill="#F5DEB3" />
      <circle cx="94" cy="80" r="1.5" fill="#FFF" opacity="0.3" />

      {/* Milk chocolate square - middle right */}
      <rect x="117" y="78" width="26" height="22" rx="3" fill="url(#milkChoc)" />
      <line x1="120" y1="82" x2="140" y2="82" stroke="#F5DEB3" strokeWidth="1.5" opacity="0.6" />
      <line x1="120" y1="87" x2="140" y2="87" stroke="#F5DEB3" strokeWidth="1.5" opacity="0.6" />
      <line x1="120" y1="92" x2="140" y2="92" stroke="#F5DEB3" strokeWidth="1.5" opacity="0.6" />
      <rect x="119" y="79" width="4" height="3" rx="1" fill="#FFF" opacity="0.2" />

      {/* Dark dome with caramel drizzle - bottom center */}
      <ellipse cx="100" cy="122" rx="15" ry="13" fill="url(#darkChoc)" />
      <path d="M88 120 Q94 115 100 120 Q106 115 112 120" stroke="#C4916E" strokeWidth="2" fill="none" opacity="0.8" />
      <circle cx="93" cy="116" r="2" fill="#FFF" opacity="0.3" />
    </svg>
  );
};

export function ChocolateDecorations() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);
    
    const handleChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (reducedMotion) return null;

  const animationStyle = {
    animation: 'float-gentle 6s ease-in-out infinite',
  };

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-[45]">
      <style>{`
        @keyframes float-gentle {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>

      {/* Bottom left chocolate box */}
      <div 
        className="absolute bottom-4 left-4 md:bottom-8 md:left-8"
        style={animationStyle}
      >
        <ChocolateBoxDecoration 
          className={`${isMobile ? 'w-28 h-28' : 'w-40 h-40'} opacity-70`}
        />
      </div>

      {/* Bottom right chocolate box - desktop only */}
      {!isMobile && (
        <div 
          className="absolute bottom-8 right-8"
          style={{
            ...animationStyle,
            animationDelay: '-3s',
          }}
        >
          <ChocolateBoxDecoration 
            className="w-36 h-36 opacity-60 scale-x-[-1]"
          />
        </div>
      )}
    </div>
  );
}

export default ChocolateDecorations;
