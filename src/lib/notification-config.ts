/**
 * Notification Configuration - Centralized criticality rules
 * 
 * Criticality Levels:
 * - 'critical': Always show as toast (errors, network issues, auth failures)
 * - 'standard': Toast on desktop, notification center on mobile
 * - 'silent': Notification center only (routine saves, syncs)
 */

export type CriticalityLevel = 'critical' | 'standard' | 'silent';
export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface NotificationConfig {
  patterns: {
    critical: RegExp[];  // Always show as toast
    silent: RegExp[];    // Never show toast, only center
  };
  durations: {
    critical: number;
    standard: number;
    error: number;
  };
}

/**
 * Centralized notification configuration
 * Edit these patterns to control what shows as toast vs notification center
 */
export const NOTIFICATION_CONFIG: NotificationConfig = {
  patterns: {
    // Always show as toast on all platforms
    critical: [
      /error|fail(ed|ure)?|denied|unauthorized/i,
      /offline|reconnect(ed|ing)?|connection lost/i,
      /update available|new version/i,
      /session expired|please sign in|sign out/i,
      /network (error|issue|problem)/i,
      /could not|unable to/i,
      /permission denied|access denied/i,
      /hard-saved/i,
    ],
    // Never show as toast - notification center only
    silent: [
      /^saved$|settings saved|profile updated/i,
      /synced successfully/i,
      /data synced/i,
      /changes saved/i,
      /auto-?sav(e|ed|ing)/i,
      /\d+ (items?|changes?) (saved|synced)/i,
      /draft saved/i,
      /preferences updated/i,
      /progress saved/i,
      /saved offline/i,
      /save successful/i,
      /summary (auto-)?updated/i,
      /saving changes before/i,
      /assessment submitted/i,
      /will sync (automatically )?when/i,
      /saved locally/i,
      // Recoverable storage/sync conditions — log only, never toast
      /backup storage/i,
      /restored from local backup/i,
      /report refreshed/i,
      /haven't synced/i,
      /retrying storage/i,
      /saved to backup/i,
      /storage not guaranteed/i,
      /pending sync/i,
    ],
  },
  durations: {
    critical: 10000,  // 10 seconds for critical
    standard: 4000,   // 4 seconds for standard
    error: 8000,      // 8 seconds for errors
  },
};

/**
 * Classify a message to determine its criticality level
 */
export function classifyMessage(message: string, type: ToastType): CriticalityLevel {
  const { patterns } = NOTIFICATION_CONFIG;
  
  // Errors are always critical
  if (type === 'error') return 'critical';
  
  // Check critical patterns first (takes precedence)
  if (patterns.critical.some(p => p.test(message))) return 'critical';
  
  // Check silent patterns
  if (patterns.silent.some(p => p.test(message))) return 'silent';
  
  // Default: standard (toast on desktop, center on mobile)
  return 'standard';
}

/**
 * Get the appropriate duration for a toast based on its criticality
 */
export function getToastDuration(criticality: CriticalityLevel, type: ToastType): number {
  const { durations } = NOTIFICATION_CONFIG;
  
  if (type === 'error') return durations.error;
  if (criticality === 'critical') return durations.critical;
  return durations.standard;
}
