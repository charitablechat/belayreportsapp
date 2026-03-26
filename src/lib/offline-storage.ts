import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { checkStorageQuota, requestPersistentStorage, isMobile } from './mobile-detection';

interface InspectionDB extends DBSchema {
  inspections: {
    key: string;
    value: any;
    indexes: { 'by-status': string; 'by-synced': string };
  };
  daily_assessments: {
    key: string;
    value: any;
    indexes: { 'by-status': string; 'by-synced': string };
  };
  operations: {
    key: number;
    value: {
      id?: number;
      type: 'create' | 'update' | 'delete';
      inspectionId: string;
      data: any;
      timestamp: number;
      retries: number;
    };
  };
  assessment_operations: {
    key: number;
    value: {
      id?: number;
      type: 'create' | 'update' | 'delete';
      assessmentId: string;
      data: any;
      timestamp: number;
      retries: number;
    };
  };
  photos: {
    key: string;
    value: {
      id: string;
      inspectionId: string;
      section: string;
      blob: Blob | null; // Nullified after successful upload to free storage
      fileName: string;
      timestamp: number;
      uploaded: boolean;
      photoUrl?: string;
      cachedAt?: number; // Timestamp when photo was cached from remote
      lastValidated?: number; // Last time cache was validated
      display_order?: number; // Order for drag-and-drop reordering
      tableName?: string; // DB table for sync (e.g. 'training_photos')
      storageBucket?: string; // Storage bucket (e.g. 'training-photos')
      foreignKeyColumn?: string; // FK column (e.g. 'training_id')
      caption?: string; // Photo caption for gallery labeling
      retryCount?: number; // Failed upload retry counter
    };
    indexes: { 'by-inspection': string; 'by-uploaded': number };
  };
  inspection_systems: {
    key: string;
    value: any;
    indexes: { 'by-inspection': string };
  };
  inspection_ziplines: {
    key: string;
    value: any;
    indexes: { 'by-inspection': string };
  };
  inspection_equipment: {
    key: string;
    value: any;
    indexes: { 'by-inspection': string };
  };
  inspection_standards: {
    key: string;
    value: any;
    indexes: { 'by-inspection': string };
  };
  inspection_summary: {
    key: string;
    value: any;
    indexes: { 'by-inspection': string };
  };
  daily_assessment_beginning_of_day: {
    key: string;
    value: any;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_end_of_day: {
    key: string;
    value: any;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_operating_systems: {
    key: string;
    value: any;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_equipment_checks: {
    key: string;
    value: any;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_structure_checks: {
    key: string;
    value: any;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_environment_checks: {
    key: string;
    value: any;
    indexes: { 'by-assessment': string };
  };
  trainings: {
    key: string;
    value: any;
    indexes: { 'by-status': string; 'by-synced': string };
  };
  training_operations: {
    key: number;
    value: {
      id?: number;
      type: 'create' | 'update' | 'delete';
      trainingId: string;
      data: any;
      timestamp: number;
      retries: number;
    };
  };
  training_delivery_approaches: {
    key: string;
    value: any;
    indexes: { 'by-training': string };
  };
  training_operating_systems: {
    key: string;
    value: any;
    indexes: { 'by-training': string };
  };
  training_immediate_attention: {
    key: string;
    value: any;
    indexes: { 'by-training': string };
  };
  training_verifiable_items: {
    key: string;
    value: any;
    indexes: { 'by-training': string };
  };
  training_systems_in_place: {
    key: string;
    value: any;
    indexes: { 'by-training': string };
  };
  training_summary: {
    key: string;
    value: any;
    indexes: { 'by-training': string };
  };
  report_backups: {
    key: string;
    value: {
      id: string;
      reportType: string;
      reportId: string;
      reportKey: string;
      timestamp: number;
      data: any;
    };
    indexes: { 'by-report': string; 'by-timestamp': number };
  };
  report_versions: {
    key: string;
    value: {
      id: string;
      reportType: string;
      reportId: string;
      versionNumber: number;
      timestamp: number;
      device: string;
      parentData: Record<string, any>;
      childrenData: Record<string, any[]>;
      trigger: string;
      fieldCount: number;
    };
    indexes: { 'by-report': string; 'by-timestamp': number; 'by-report-version': [string, number] };
  };
  autocomplete_history: {
    key: string; // compound: `${field_type}::${value}`
    value: {
      id: string;
      field_type: string;
      value: string;
      usage_count: number;
      last_used_at: string;
      synced: boolean;
    };
    indexes: { 'by-field-type': string; 'by-synced': number };
  };
}

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;
let storageWarningShown = false;

// Health check cache with 30-second TTL
let healthCheckCache: { isHealthy: boolean; timestamp: number } | null = null;
const HEALTH_CHECK_TTL = 30000; // 30 seconds

// ============= CIRCUIT BREAKER PATTERN =============
// Prevents repeated IndexedDB failures from blocking the app
let indexedDBFailureCount = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_TIME = 60000; // 1 minute cooldown
let circuitBreakerTrippedAt: number | null = null;

/**
 * Check if circuit breaker is open (IndexedDB disabled temporarily)
 */
function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerTrippedAt) {
    if (Date.now() - circuitBreakerTrippedAt > CIRCUIT_BREAKER_RESET_TIME) {
      // Reset circuit breaker after cooldown
      circuitBreakerTrippedAt = null;
      indexedDBFailureCount = 0;
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Circuit breaker reset - IndexedDB re-enabled');
      }
      return false;
    }
    return true; // Circuit is still open
  }
  return false;
}

/**
 * Record an IndexedDB failure for circuit breaker
 */
function recordIndexedDBFailure(): void {
  indexedDBFailureCount++;
  if (indexedDBFailureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerTrippedAt = Date.now();
    console.warn('[Offline Storage] Circuit breaker tripped - IndexedDB disabled for 60s after', indexedDBFailureCount, 'failures');
  }
}

/**
 * Record an IndexedDB success - resets failure counter
 */
function recordIndexedDBSuccess(): void {
  if (indexedDBFailureCount > 0) {
    indexedDBFailureCount = 0;
    circuitBreakerTrippedAt = null;
  }
}

/**
 * Get circuit breaker status (for debugging/UI)
 */
export function getCircuitBreakerStatus(): { open: boolean; failureCount: number; resetIn: number | null } {
  const open = isCircuitBreakerOpen();
  return {
    open,
    failureCount: indexedDBFailureCount,
    resetIn: circuitBreakerTrippedAt 
      ? Math.max(0, CIRCUIT_BREAKER_RESET_TIME - (Date.now() - circuitBreakerTrippedAt))
      : null,
  };
}
// ============= END CIRCUIT BREAKER =============

/**
 * Helper to wrap a promise with a timeout
 */
// Track timeout suppression to avoid console spam
let timeoutWarningCount = 0;
let lastTimeoutLogAt = 0;
const TIMEOUT_LOG_INTERVAL = 30000; // Only log once per 30s

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => {
      // Suppress repeated timeout warnings to reduce console noise
      timeoutWarningCount++;
      const now = Date.now();
      if (now - lastTimeoutLogAt > TIMEOUT_LOG_INTERVAL) {
        const suppressed = timeoutWarningCount - 1;
        console.warn(`[Offline Storage] Operation timed out after ${timeoutMs}ms${suppressed > 0 ? ` (${suppressed} similar warnings suppressed)` : ''}`);
        timeoutWarningCount = 0;
        lastTimeoutLogAt = now;
      }
      resolve(fallbackValue);
    }, timeoutMs))
  ]);
}

