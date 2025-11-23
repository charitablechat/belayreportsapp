/**
 * Haptic feedback utilities for mobile devices
 */

export type HapticFeedbackType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/**
 * Trigger haptic feedback on supported devices
 * @param type - The type of haptic feedback (light, medium, heavy, success, warning, error)
 */
export const triggerHaptic = (type: HapticFeedbackType = 'light') => {
  // Check if vibration API is supported
  if (!('vibrate' in navigator)) {
    return;
  }

  // Different vibration patterns for different feedback types
  const patterns: Record<HapticFeedbackType, number | number[]> = {
    light: 10,
    medium: 50,
    heavy: 100,
    success: [10, 50, 10], // Short-long-short pattern
    warning: [50, 100], // Two pulses
    error: [100, 50, 100], // Strong-pause-strong pattern
  };

  const pattern = patterns[type];
  
  try {
    if (Array.isArray(pattern)) {
      navigator.vibrate(pattern);
    } else {
      navigator.vibrate(pattern);
    }
  } catch (error) {
    // Silently fail if vibration fails
    console.debug('Haptic feedback not available:', error);
  }
};
