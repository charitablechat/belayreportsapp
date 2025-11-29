/**
 * Haptic feedback utilities for mobile devices
 */

export type HapticFeedbackType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection' | 'impact';

/**
 * Trigger haptic feedback on supported devices
 * @param type - The type of haptic feedback (light, medium, heavy, success, warning, error, selection, impact)
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
    selection: 5, // Very light tap for selections
    impact: [30, 30], // Medium impact for scroll events
  };

  // TypeScript ensures type is valid, but add defensive fallback for extra safety
  const pattern = patterns[type] ?? patterns.light;
  
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

/**
 * Trigger haptic feedback for navigation events
 */
export const triggerNavigationHaptic = () => {
  triggerHaptic('selection');
};

/**
 * Trigger haptic feedback when reaching scroll boundaries
 */
export const triggerScrollBoundaryHaptic = () => {
  triggerHaptic('impact');
};