/**
 * Check if IndexedDB is available and healthy (with 30s cache)
 */
export async function checkIndexedDBHealth(): Promise<boolean> {
  if (!('indexedDB' in window)) {
    console.error('[Offline Storage] IndexedDB not available');
    return false;
  }

  // Return cached result if still valid
  const now = Date.now();
  if (healthCheckCache && (now - healthCheckCache.timestamp) < HEALTH_CHECK_TTL) {
    return healthCheckCache.isHealthy;
  }

  try {
    // Try to open a test database with a 3-second timeout to prevent hangs
    const healthCheckPromise = (async () => {
      const testDb = await openDB('health-check', 1);
      testDb.close();
      return true;
    })();
    
    const result = await withTimeout(healthCheckPromise, 3000, false);
    
    // Cache the result
    healthCheckCache = { isHealthy: result, timestamp: now };
    
    if (!result) {
      console.warn('[Offline Storage] IndexedDB health check timed out - proceeding anyway');
      // Return true anyway to allow loading to continue - we'll handle errors per-operation
      healthCheckCache = { isHealthy: true, timestamp: now };
      return true;
    }
    
    return true;
  } catch (error) {
    console.error('[Offline Storage] IndexedDB health check failed:', error);
    
    // Cache the failed result
    healthCheckCache = { isHealthy: false, timestamp: now };
    return false;
  }
}

/**
 * Request persistent storage and check quota with timeout protection
 */
async function ensureStorage(): Promise<void> {
  // Request persistent storage with timeout (important on mobile, but shouldn't block loading)
  const storagePromise = (async () => {
    const isPersisted = await requestPersistentStorage();
    
    if (!isPersisted && !storageWarningShown) {
      console.warn('[Offline Storage] Persistent storage not granted - data may be cleared by browser');
      storageWarningShown = true;
      // Finding 5: Surface storage eviction risk to user (one-time banner)
      if (typeof window !== 'undefined' && !localStorage.getItem('storage-eviction-warned')) {
        localStorage.setItem('storage-eviction-warned', 'true');
        import('@/hooks/use-toast').then(({ toast }) => {
          toast({
            title: "Offline storage not guaranteed",
            description: "Your browser may clear offline data under storage pressure. Stay connected to sync your work.",
          });
        }).catch(() => {});
      }
    }

    // Check storage quota
    const quota = await checkStorageQuota();
    
    if (quota.percentUsed > 80 && !storageWarningShown) {
      console.warn('[Offline Storage] Storage almost full:', quota.percentUsed.toFixed(2) + '%');
      storageWarningShown = true;
    }
  })();
  
  // Don't let storage checks block loading - timeout after 2 seconds
  await withTimeout(storagePromise, 2000, undefined);
}

// Track if DB has been successfully opened (skip health check after first success)
let dbConnectionVerified = false;

/**
 * Wrapper for IndexedDB operations with error boundary, timeout protection, and circuit breaker
 * Prevents any single IndexedDB operation from blocking the app
 * OPTIMIZED: Skips redundant health checks after first successful DB connection
 * CIRCUIT BREAKER: Fails fast after repeated failures
 */
