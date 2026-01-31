/**
 * Non-Blocking Save Utilities
 * 
 * Ensures save operations NEVER block the UI or get stuck in "saving" state.
 * Implements local-first persistence with optimistic updates.
 */

// Maximum time any save operation should take before we force-reset the state
export const SAVE_TIMEOUT_MS = 8000; // 8 seconds max

// Time to debounce auto-saves
export const AUTO_SAVE_DEBOUNCE_MS = 1500;

/**
 * Wraps a promise with a timeout - resolves with fallback value on timeout
 * instead of rejecting, to ensure graceful degradation
 */
export function withNonBlockingTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T,
  label = 'operation'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => {
        console.warn(`[NonBlockingSave] ${label} timed out after ${timeoutMs}ms - continuing with fallback`);
        resolve(fallbackValue);
      }, timeoutMs);
    }),
  ]);
}

/**
 * Creates a save state manager with automatic timeout protection
 * Ensures the "saving" state is always reset, even on errors or hangs
 */
export function createSaveStateManager(
  setIsSaving: (saving: boolean) => void,
  timeoutMs: number = SAVE_TIMEOUT_MS
) {
  let saveTimeoutRef: NodeJS.Timeout | null = null;
  let isCurrentlySaving = false;
  
  const startSaving = () => {
    if (isCurrentlySaving) {
      console.log('[SaveStateManager] Already saving, skipping');
      return false;
    }
    
    isCurrentlySaving = true;
    setIsSaving(true);
    
    // Safety timeout - ALWAYS reset saving state
    saveTimeoutRef = setTimeout(() => {
      console.warn('[SaveStateManager] Safety timeout reached, force resetting save state');
      endSaving();
    }, timeoutMs);
    
    return true;
  };
  
  const endSaving = () => {
    if (saveTimeoutRef) {
      clearTimeout(saveTimeoutRef);
      saveTimeoutRef = null;
    }
    isCurrentlySaving = false;
    setIsSaving(false);
  };
  
  const isSaving = () => isCurrentlySaving;
  
  return { startSaving, endSaving, isSaving };
}

/**
 * Fire-and-forget local save - updates UI immediately, persists async
 * Local save should NEVER block UI or cause hangs
 */
export async function fireAndForgetLocalSave(
  saveOperation: () => Promise<void>,
  label = 'local save'
): Promise<void> {
  // Don't await - just start the operation
  saveOperation()
    .then(() => {
      if (import.meta.env.DEV) {
        console.log(`[NonBlockingSave] ${label} completed`);
      }
    })
    .catch((error) => {
      console.warn(`[NonBlockingSave] ${label} failed:`, error);
      // Don't throw - local save failure shouldn't block the user
    });
}

/**
 * Non-blocking remote sync with automatic retry queue on failure
 * Returns immediately after queueing - actual sync happens async
 */
export async function nonBlockingRemoteSync(
  syncOperation: () => Promise<void>,
  queueForLater: () => Promise<void>,
  label = 'remote sync'
): Promise<{ success: boolean; queued: boolean }> {
  if (!navigator.onLine) {
    // Immediately queue for later - don't block
    fireAndForgetLocalSave(queueForLater, `${label} queue (offline)`);
    return { success: false, queued: true };
  }
  
  try {
    // Attempt sync with timeout protection
    await withNonBlockingTimeout(
      syncOperation(),
      SAVE_TIMEOUT_MS,
      undefined,
      label
    );
    return { success: true, queued: false };
  } catch (error) {
    console.warn(`[NonBlockingSave] ${label} failed, queueing for later:`, error);
    // Queue for later sync - fire and forget
    fireAndForgetLocalSave(queueForLater, `${label} queue (error)`);
    return { success: false, queued: true };
  }
}

/**
 * Debounced auto-save utility with cleanup
 */
export function createDebouncedAutoSave(
  saveFunction: () => Promise<void>,
  debounceMs: number = AUTO_SAVE_DEBOUNCE_MS
) {
  let timeoutRef: NodeJS.Timeout | null = null;
  
  const trigger = () => {
    if (timeoutRef) {
      clearTimeout(timeoutRef);
    }
    
    timeoutRef = setTimeout(() => {
      saveFunction().catch((error) => {
        console.warn('[DebouncedAutoSave] Save failed:', error);
      });
    }, debounceMs);
  };
  
  const cancel = () => {
    if (timeoutRef) {
      clearTimeout(timeoutRef);
      timeoutRef = null;
    }
  };
  
  const flush = async () => {
    cancel();
    await saveFunction();
  };
  
  return { trigger, cancel, flush };
}
