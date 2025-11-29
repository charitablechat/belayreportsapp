import confetti from 'canvas-confetti';

/**
 * Trigger a celebratory confetti animation for report completion
 * Creates multiple bursts from both sides of the screen over 3 seconds
 */
export const triggerCompletionConfetti = () => {
  const duration = 3000;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

  const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      clearInterval(interval);
      return;
    }

    const particleCount = 50 * (timeLeft / duration);
    
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
 */
export const triggerSuccessConfetti = () => {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    zIndex: 9999
  });
};