async function withIndexedDBErrorBoundary<T>(
  operation: () => Promise<T>,
  fallbackValue: T,
  operationName: string
): Promise<T> {
  // CIRCUIT BREAKER: If open, return fallback immediately without attempting operation
  if (isCircuitBreakerOpen()) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Circuit breaker open, returning fallback for ${operationName}`);
    }
    // Finding 2: Surface user-visible warning when write operations are silently dropped
    const isWriteOp = operationName.toLowerCase().includes('save') || 
                      operationName.toLowerCase().includes('put') || 
                      operationName.toLowerCase().includes('delete') ||
                      operationName.toLowerCase().includes('queue') ||
                      operationName.toLowerCase().includes('update');
    if (isWriteOp && typeof window !== 'undefined') {
      const cbWarningKey = 'circuit-breaker-warning-shown';
      if (!sessionStorage.getItem(cbWarningKey)) {
        sessionStorage.setItem(cbWarningKey, 'true');
        // Dynamic import to avoid circular deps
        import('@/hooks/use-toast').then(({ toast }) => {
          toast({
            title: "Storage temporarily unavailable",
            description: "Your changes may not be saved locally. Stay connected to sync your work.",
            variant: "destructive",
          });
        }).catch(() => {});
        // Clear after circuit breaker reset window (60s)
        setTimeout(() => sessionStorage.removeItem(cbWarningKey), 61000);
      }
    }
    return fallbackValue;
  }

  const OPERATION_TIMEOUT = operationName.includes('photo') || operationName.includes('Photo')
    ? 8000  // 8s for photo blob writes (large on iPad Safari)
    : 5000; // 5s for everything else
  const TIMEOUT_SENTINEL = Symbol('timeout');
  
  try {
    // Wrap the entire operation with a timeout, using a sentinel to detect timeouts
    const result = await withTimeout(
      (async () => {
        // Only run health check if we haven't verified the connection yet
        if (!dbConnectionVerified) {
          const isHealthy = await checkIndexedDBHealth();
          if (!isHealthy) {
            console.warn(`[Offline Storage] IndexedDB unhealthy, returning fallback for ${operationName}`);
            recordIndexedDBFailure();
            return fallbackValue;
          }
          // Mark as verified after successful health check
          dbConnectionVerified = true;
        }
        return await operation();
      })(),
      OPERATION_TIMEOUT,
      TIMEOUT_SENTINEL as any
    );
    
    // Check if the result is the sentinel -- meaning a timeout occurred
    if (result === TIMEOUT_SENTINEL) {
      console.warn(`[Offline Storage] Timeout detected for ${operationName}, counting as failure`);
      dbConnectionVerified = false;
      recordIndexedDBFailure();
      return fallbackValue;
    }
    
    recordIndexedDBSuccess();
    return result;
  } catch (error: any) {
    console.error(`[Offline Storage] Error in ${operationName}:`, error);
    // Reset verification on error so next operation re-checks
    dbConnectionVerified = false;

    // QuotaExceededError is NOT an IndexedDB health issue — don't count toward circuit breaker
    const isQuotaError = error?.name === 'QuotaExceededError' || error?.message?.includes('QuotaExceeded');
    if (!isQuotaError) {
      recordIndexedDBFailure();
    }

    // IMMEDIATE user notification for QuotaExceededError on FIRST occurrence
    if (isQuotaError) {
      if (typeof window !== 'undefined') {
        import('@/hooks/use-toast').then(({ toast }) => {
          toast({
            title: "Storage full",
            description: "Device storage is full. Please sync your data and clear old reports.",
            variant: "destructive",
          });
        }).catch(() => {});
      }
    }

    return fallbackValue;
  }
}

export async function getDB() {
  if (!dbPromise) {
    // Ensure storage is available before opening DB (non-blocking)
    await ensureStorage();
    
    // Wrap the entire DB opening process in a timeout to prevent hanging
    // Apply 5-second timeout to the entire DB opening process
    // If IndexedDB hangs, we'll reject and the app can proceed with network-only mode
    // Version 8: Add report_versions store for append-only versioning
    // DB_NAME and DB_VERSION shared with public/db-config.js for SW consistency
    const DB_NAME = 'rope-works-inspections';
    const DB_VERSION = 9;
    const openDBV8WithTimeout = async () => {
      return openDB<InspectionDB>(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) {
          // === All existing v6 upgrade logic ===
          let inspectionStore;
          
          if (!db.objectStoreNames.contains('inspections')) {
            inspectionStore = db.createObjectStore('inspections', { keyPath: 'id' });
            inspectionStore.createIndex('by-status', 'status');
            inspectionStore.createIndex('by-synced', 'synced_at');
          } else {
            inspectionStore = transaction.objectStore('inspections');
            if (!inspectionStore.indexNames.contains('by-synced')) {
              inspectionStore.createIndex('by-synced', 'synced_at');
            }
          }
          
          if (!db.objectStoreNames.contains('operations')) {
            db.createObjectStore('operations', { autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('photos')) {
            const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
            photoStore.createIndex('by-inspection', 'inspectionId');
            photoStore.createIndex('by-uploaded', 'uploaded');
          }
          if (!db.objectStoreNames.contains('inspection_systems')) {
            const store = db.createObjectStore('inspection_systems', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('inspection_ziplines')) {
            const store = db.createObjectStore('inspection_ziplines', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('inspection_equipment')) {
            const store = db.createObjectStore('inspection_equipment', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('inspection_standards')) {
            const store = db.createObjectStore('inspection_standards', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('inspection_summary')) {
            const store = db.createObjectStore('inspection_summary', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('daily_assessments')) {
            const assessmentStore = db.createObjectStore('daily_assessments', { keyPath: 'id' });
            assessmentStore.createIndex('by-status', 'status');
            assessmentStore.createIndex('by-synced', 'synced_at');
          }
          if (!db.objectStoreNames.contains('assessment_operations')) {
            db.createObjectStore('assessment_operations', { autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('daily_assessment_beginning_of_day')) {
            const store = db.createObjectStore('daily_assessment_beginning_of_day', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_end_of_day')) {
            const store = db.createObjectStore('daily_assessment_end_of_day', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_operating_systems')) {
            const store = db.createObjectStore('daily_assessment_operating_systems', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_equipment_checks')) {
            const store = db.createObjectStore('daily_assessment_equipment_checks', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_structure_checks')) {
            const store = db.createObjectStore('daily_assessment_structure_checks', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_environment_checks')) {
            const store = db.createObjectStore('daily_assessment_environment_checks', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('trainings')) {
            const trainingStore = db.createObjectStore('trainings', { keyPath: 'id' });
            trainingStore.createIndex('by-status', 'status');
            trainingStore.createIndex('by-synced', 'synced_at');
          }
          if (!db.objectStoreNames.contains('training_operations')) {
            db.createObjectStore('training_operations', { autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('training_delivery_approaches')) {
            const store = db.createObjectStore('training_delivery_approaches', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_operating_systems')) {
            const store = db.createObjectStore('training_operating_systems', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_immediate_attention')) {
            const store = db.createObjectStore('training_immediate_attention', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_verifiable_items')) {
            const store = db.createObjectStore('training_verifiable_items', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_systems_in_place')) {
            const store = db.createObjectStore('training_systems_in_place', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_summary')) {
            const store = db.createObjectStore('training_summary', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }

          // === NEW in v7: report_backups WAL store ===
          if (!db.objectStoreNames.contains('report_backups')) {
            const backupStore = db.createObjectStore('report_backups', { keyPath: 'id' });
            backupStore.createIndex('by-report', 'reportKey');
            backupStore.createIndex('by-timestamp', 'timestamp');
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created report_backups store (v7 upgrade)');
            }
          }

          // === NEW in v8: report_versions append-only store ===
          if (!db.objectStoreNames.contains('report_versions')) {
            const versionStore = db.createObjectStore('report_versions', { keyPath: 'id' });
            versionStore.createIndex('by-report', 'reportId');
            versionStore.createIndex('by-timestamp', 'timestamp');
            versionStore.createIndex('by-report-version', ['reportId', 'versionNumber']);
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created report_versions store (v8 upgrade)');
            }
          }

          // === NEW in v9: autocomplete_history store ===
          if (!db.objectStoreNames.contains('autocomplete_history')) {
            const acStore = db.createObjectStore('autocomplete_history', { keyPath: 'id' });
            acStore.createIndex('by-field-type', 'field_type');
            acStore.createIndex('by-synced', 'synced');
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created autocomplete_history store (v9 upgrade)');
            }
          }
        },
      });
    };

    // RC-3: Use 5s timeout on mobile (Safari bfcache restore can take 3-5s)
    const DB_OPEN_TIMEOUT = isMobile() ? 5000 : 3000;
    dbPromise = Promise.race([
      openDBV8WithTimeout(),
      new Promise<never>((_, reject) => 
        setTimeout(() => {
          console.warn(`[Offline Storage] IndexedDB open timed out after ${DB_OPEN_TIMEOUT / 1000}s`);
          reject(new Error('IndexedDB open timed out'));
        }, DB_OPEN_TIMEOUT)
      )
    ]).catch(error => {
      console.error('[Offline Storage] Failed to open IndexedDB:', error);
      dbPromise = null; // Reset so next attempt can retry
      throw error;
    });
  }
  return dbPromise;
}

// Inspection functions

export async function saveInspectionOffline(inspection: any) {
  return withIndexedDBErrorBoundary(
    async () => {
      try {
        const db = await getDB();
        await db.put('inspections', inspection);
        
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Saved inspection:', inspection.id);
        }
      } catch (error: any) {
        console.error('[Offline Storage] Failed to save inspection:', error);
        
        if (error.name === 'QuotaExceededError') {
          throw new Error('Storage quota exceeded. Please sync and clear old data.');
        }
        
        throw error;
      }
    },
    undefined,
    'saveInspectionOffline'
  );
}

export async function getOfflineInspections(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allInspections = await db.getAll('inspections');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      const activeInspections = allInspections.filter(i => !i.deleted_at);
      
      // Super admins see all reports - bypass user filtering
      if (isSuperAdmin) {
        return activeInspections;
      }
      
      // Filter by user ID if provided (for privacy on shared devices)
      if (userId) {
        return activeInspections.filter(i => i.inspector_id === userId);
      }
      
      return activeInspections;
    },
    [],
    'getOfflineInspections'
  );
}

export async function getOfflineInspection(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await db.get('inspections', id);
    },
    null,
    'getOfflineInspection'
  );
}

export async function deleteOfflineInspection(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // WAL BACKUP: Snapshot before delete for recovery
      try {
        const record = await db.get('inspections', id);
        if (record) {
          await createReportBackup('inspection', id, record);
        }
      } catch (backupErr) {
        console.warn('[Offline Storage] Pre-delete backup failed for inspection:', backupErr);
      }
      
      await db.delete('inspections', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Deleted offline inspection:', id);
      }
    },
    undefined,
    'deleteOfflineInspection'
  );
}

export async function getUnsyncedInspections(userId?: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allInspections = await db.getAll('inspections');
      let unsynced = allInspections.filter(i => {
        if (!i.synced_at) return true;
        if (!i.updated_at) return false;
        // Tolerate up to 2 seconds of drift from server-side timestamp alignment
        const drift = new Date(i.updated_at).getTime() - new Date(i.synced_at).getTime();
        return drift > 2000;
      });
      
      if (userId) {
        const owned = unsynced.filter(i => i.inspector_id === userId);
        const orphaned = unsynced.filter(
          i => i.inspector_id !== userId && i.id.startsWith('temp-')
        );
        if (orphaned.length > 0) {
          console.warn('[Offline Storage] Found orphaned temp-ID inspections:', 
            orphaned.map(i => ({ id: i.id.substring(0, 20) }))
          );
        }
        unsynced = [...owned, ...orphaned];
      }
      
      console.log('[Offline Storage] Unsynced inspections:', {
        total: unsynced.length,
        userId: userId ? userId.substring(0, 8) + '...' : 'all',
      });
      
      return unsynced;
    },
    [],
    'getUnsyncedInspections'
  );
}

export async function queueOperation(type: 'create' | 'update' | 'delete', inspectionId: string, data: any) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.add('operations', {
        type,
        inspectionId,
        data,
        timestamp: Date.now(),
        retries: 0,
      });
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued operation:', { type, inspectionId });
      }
      
      try {
        const { registerInspectionSync } = await import('./background-sync');
        await registerInspectionSync();
      } catch (e) {
        console.warn('[Offline Storage] Background sync registration failed:', e);
      }
    },
    undefined,
    'queueOperation'
  );
}

export async function getQueuedOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operations = await db.getAll('operations');
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued operations:', operations.length);
      }
      return operations;
    },
    [],
    'getQueuedOperations'
  );
}

export async function removeQueuedOperation(id: number) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('operations', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Removed queued operation:', id);
      }
    },
    undefined,
    'removeQueuedOperation'
  );
}

export async function clearAllQueuedOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('operations', 'readwrite');
      await tx.store.clear();
      await tx.done;
      console.log('[Offline Storage] Cleared all queued operations');
    },
    undefined,
    'clearAllQueuedOperations'
  );
}

export async function clearAllQueuedAssessmentOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('assessment_operations', 'readwrite');
      await tx.store.clear();
      await tx.done;
      console.log('[Offline Storage] Cleared all queued assessment operations');
    },
    undefined,
    'clearAllQueuedAssessmentOperations'
  );
}

export async function clearAllQueuedTrainingOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('training_operations', 'readwrite');
      await tx.store.clear();
      await tx.done;
      console.log('[Offline Storage] Cleared all queued training operations');
    },
    undefined,
    'clearAllQueuedTrainingOperations'
  );
}

export async function incrementOperationRetry(id: number) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operation = await db.get('operations', id);
      if (operation) {
        operation.retries += 1;
        await db.put('operations', operation);
      }
    },
    undefined,
    'incrementOperationRetry'
  );
}

// Photo functions

export async function savePhotoOffline(photo: {
  id: string;
  inspectionId: string;
  section: string;
  blob: Blob;
  fileName: string;
  uploaded?: boolean;
  photoUrl?: string;
  tableName?: string;
  storageBucket?: string;
  foreignKeyColumn?: string;
  caption?: string;
}): Promise<boolean> {
  return withIndexedDBErrorBoundary(
    async () => {
      try {
        const db = await getDB();
        
        // NON-BLOCKING quota check - fire-and-forget, don't await
        checkStorageQuota().then(quota => {
          if (quota.percentUsed > 90) {
            console.warn('[Offline Storage] Storage almost full:', quota.percentUsed.toFixed(1), '%');
          }
        }).catch(() => {});
        
        await db.put('photos', {
          ...photo,
          timestamp: Date.now(),
          uploaded: photo.uploaded || false,
        });
        
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Saved photo:', photo.id);
        }
        
        // Background sync registration (also non-blocking)
        if (!photo.uploaded) {
          import('./background-sync').then(({ registerPhotoSync }) => {
            registerPhotoSync().catch(() => {});
          }).catch(() => {});
        }
        
        return true;
      } catch (error: any) {
        console.error('[Offline Storage] Failed to save photo:', error);
        
        if (error.name === 'QuotaExceededError') {
          throw new Error('Storage quota exceeded. Please sync photos to free up space.');
        }
        
        throw error;
      }
    },
    false,
    'savePhotoOffline'
  );
}

export async function relinkPhotosToNewInspectionId(
  oldInspectionId: string,
  newInspectionId: string
): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      const index = tx.store.index('by-inspection');
      const photos = await index.getAll(oldInspectionId);
      
      let relinkedCount = 0;
      for (const photo of photos) {
        photo.inspectionId = newInspectionId;
        await tx.store.put(photo);
        relinkedCount++;
      }
      
      await tx.done;
      
      if (relinkedCount > 0) {
        console.log(`[Offline Storage] Relinked ${relinkedCount} photos from ${oldInspectionId} to ${newInspectionId}`);
      }
      
      return relinkedCount;
    },
    0,
    'relinkPhotosToNewInspectionId'
  );
}

export async function getOfflinePhotos(inspectionId: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const index = db.transaction('photos').store.index('by-inspection');
      return await index.getAll(inspectionId);
    },
    [],
    'getOfflinePhotos'
  );
}

/**
 * Update the caption of an offline (unsynced) photo in IndexedDB
 */
export async function updateOfflinePhotoCaption(photoId: string, caption: string): Promise<boolean> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', photoId);
      if (photo) {
        photo.caption = caption;
        await db.put('photos', photo);
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Updated offline photo caption:', photoId);
        }
        return true;
      }
      return false;
    },
    false,
    'updateOfflinePhotoCaption'
  );
}

export async function getUnuploadedPhotos(userId?: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allPhotos = await db.getAll('photos');
      // Filter to photos that still have a blob and haven't been uploaded
      // Don't filter by unsynced inspections — photos for already-synced reports
      // must still be included or they become permanently orphaned
      const unuploaded = allPhotos.filter(p => !p.uploaded && p.blob != null);
      
      return unuploaded;
    },
    [],
    'getUnuploadedPhotos'
  );
}

export async function markPhotoAsUploaded(id: string, photoUrl: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        photo.uploaded = true;
        photo.photoUrl = photoUrl;
        photo.lastValidated = Date.now();
        // Release the binary blob to free IndexedDB storage quota
        photo.blob = null;
        photo.retryCount = 0;
        await db.put('photos', photo);
        
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Marked photo as uploaded (blob released):', id);
        }
      }
    },
    undefined,
    'markPhotoAsUploaded'
  );
}

export async function updatePhotoPath(id: string, newPath: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        photo.photoUrl = newPath;
        await db.put('photos', photo);
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Updated photo path:', id, '->', newPath);
        }
      }
    },
    undefined,
    'updatePhotoPath'
  );
}

export async function incrementPhotoRetryCount(id: string): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        const newCount = (photo.retryCount || 0) + 1;
        photo.retryCount = newCount;
        await db.put('photos', photo);
        return newCount;
      }
      return 0;
    },
    0,
    'incrementPhotoRetryCount'
  );
}

export async function deleteOfflinePhoto(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // WAL backup — snapshot photo before deleting
      try {
        const photo = await db.get('photos', id);
        if (photo && !photo.uploaded && db.objectStoreNames.contains('report_backups')) {
          await db.put('report_backups', {
            id: `photo_backup_${id}_${Date.now()}`,
            reportType: 'photo',
            reportId: id,
            reportKey: `photo_${id}`,
            timestamp: Date.now(),
            data: photo,
          });
        }
      } catch (e) {
        console.warn('[Offline Storage] Non-critical: failed to backup photo before delete:', e);
      }
      
      await db.delete('photos', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Deleted photo:', id);
      }
    },
    undefined,
    'deleteOfflinePhoto'
  );
}

/**
 * Update the display order of photos in IndexedDB for drag-and-drop reordering
 * @param inspectionId - The inspection ID
 * @param section - The photo section
 * @param photoIds - Array of photo IDs in the new order
 */
export async function updatePhotoDisplayOrder(
  inspectionId: string,
  section: string,
  photoIds: string[]
): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      const store = tx.objectStore('photos');
      
      // Update each photo's display_order
      await Promise.all(
        photoIds.map(async (id, index) => {
          const photo = await store.get(id);
          if (photo && photo.inspectionId === inspectionId && photo.section === section) {
            photo.display_order = index;
            await store.put(photo);
          }
        })
      );
      
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Updated photo display order:', {
          inspectionId,
          section,
          count: photoIds.length,
        });
      }
    },
    undefined,
    'updatePhotoDisplayOrder'
  );
}

type RelatedDataType = 'systems' | 'ziplines' | 'equipment' | 'standards' | 'summary';
type RelatedStoreNames = 'inspection_systems' | 'inspection_ziplines' | 'inspection_equipment' | 'inspection_standards' | 'inspection_summary';

const storeNameMap: Record<RelatedDataType, RelatedStoreNames> = {
  systems: 'inspection_systems',
  ziplines: 'inspection_ziplines',
  equipment: 'inspection_equipment',
  standards: 'inspection_standards',
  summary: 'inspection_summary',
};

// UUID validation helper - checks if string is a valid UUID format
const isValidUUID = (id: string): boolean => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

// Generate a proper UUID for items without valid UUIDs
const ensureValidUUID = (id: string | undefined): string => {
  if (!id || id.startsWith('temp-') || !isValidUUID(id)) {
    return crypto.randomUUID();
  }
  return id;
};

export async function saveRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string,
  data: any[],
  options?: { allowEmpty?: boolean }
) {
  // SAFETY: Never overwrite existing IndexedDB data with an empty array
  // UNLESS allowEmpty is explicitly set (user deliberately cleared all items)
  if (data.length === 0 && !options?.allowEmpty) {
    console.warn(`[Offline Storage] Blocked save of empty ${type} array for ${inspectionId} -- preserving existing data`);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch operations
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-inspection');
      
      // Get existing data within the transaction
      const existingData = await index.getAll(inspectionId);
      
      // Batch all operations within the same transaction (no await between operations)
      const deletePromises = existingData.map(item => store.delete(item.id));
      const putPromises = data.map(item => {
        const dataWithInspectionId = {
          ...item,
          inspection_id: inspectionId,
          id: ensureValidUUID(item.id),
        };
        return store.put(dataWithInspectionId);
      });
      
      // Execute all operations in parallel, then wait for transaction to complete
      await Promise.all([...deletePromises, ...putPromises]);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Saved ${type}:`, data.length, 'items');
      }
    },
    undefined,
    `saveRelatedDataOffline:${type}`
  );
}

