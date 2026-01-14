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

/**
 * Trigger Valentine's themed confetti with hearts
 * Creates bursts of pink and red heart-shaped confetti
 */
export const triggerValentineConfetti = () => {
  const isMobile = checkIsMobile();
  const mobileMultiplier = isMobile ? 0.5 : 1;
  const duration = 3000;
  const animationEnd = Date.now() + duration;
  
  // Valentine's colors
  const colors = ['#FF1493', '#FF69B4', '#DC143C', '#FF6B6B', '#E91E63', '#F48FB1'];
  
  const heart = confetti.shapeFromPath({
    path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    matrix: [0.05, 0, 0, 0.05, -0.6, -0.5]
  });
  
  const defaults = {
    spread: 360,
    ticks: 100,
    gravity: 0.8,
    decay: 0.94,
    startVelocity: 30,
    shapes: [heart],
    colors: colors,
    scalar: 2,
    zIndex: 9999
  };

  const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      clearInterval(interval);
      return;
    }

    const particleCount = Math.floor(8 * (timeLeft / duration) * mobileMultiplier);
    
    // Burst from left
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: randomInRange(0.2, 0.4) }
    });
    
    // Burst from right
    confetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.7, 0.9), y: randomInRange(0.2, 0.4) }
    });
  }, 200);
};

/**
 * Trigger a quick Valentine's burst (for smaller achievements)
 */
export const triggerValentineBurst = () => {
  const isMobile = checkIsMobile();
  const mobileMultiplier = isMobile ? 0.5 : 1;
  
  const colors = ['#FF1493', '#FF69B4', '#DC143C', '#FF6B6B', '#E91E63'];
  
  const heart = confetti.shapeFromPath({
    path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    matrix: [0.05, 0, 0, 0.05, -0.6, -0.5]
  });
  
  confetti({
    particleCount: Math.floor(30 * mobileMultiplier),
    spread: 100,
    origin: { y: 0.6 },
    shapes: [heart],
    colors: colors,
    scalar: 2,
    zIndex: 9999
  });
};
