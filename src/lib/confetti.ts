import confetti from 'canvas-confetti';

/**
 * Detect mobile for performance optimization (reactive function)
 * Call at execution time to respect orientation changes and window resizing
 */
const checkIsMobile = (): boolean => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
    window.innerWidth < 768;
};

/**
 * Trigger a celebratory confetti animation for report completion
 * Creates multiple bursts from both sides of the screen over 3 seconds
 * Optimized for mobile: 50% fewer particles on mobile devices
 */
export const triggerCompletionConfetti = () => {
  const duration = 3000;
  const animationEnd = Date.now() + duration;
  const isMobile = checkIsMobile(); // Check at execution time
  const mobileMultiplier = isMobile ? 0.5 : 1; // 50% reduction on mobile
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

  const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      clearInterval(interval);
      return;
    }

    const particleCount = Math.floor(50 * (timeLeft / duration) * mobileMultiplier);
    
    // Burst from left side
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
    });
    
    // Burst from right side
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
    });
  }, 250);
};

/**
 * Trigger a simpler single-burst success confetti
 * Used for minor accomplishments
 * Optimized for mobile: 50% fewer particles on mobile devices
 */
export const triggerSuccessConfetti = () => {
  const isMobile = checkIsMobile(); // Check at execution time
  const mobileMultiplier = isMobile ? 0.5 : 1; // 50% reduction on mobile
  
  confetti({
    particleCount: Math.floor(100 * mobileMultiplier),
    spread: 70,
    origin: { y: 0.6 },
    zIndex: 9999
  });
};