export async function getRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string
): Promise<any[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      const index = db.transaction(storeName).store.index('by-inspection');
      const results = await index.getAll(inspectionId);
      // Sort by display_order to maintain consistent ordering
      return results.sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));
    },
    [],
    `getRelatedDataOffline:${type}`
  );
}

export async function clearRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string,
  options?: { bypassTempGuard?: boolean }
) {
  // SAFETY: Only allow clearing data for temp-IDs (used during temp-to-permanent ID migration)
  // Unless explicitly bypassed for orphan cleanup
  if (!inspectionId.startsWith('temp-') && !options?.bypassTempGuard) {
    console.error(`[SAFETY] Blocked clear ${type} operation on non-temp ID:`, inspectionId);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch delete
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-inspection');
      
      const existingData = await index.getAll(inspectionId);
      
      // Batch all deletes within the same transaction
      const deletePromises = existingData.map(item => store.delete(item.id));
      await Promise.all(deletePromises);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Cleared ${type} for inspection:`, inspectionId);
      }
    },
    undefined,
    `clearRelatedDataOffline:${type}`
  );
}

// Daily Assessment functions
export async function saveDailyAssessmentOffline(assessment: any) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.put('daily_assessments', assessment);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved daily assessment:', assessment.id);
      }
    },
    undefined,
    'saveDailyAssessmentOffline'
  );
}

export async function getOfflineDailyAssessments(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allAssessments = await db.getAll('daily_assessments');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      const activeAssessments = allAssessments.filter(a => !a.deleted_at);
      
      // Super admins see all reports - bypass user filtering
      if (isSuperAdmin) {
        return activeAssessments;
      }
      
      // Filter by user ID if provided (for privacy on shared devices)
      if (userId) {
        return activeAssessments.filter(a => a.inspector_id === userId);
      }
      
      return activeAssessments;
    },
    [],
    'getOfflineDailyAssessments'
  );
}

export async function getOfflineDailyAssessment(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await db.get('daily_assessments', id);
    },
    null,
    'getOfflineDailyAssessment'
  );
}

export async function deleteOfflineDailyAssessment(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // WAL BACKUP: Snapshot before delete for recovery
      try {
        const record = await db.get('daily_assessments', id);
        if (record) {
          await createReportBackup('daily_assessment', id, record);
        }
      } catch (backupErr) {
        console.warn('[Offline Storage] Pre-delete backup failed for assessment:', backupErr);
      }
      
      await db.delete('daily_assessments', id);
    },
    undefined,
    'deleteOfflineDailyAssessment'
  );
}

export async function getUnsyncedDailyAssessments(userId?: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allAssessments = await db.getAll('daily_assessments');
      let unsynced = allAssessments.filter(a => {
        if (!a.synced_at) return true;
        if (!a.updated_at) return false;
        // Tolerate up to 2 seconds of drift from server-side timestamp alignment
        const drift = new Date(a.updated_at).getTime() - new Date(a.synced_at).getTime();
        return drift > 2000;
      });
      
      if (userId) {
        const owned = unsynced.filter(a => a.inspector_id === userId);
        const orphaned = unsynced.filter(
          a => a.inspector_id !== userId && a.id.startsWith('temp-')
        );
        if (orphaned.length > 0) {
          console.warn('[Offline Storage] Found orphaned temp-ID daily assessments:', 
            orphaned.map(a => ({ id: a.id.substring(0, 20) }))
          );
        }
        unsynced = [...owned, ...orphaned];
      }
      
      console.log('[Offline Storage] Unsynced daily assessments:', {
        total: unsynced.length,
        userId: userId ? userId.substring(0, 8) + '...' : 'all',
      });
      
      return unsynced;
    },
    [],
    'getUnsyncedDailyAssessments'
  );
}

export async function queueAssessmentOperation(type: 'create' | 'update' | 'delete', assessmentId: string, data: any) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.add('assessment_operations', {
        type,
        assessmentId,
        data,
        timestamp: Date.now(),
        retries: 0,
      });
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued assessment operation:', { type, assessmentId });
      }
      
      try {
        const { registerInspectionSync } = await import('./background-sync');
        await registerInspectionSync();
      } catch (e) {
        console.warn('[Offline Storage] Background sync registration failed:', e);
      }
    },
    undefined,
    'queueAssessmentOperation'
  );
}

export async function getQueuedAssessmentOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operations = await db.getAll('assessment_operations');
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued assessment operations:', operations.length);
      }
      return operations;
    },
    [],
    'getQueuedAssessmentOperations'
  );
}

export async function removeQueuedAssessmentOperation(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot remove assessment operation with undefined/null ID');
    return;
  }
  
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('assessment_operations', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Removed queued assessment operation:', id);
      }
    },
    undefined,
    'removeQueuedAssessmentOperation'
  );
}

export async function incrementAssessmentOperationRetry(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot increment retry for assessment operation with undefined/null ID');
    return;
  }
  
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operation = await db.get('assessment_operations', id);
      if (operation) {
        operation.retries += 1;
        await db.put('assessment_operations', operation);
      }
    },
    undefined,
    'incrementAssessmentOperationRetry'
  );
}

type AssessmentDataType = 'beginning_of_day' | 'end_of_day' | 'operating_systems' | 'equipment_checks' | 'structure_checks' | 'environment_checks';
type AssessmentStoreNames = 'daily_assessment_beginning_of_day' | 'daily_assessment_end_of_day' | 'daily_assessment_operating_systems' | 'daily_assessment_equipment_checks' | 'daily_assessment_structure_checks' | 'daily_assessment_environment_checks';

const assessmentStoreNameMap: Record<AssessmentDataType, AssessmentStoreNames> = {
  beginning_of_day: 'daily_assessment_beginning_of_day',
  end_of_day: 'daily_assessment_end_of_day',
  operating_systems: 'daily_assessment_operating_systems',
  equipment_checks: 'daily_assessment_equipment_checks',
  structure_checks: 'daily_assessment_structure_checks',
  environment_checks: 'daily_assessment_environment_checks',
};

export async function saveAssessmentDataOffline(
  type: AssessmentDataType,
  assessmentId: string,
  data: any[],
  options?: { allowEmpty?: boolean }
) {
  // SAFETY: Never overwrite existing IndexedDB data with an empty array
  // UNLESS allowEmpty is explicitly set (user deliberately cleared all items)
  if (data.length === 0 && !options?.allowEmpty) {
    console.warn(`[Offline Storage] Blocked save of empty ${type} array for ${assessmentId} -- preserving existing data`);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = assessmentStoreNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch operations
      // This matches the optimized pattern in saveRelatedDataOffline
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-assessment');
      
      // Get existing data within the transaction
      const existingData = await index.getAll(assessmentId);
      
      // Batch all operations within the same transaction (no await between operations)
      const deletePromises = existingData.map(item => store.delete(item.id));
      const putPromises = data.map(item => {
        const dataWithAssessmentId = {
          ...item,
          assessment_id: assessmentId,
          // Use crypto.randomUUID() for proper UUID generation instead of composite IDs
          id: ensureValidUUID(item.id),
        };
        return store.put(dataWithAssessmentId);
      });
      
      // Execute all operations in parallel, then wait for transaction to complete
      await Promise.all([...deletePromises, ...putPromises]);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Saved assessment ${type}:`, data.length, 'items');
      }
    },
    undefined,
    `saveAssessmentDataOffline:${type}`
  );
}

export async function getAssessmentDataOffline(
  type: AssessmentDataType,
  assessmentId: string
): Promise<any[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = assessmentStoreNameMap[type];
      const index = db.transaction(storeName).store.index('by-assessment');
      const results = await index.getAll(assessmentId);
      return results.sort((a: any, b: any) => 
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
    },
    [],
    `getAssessmentDataOffline:${type}`
  );
}

export async function clearAssessmentDataOffline(
  type: AssessmentDataType,
  assessmentId: string,
  options?: { bypassTempGuard?: boolean }
) {
  // SAFETY: Only allow clearing data for temp-IDs (used during temp-to-permanent ID migration)
  // Unless explicitly bypassed for orphan cleanup
  if (!assessmentId.startsWith('temp-') && !options?.bypassTempGuard) {
    console.error(`[SAFETY] Blocked clear ${type} operation on non-temp ID:`, assessmentId);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = assessmentStoreNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch delete
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-assessment');
      
      const existingData = await index.getAll(assessmentId);
      
      // Batch all deletes within the same transaction
      const deletePromises = existingData.map(item => store.delete(item.id));
      await Promise.all(deletePromises);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Cleared ${type} for assessment:`, assessmentId);
      }
    },
    undefined,
    `clearAssessmentDataOffline:${type}`
  );
}

// Training functions
export async function saveTrainingOffline(training: any) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.put('trainings', training);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved training:', training.id);
      }
    },
    undefined,
    'saveTrainingOffline'
  );
}

export async function getOfflineTrainings(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allTrainings = await db.getAll('trainings');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      const activeTrainings = allTrainings.filter(t => !t.deleted_at);
      
      // Super admins see all reports - bypass user filtering
      if (isSuperAdmin) {
        return activeTrainings;
      }
      
      // Filter by user ID if provided (for privacy on shared devices)
      if (userId) {
        return activeTrainings.filter(t => t.inspector_id === userId);
      }
      
      return activeTrainings;
    },
    [],
    'getOfflineTrainings'
  );
}

export async function getOfflineTraining(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await db.get('trainings', id);
    },
    null,
    'getOfflineTraining'
  );
}

export async function deleteOfflineTraining(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // WAL BACKUP: Snapshot before delete for recovery
      try {
        const record = await db.get('trainings', id);
        if (record) {
          await createReportBackup('training', id, record);
        }
      } catch (backupErr) {
        console.warn('[Offline Storage] Pre-delete backup failed for training:', backupErr);
      }
      
      await db.delete('trainings', id);
    },
    undefined,
    'deleteOfflineTraining'
  );
}

export async function getUnsyncedTrainings(userId?: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allTrainings = await db.getAll('trainings');
      let unsynced = allTrainings.filter(t => {
        if (!t.synced_at) return true;
        if (!t.updated_at) return false;
        // Tolerate up to 2 seconds of drift from server-side timestamp alignment
        const drift = new Date(t.updated_at).getTime() - new Date(t.synced_at).getTime();
        return drift > 2000;
      });
      
      if (userId) {
        const owned = unsynced.filter(t => t.inspector_id === userId);
        const orphaned = unsynced.filter(
          t => t.inspector_id !== userId && t.id.startsWith('temp-')
        );
        if (orphaned.length > 0) {
          console.warn('[Offline Storage] Found orphaned temp-ID trainings:', 
            orphaned.map(t => ({ id: t.id.substring(0, 20) }))
          );
        }
        unsynced = [...owned, ...orphaned];
      }
      
      console.log('[Offline Storage] Unsynced trainings:', {
        total: unsynced.length,
        userId: userId ? userId.substring(0, 8) + '...' : 'all',
      });
      
      return unsynced;
    },
    [],
    'getUnsyncedTrainings'
  );
}

/**
 * Batched unsynced counts — single IndexedDB transaction instead of 3 separate calls.
 * Reduces timeout storm when multiple hooks poll concurrently.
 */
export async function getUnsyncedCounts(userId?: string): Promise<{
  inspections: any[];
  trainings: any[];
  assessments: any[];
}> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      const filterUnsynced = (items: any[], ownerField = 'inspector_id') => {
        let unsynced = items.filter(i => {
          if (!i.synced_at) return true;
          if (!i.updated_at) return false;
          const drift = new Date(i.updated_at).getTime() - new Date(i.synced_at).getTime();
          return drift > 2000;
        });
        if (userId) {
          const owned = unsynced.filter(i => i[ownerField] === userId);
          const orphaned = unsynced.filter(i => i[ownerField] !== userId && i.id.startsWith('temp-'));
          unsynced = [...owned, ...orphaned];
        }
        return unsynced;
      };
      
      // RC-1: Sequential reads instead of parallel to reduce Safari IDB lock contention
      const allInspections = await db.getAll('inspections');
      const allTrainings = await db.getAll('trainings');
      const allAssessments = await db.getAll('daily_assessments');
      
      return {
        inspections: filterUnsynced(allInspections),
        trainings: filterUnsynced(allTrainings),
        assessments: filterUnsynced(allAssessments),
      };
    },
    { inspections: [], trainings: [], assessments: [] },
    'getUnsyncedCounts'
  );
}

export async function queueTrainingOperation(type: 'create' | 'update' | 'delete', trainingId: string, data: any) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.add('training_operations', {
        type,
        trainingId,
        data,
        timestamp: Date.now(),
        retries: 0,
      });
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued training operation:', { type, trainingId });
      }
      
      try {
        const { registerInspectionSync } = await import('./background-sync');
        await registerInspectionSync();
      } catch (e) {
        console.warn('[Offline Storage] Background sync registration failed:', e);
      }
    },
    undefined,
    'queueTrainingOperation'
  );
}

export async function getQueuedTrainingOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operations = await db.getAll('training_operations');
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued training operations:', operations.length);
      }
      return operations;
    },
    [],
    'getQueuedTrainingOperations'
  );
}

export async function removeQueuedTrainingOperation(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot remove training operation with undefined/null ID');
    return;
  }
  
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('training_operations', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Removed queued training operation:', id);
      }
    },
    undefined,
    'removeQueuedTrainingOperation'
  );
}

export async function incrementTrainingOperationRetry(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot increment retry for training operation with undefined/null ID');
    return;
  }
  
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operation = await db.get('training_operations', id);
      if (operation) {
        operation.retries += 1;
        await db.put('training_operations', operation);
      }
    },
    undefined,
    'incrementTrainingOperationRetry'
  );
}

type TrainingDataType = 'delivery_approaches' | 'operating_systems' | 'immediate_attention' | 'verifiable_items' | 'systems_in_place' | 'summary';
type TrainingStoreNames = 'training_delivery_approaches' | 'training_operating_systems' | 'training_immediate_attention' | 'training_verifiable_items' | 'training_systems_in_place' | 'training_summary';

const trainingStoreNameMap: Record<TrainingDataType, TrainingStoreNames> = {
  delivery_approaches: 'training_delivery_approaches',
  operating_systems: 'training_operating_systems',
  immediate_attention: 'training_immediate_attention',
  verifiable_items: 'training_verifiable_items',
  systems_in_place: 'training_systems_in_place',
  summary: 'training_summary',
};

export async function saveTrainingDataOffline(
  type: TrainingDataType,
  trainingId: string,
  data: any[] | any,
  options?: { allowEmpty?: boolean }
) {
  // SAFETY: Never overwrite existing IndexedDB data with an empty array
  // UNLESS allowEmpty is explicitly set (user deliberately cleared all items)
  const items = Array.isArray(data) ? data : [data];
  if (items.length === 0 && !options?.allowEmpty) {
    console.warn(`[Offline Storage] Blocked save of empty ${type} array for ${trainingId} -- preserving existing data`);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = trainingStoreNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch operations
      // This matches the optimized pattern in saveRelatedDataOffline
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-training');
      
      // Get existing data within the transaction
      const existingData = await index.getAll(trainingId);
      
      // items already computed above (with empty-array guard)
      
      // Batch all operations within the same transaction (no await between operations)
      const deletePromises = existingData.map(item => store.delete(item.id));
      const putPromises = items.map(item => {
        const dataWithTrainingId = {
          ...item,
          training_id: trainingId,
          // Use crypto.randomUUID() for proper UUID generation instead of composite IDs
          // This fixes the "Invalid uuid" validation error during sync
          id: ensureValidUUID(item.id),
        };
        return store.put(dataWithTrainingId);
      });
      
      // Execute all operations in parallel, then wait for transaction to complete
      await Promise.all([...deletePromises, ...putPromises]);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Saved training ${type}:`, items.length, 'items');
      }
    },
    undefined,
    `saveTrainingDataOffline:${type}`
  );
}

export async function getTrainingDataOffline(
  type: TrainingDataType,
  trainingId: string
): Promise<any[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = trainingStoreNameMap[type];
      const index = db.transaction(storeName).store.index('by-training');
      const results = await index.getAll(trainingId);
      return results.sort((a: any, b: any) => 
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
    },
    [],
    `getTrainingDataOffline:${type}`
  );
}

export async function clearTrainingDataOffline(
  type: TrainingDataType,
  trainingId: string,
  options?: { bypassTempGuard?: boolean }
) {
  // SAFETY: Only allow clearing data for temp-IDs (used during temp-to-permanent ID migration)
  // Unless explicitly bypassed for orphan cleanup
  if (!trainingId.startsWith('temp-') && !options?.bypassTempGuard) {
    console.error(`[SAFETY] Blocked clear ${type} operation on non-temp ID:`, trainingId);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = trainingStoreNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch delete
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-training');
      
      const existingData = await index.getAll(trainingId);
      
      // Batch all deletes within the same transaction
      const deletePromises = existingData.map(item => store.delete(item.id));
      await Promise.all(deletePromises);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Cleared ${type} for training:`, trainingId);
      }
    },
    undefined,
    `clearTrainingDataOffline:${type}`
  );
}

// ============= WRITE-AHEAD LOG (WAL) BACKUP FUNCTIONS =============
// Before destructive operations, snapshot current data into report_backups store.
// Keeps last 3 versions per report for recovery.

const MAX_BACKUPS_PER_REPORT = 3;

/**
 * Create a WAL backup of a report's current state before destructive operations.
 * @param backupCategory - Optional category prefix to separate WAL (pre-delete) from version snapshots.
 *   'wal' = pre-delete snapshots, 'ver' = version snapshots. Default: 'wal'.
 *   Each category has its own 3-slot limit, preventing pre-delete backups from evicting version snapshots.
 */
export async function createReportBackup(
  reportType: string,
  reportId: string,
  data: any,
  backupCategory: 'wal' | 'ver' = 'wal'
): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const reportKey = `${backupCategory}_${reportType}_${reportId}`;
      const backupId = `${reportKey}_${Date.now()}`;
      
      // Write the new backup
      await db.put('report_backups', {
        id: backupId,
        reportType,
        reportId,
        reportKey,
        timestamp: Date.now(),
        data,
      });
      
      // Prune old backups (keep last MAX_BACKUPS_PER_REPORT)
      const tx = db.transaction('report_backups', 'readwrite');
      const index = tx.store.index('by-report');
      const allBackups = await index.getAll(reportKey);
      
      if (allBackups.length > MAX_BACKUPS_PER_REPORT) {
        // Sort by timestamp descending, delete the oldest
        allBackups.sort((a, b) => b.timestamp - a.timestamp);
        const toDelete = allBackups.slice(MAX_BACKUPS_PER_REPORT);
        for (const old of toDelete) {
          await tx.store.delete(old.id);
        }
      }
      
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[WAL Backup] Created backup for ${reportType}:`, reportId.substring(0, 8));
      }
    },
    undefined,
    `createReportBackup:${reportType}`
  );
}

/**
 * Restore the most recent backup for a report.
 */
export async function restoreFromBackup(
  reportType: string,
  reportId: string
): Promise<any | null> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      // Search both WAL and version backup categories
      const walKey = `wal_${reportType}_${reportId}`;
      const verKey = `ver_${reportType}_${reportId}`;
      const legacyKey = `${reportType}_${reportId}`; // Backward compat with pre-category backups
      const index = db.transaction('report_backups').store.index('by-report');
      
      const [walBackups, verBackups, legacyBackups] = await Promise.all([
        index.getAll(walKey),
        index.getAll(verKey),
        index.getAll(legacyKey),
      ]);
      
      const allBackups = [...walBackups, ...verBackups, ...legacyBackups];
      if (allBackups.length === 0) return null;
      
      // Return the most recent backup across all categories
      allBackups.sort((a, b) => b.timestamp - a.timestamp);
      return allBackups[0].data;
    },
    null,
    `restoreFromBackup:${reportType}`
  );
}

/**
 * List all available WAL backups (for recovery dashboard).
 */
export async function listAllBackups(): Promise<Array<{
  id: string;
  reportType: string;
  reportId: string;
  timestamp: number;
}>> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allBackups = await db.getAll('report_backups');
      return allBackups.map(b => ({
        id: b.id,
        reportType: b.reportType,
        reportId: b.reportId,
        timestamp: b.timestamp,
      })).sort((a, b) => b.timestamp - a.timestamp);
    },
    [],
    'listAllBackups'
  );
}

// ============= AUTOCOMPLETE HISTORY HELPERS =============

export interface AutocompleteEntry {
  id: string; // compound key: `${field_type}::${value}`
  field_type: string;
  value: string;
  usage_count: number;
  last_used_at: string;
  synced: boolean;
}

/**
 * Get all autocomplete entries for a given field type, sorted by usage_count desc.
 */
export async function getAutocompleteHistory(fieldType: string): Promise<AutocompleteEntry[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const all = await db.getAllFromIndex('autocomplete_history', 'by-field-type', fieldType);
      return all.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
    },
    [],
    'getAutocompleteHistory'
  );
}

/**
 * Put (create or update) an autocomplete entry in IndexedDB.
 */
export async function putAutocompleteEntry(entry: AutocompleteEntry): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.put('autocomplete_history', entry);
    },
    undefined,
    'putAutocompleteEntry'
  );
}

/**
 * Delete an autocomplete entry from IndexedDB by its compound key.
 */
export async function deleteAutocompleteEntry(id: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('autocomplete_history', id);
    },
    undefined,
    'deleteAutocompleteEntry'
  );
}

/**
 * Get all unsynced autocomplete entries (for background push to server).
 */
export async function getUnsyncedAutocompleteEntries(): Promise<AutocompleteEntry[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      // synced index stores boolean; false = unsynced
      return await db.getAllFromIndex('autocomplete_history', 'by-synced', 0 as any);
    },
    [],
    'getUnsyncedAutocompleteEntries'
  );
}

/**
 * Bulk-put multiple autocomplete entries (used during server→local merge).
 */
export async function bulkPutAutocompleteEntries(entries: AutocompleteEntry[]): Promise<void> {
  if (entries.length === 0) return;
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('autocomplete_history', 'readwrite');
      await Promise.all(entries.map(e => tx.store.put(e)));
      await tx.done;
    },
    undefined,
    'bulkPutAutocompleteEntries'
  );
}
