import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { checkStorageQuota, requestPersistentStorage, isMobile } from './mobile-detection';
import { isUpdatedAheadOfSync } from './local-data-guards';
import { safeSetItem } from './safe-local-storage';

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
      // IDB cannot index booleans — must be 0 | 1 for the by-uploaded index.
      uploaded: 0 | 1;
      photoUrl?: string;
      cachedAt?: number; // Timestamp when photo was cached from remote
      uploadedAt?: number; // M6: Timestamp when photo's upload to server was confirmed
      lastValidated?: number; // Last time cache was validated
      display_order?: number; // Order for drag-and-drop reordering
      tableName?: string; // DB table for sync (e.g. 'training_photos')
      storageBucket?: string; // Storage bucket (e.g. 'training-photos')
      foreignKeyColumn?: string; // FK column (e.g. 'training_id')
      caption?: string; // Photo caption for gallery labeling
      retryCount?: number; // Failed upload retry counter
      lastError?: string | null; // S22: Human-readable last upload error
      lastErrorAt?: number | null; // S22: epoch ms when lastError was stamped
      capturedByUserId?: string | null; // S23: User-id active when this photo was staged
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
  equipment_type_cache: {
    key: string; // compound: `${category}::${label}`
    value: {
      id: string;
      equipment_category: string;
      label: string;
      display_order: number;
      is_active: boolean;
      synced: boolean;
    };
    indexes: { 'by-category': string };
  };
  /**
   * 1.C — Persistent dead-letter store for photos that crossed the upload
   * retry threshold. Keyed by photo id. Surfaced in SyncDiagnosticsSheet
   * (and consumable by an admin panel) so failures are never silent orphans.
   */
  photo_upload_failures: {
    key: string;
    value: {
      id: string;            // photo id (matches `photos` keyPath)
      inspectionId: string;
      fileName: string;
      photoUrl?: string;
      section?: string;
      retryCount: number;
      lastError: string;
      lastErrorAt: number;
      firstFailedAt: number;
      capturedByUserId?: string | null;
    };
    indexes: { 'by-failed-at': number };
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
const BASE_CIRCUIT_BREAKER_RESET_TIME = 60000; // 1 minute base cooldown
const MAX_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minute max cooldown
let circuitBreakerTrippedAt: number | null = null;
let circuitBreakerResetCount = 0; // Tracks consecutive trips for exponential backoff
let circuitBreakerProbing = false; // Prevents concurrent probe attempts

/**
 * Calculate current circuit breaker reset time with exponential backoff
 */
function getCircuitBreakerResetTime(): number {
  return Math.min(
    BASE_CIRCUIT_BREAKER_RESET_TIME * Math.pow(2, circuitBreakerResetCount),
    MAX_CIRCUIT_BREAKER_RESET_TIME
  );
}

/**
 * Run a lightweight IndexedDB probe to verify the connection is actually healthy
 * before re-enabling operations after a circuit breaker cooldown.
 */
async function probeIndexedDB(): Promise<boolean> {
  if (circuitBreakerProbing) return false;
  circuitBreakerProbing = true;
  try {
    const { data: db } = await withIDBTimeout(
      'probeIndexedDB:open',
      'light',
      () => openDB('rope-works-inspections', undefined),
      null as any
    );
    if (!db) return false;
    // Lightweight count query to verify the connection is live
    const { data: count, timedOut } = await withIDBTimeout(
      'probeIndexedDB:count(inspections)',
      'light',
      () => db.count('inspections'),
      null as number | null
    );
    db.close();
    return !timedOut && count !== null;
  } catch {
    return false;
  } finally {
    circuitBreakerProbing = false;
  }
}

/**
 * Check if circuit breaker is open (IndexedDB disabled temporarily)
 */
function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerTrippedAt) {
    const resetTime = getCircuitBreakerResetTime();
    if (Date.now() - circuitBreakerTrippedAt > resetTime) {
      // Cooldown expired — but don't reset yet. The probe will confirm health.
      // For synchronous callers, return false to allow a single operation attempt.
      // The probe runs asynchronously via scheduleCircuitBreakerProbe.
      circuitBreakerTrippedAt = null;
      indexedDBFailureCount = 0;
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Circuit breaker cooldown expired (${resetTime / 1000}s, attempt #${circuitBreakerResetCount + 1}) - probing...`);
      }
      // Schedule async probe — if it fails, the next operation timeout will re-trip
      scheduleCircuitBreakerProbe();
      return false;
    }
    return true; // Circuit is still open
  }
  return false;
}

/**
 * Schedule an async probe after circuit breaker cooldown expires.
 * If probe fails, re-trip with incremented backoff.
 */
function scheduleCircuitBreakerProbe(): void {
  probeIndexedDB().then((healthy) => {
    if (healthy) {
      // Connection recovered — reset backoff counter
      circuitBreakerResetCount = 0;
      dbPromise = null; // Force fresh connection for real operations
      dbConnectionVerified = false;
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Circuit breaker probe succeeded - fully re-enabled');
      }
    } else {
      // Still broken — re-trip with higher backoff
      circuitBreakerResetCount++;
      recordIndexedDBFailure();
      recordIndexedDBFailure();
      recordIndexedDBFailure(); // Trip immediately
      const nextResetTime = getCircuitBreakerResetTime();
      console.warn(`[Offline Storage] Circuit breaker probe failed - re-tripping with ${nextResetTime / 1000}s backoff`);
    }
  });
}

/**
 * Record an IndexedDB failure for circuit breaker
 */
function recordIndexedDBFailure(): void {
  indexedDBFailureCount++;
  if (indexedDBFailureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerTrippedAt = Date.now();
    const resetTime = getCircuitBreakerResetTime();
    console.warn(`[Offline Storage] Circuit breaker tripped - IndexedDB disabled for ${resetTime / 1000}s after ${indexedDBFailureCount} failures (backoff #${circuitBreakerResetCount})`);
  }
}

/**
 * Record an IndexedDB success - resets failure counter AND backoff
 */
function recordIndexedDBSuccess(): void {
  if (indexedDBFailureCount > 0) {
    indexedDBFailureCount = 0;
    circuitBreakerTrippedAt = null;
    circuitBreakerResetCount = 0; // Full recovery — reset backoff
  }
}

/**
 * Get circuit breaker status (for debugging/UI)
 */
export function getCircuitBreakerStatus(): { open: boolean; failureCount: number; resetIn: number | null; backoffLevel: number; fallbackActive: boolean } {
  const open = isCircuitBreakerOpen();
  const resetTime = getCircuitBreakerResetTime();
  return {
    open,
    failureCount: indexedDBFailureCount,
    resetIn: circuitBreakerTrippedAt 
      ? Math.max(0, resetTime - (Date.now() - circuitBreakerTrippedAt))
      : null,
    backoffLevel: circuitBreakerResetCount,
    fallbackActive: open && isLocalStorageAvailable(),
  };
}

/**
 * Manually reset the circuit breaker so that user-initiated force sync
 * can proceed even after repeated failures.
 */
export function resetCircuitBreaker(): void {
  indexedDBFailureCount = 0;
  circuitBreakerTrippedAt = null;
  circuitBreakerResetCount = 0;
  dbPromise = null; // Force fresh connection
  dbConnectionVerified = false;
  console.log('[Offline Storage] Circuit breaker manually reset');
}

/**
 * Quick check if localStorage is functional (used to determine fallback status)
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__ls_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}
// ============= END CIRCUIT BREAKER =============

/**
 * Timeout limits by operation weight — prevents false empties on slow devices
 */
export const IDB_TIMEOUTS = {
  /** Single-key or small metadata reads */
  light: 5_000,
  /** Batch child-section reads (related data, training items, assessments) */
  batch: 10_000,
  /** Multi-store transactions or full-table scans */
  heavy: 15_000,
  /** Write operations (puts, deletes) */
  write: 8_000,
} as const;
export type TimeoutTier = keyof typeof IDB_TIMEOUTS;

/**
 * Wraps an IDB operation with a per-tier timeout.
 * Returns { data, timedOut } so callers can distinguish
 * real empties from timeout fallbacks.
 */
export async function withIDBTimeout<T>(
  operationName: string,
  tier: TimeoutTier,
  fn: () => Promise<T>,
  fallback: T
): Promise<{ data: T; timedOut: boolean }> {
  const ms = IDB_TIMEOUTS[tier];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[IDB] ${operationName} timed out after ${ms}ms (tier: ${tier})`));
    }, ms);
  });
  try {
    const data = await Promise.race([fn(), timeout]);
    return { data, timedOut: false };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.includes('timed out');
    console.warn(
      `[IDB] ${operationName} ${isTimeout ? 'timed out' : 'failed'}: ${err instanceof Error ? err.message : err}`
    );
    return { data: fallback, timedOut: isTimeout };
  } finally {
    clearTimeout(timer);
  }
}

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
        safeSetItem('storage-eviction-warned', 'true', { scope: 'offline-storage.evictionWarned' });
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

/**
 * Gap 2.2 dead-letter ring buffer (sessionStorage).
 * IDB has already failed when this is invoked, so we cannot persist to IDB.
 * sessionStorage survives the current tab session and lets diagnostics surface
 * "N records could not be saved this session." Cap at 20 entries (FIFO eviction).
 */
export type EmergencyFallbackFailure = {
  code: 'localstorage_quota' | 'localstorage_blocked' | 'localstorage_unknown';
  reportType: string;
  id: string;
  operationName: string;
  approxBytes: number;
  ts: number;
};

const EMERGENCY_FAILURE_KEY = 'rw_emergency_fallback_failures';
const EMERGENCY_FAILURE_MAX = 20;

function recordEmergencyFallbackFailure(entry: EmergencyFallbackFailure): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    let arr: EmergencyFallbackFailure[] = [];
    try {
      const raw = sessionStorage.getItem(EMERGENCY_FAILURE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      }
    } catch {
      arr = [];
    }
    arr.push(entry);
    if (arr.length > EMERGENCY_FAILURE_MAX) {
      arr = arr.slice(arr.length - EMERGENCY_FAILURE_MAX);
    }
    sessionStorage.setItem(EMERGENCY_FAILURE_KEY, JSON.stringify(arr));
  } catch {
    // sessionStorage may also be full / blocked — best-effort, never throw
  }
}

/**
 * Read accessor for diagnostics UI. Returns the in-session list of records
 * that could not be persisted to either IDB or localStorage.
 */
export function getEmergencyFallbackFailures(): EmergencyFallbackFailure[] {
  try {
    if (typeof sessionStorage === 'undefined') return [];
    const raw = sessionStorage.getItem(EMERGENCY_FAILURE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Classify a localStorage write error so we can route to the right diagnostic.
 */
function classifyLocalStorageError(
  err: unknown,
): 'localstorage_quota' | 'localstorage_blocked' | 'localstorage_unknown' {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: number };
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      return 'localstorage_quota';
    }
    if (e.name === 'SecurityError') {
      return 'localstorage_blocked';
    }
  }
  return 'localstorage_unknown';
}

/**
 * Emergency localStorage fallback for write operations when circuit breaker is open.
 * Attempts to persist critical report data via the backup ledger so it isn't lost.
 *
 * Gap 2.2: when this returns false the caller (`withIndexedDBSaveBoundary`) throws
 * `IdbSaveError('storage_unavailable')` so the form auto-save UI surfaces the
 * persistent "Save failed" state. We additionally classify + log the failure and
 * record it to a sessionStorage ring buffer for later diagnostics.
 */
function emergencyLocalStorageFallback(operationName: string, data: any): boolean {
  // Only attempt for report-level saves that carry meaningful data
  if (!data || typeof data !== 'object') return false;
  const id = data.id;
  if (!id || typeof id !== 'string') return false;

  let reportType: 'inspection' | 'training' | 'daily_assessment' | null = null;
  const opLower = operationName.toLowerCase();
  if (opLower.includes('inspection')) reportType = 'inspection';
  else if (opLower.includes('training')) reportType = 'training';
  else if (opLower.includes('assessment') || opLower.includes('daily')) reportType = 'daily_assessment';

  if (!reportType) return false;

  // Build snapshot up-front so `json.length` is available in the failure path
  const key = `rw_backup_${reportType}_${id}`;
  let json = '';
  try {
    const snapshot = {
      v: 1,
      ts: Date.now(),
      synced: false,
      device: isMobile() ? 'mobile' : 'desktop',
      parent: data,
      children: {},
    };
    json = JSON.stringify(snapshot);
    localStorage.setItem(key, json);
    console.warn(
      `[Offline Storage] Emergency localStorage save for ${reportType} ${id.substring(0, 8)} (${(json.length / 1024).toFixed(1)}KB)`,
    );
    return true;
  } catch (err: unknown) {
    const code = classifyLocalStorageError(err);
    const approxBytes = json.length;

    // Operational signal — always logged, not gated by debug flag
    console.error('[Offline Storage] Emergency localStorage fallback FAILED', {
      code,
      reportType,
      id: id.substring(0, 8),
      op: operationName,
      bytes: approxBytes,
      error: err,
    });

    // Forward to centralized error logger → audit_logs.client.error (best-effort)
    try {
      void import('./log-error').then(({ logError }) => {
        try {
          logError(err, {
            scope: 'emergency-localstorage-fallback',
            extra: {
              code,
              reportType,
              id: id.substring(0, 8),
              operationName,
              approxBytes,
            },
          });
        } catch {
          /* swallow */
        }
      });
    } catch {
      /* dynamic import failure — never throw out of fallback */
    }

    // Persist to sessionStorage ring buffer for SyncDiagnosticsSheet
    recordEmergencyFallbackFailure({
      code,
      reportType,
      id,
      operationName,
      approxBytes,
      ts: Date.now(),
    });

    // Best-effort user-visible notification (dynamic import — never throws)
    try {
      void import('./notification-center').then(({ addSyncNotification }) => {
        try {
          const failures = getEmergencyFallbackFailures();
          addSyncNotification(
            `Storage is full — ${failures.length} record(s) could NOT be saved. Free space immediately.`,
          );
        } catch {
          /* swallow */
        }
      });
    } catch {
      /* swallow */
    }

    return false;
  }
}

// Track if DB has been successfully opened (skip health check after first success)
let dbConnectionVerified = false;

// ============================================================================
// S11: Tagged IDB read failure sentinel.
// The default `withIndexedDBErrorBoundary` returns `fallbackValue` on failure,
// which makes "read failed" indistinguishable from "no rows" at every call
// site (the unsynced badge silently reads 0 when IDB is unhealthy).
// `withIndexedDBReadBoundary` is a parallel helper used by the few read paths
// that gate user-visible sync state (unsynced inspections / trainings /
// assessments / unuploaded photos). It returns a tagged failure object that
// callers MUST inspect via `isIdbReadFailure` so the badge keeps the
// last-known count and the existing `syncError` UI lights up instead.
// ============================================================================
export const IDB_READ_FAILED = Symbol.for('rw.idb-read-failed');
export type IdbReadFailure = {
  __idbReadFailed: typeof IDB_READ_FAILED;
  error: string;
  context: string;
};

export function isIdbReadFailure(v: unknown): v is IdbReadFailure {
  return !!v && typeof v === 'object' && (v as any).__idbReadFailed === IDB_READ_FAILED;
}

function makeIdbReadFailure(context: string, error: unknown): IdbReadFailure {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown');
  return { __idbReadFailed: IDB_READ_FAILED, error: message, context };
}

/**
 * Strict read boundary for sync-gating reads. Unlike `withIndexedDBErrorBoundary`
 * (which silently swallows errors and returns `fallbackValue`), this returns
 * `IdbReadFailure` so the caller can preserve last-known state and surface
 * a real error to the user.
 *
 * Mirrors the same circuit-breaker / timeout / health-check semantics as the
 * silent boundary so sync paths don't regress on resilience.
 */
async function withIndexedDBReadBoundary<T>(
  operation: () => Promise<T>,
  operationName: string,
): Promise<T | IdbReadFailure> {
  if (isCircuitBreakerOpen()) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Circuit breaker open, returning IdbReadFailure for ${operationName}`);
    }
    return makeIdbReadFailure(operationName, 'circuit_breaker_open');
  }

  const opLowerForTier = operationName.toLowerCase();
  let OPERATION_TIMEOUT: number;
  if (opLowerForTier.includes('photo')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write;
  } else if (
    opLowerForTier.includes('batch') ||
    opLowerForTier.includes('related') ||
    opLowerForTier.includes('training') ||
    opLowerForTier.includes('assessment') ||
    opLowerForTier.includes('getall') ||
    opLowerForTier.includes('unsynced')
  ) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.batch;
  } else {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.light;
  }
  const TIMEOUT_SENTINEL = Symbol('timeout');

  try {
    const result = await withTimeout(
      (async () => {
        if (!dbConnectionVerified) {
          const isHealthy = await checkIndexedDBHealth();
          if (!isHealthy) {
            throw new Error('idb_unhealthy');
          }
          dbConnectionVerified = true;
        }
        return await operation();
      })(),
      OPERATION_TIMEOUT,
      TIMEOUT_SENTINEL as any,
    );

    if (result === TIMEOUT_SENTINEL) {
      console.warn(`[Offline Storage] Read timeout for ${operationName}, resetting DB connection`);
      dbConnectionVerified = false;
      recordIndexedDBFailure();
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
      return makeIdbReadFailure(operationName, 'idb_read_timeout');
    }

    recordIndexedDBSuccess();
    return result as T;
  } catch (err) {
    console.error(`[Offline Storage] Read failed for ${operationName}:`, err);
    recordIndexedDBFailure();
    return makeIdbReadFailure(operationName, err);
  }
}

/**
 * Wrapper for IndexedDB operations with error boundary, timeout protection, and circuit breaker
 * Prevents any single IndexedDB operation from blocking the app
 * OPTIMIZED: Skips redundant health checks after first successful DB connection
 * CIRCUIT BREAKER: Fails fast after repeated failures
 */
// ============================================================================
// Gap 2.1: Strict save boundary that THROWS on failure.
// `withIndexedDBErrorBoundary` swallows errors and returns `fallbackValue`,
// which makes save-failures look like successes to the caller — the form
// clears its dirty flag and the user navigates away losing data.
//
// `withIndexedDBSaveBoundary` is a parallel wrapper used by the three
// user-facing report saves (saveInspectionOffline / saveTrainingOffline /
// saveDailyAssessmentOffline). On failure it throws an `IdbSaveError` so
// callers can KEEP the dirty flag, SKIP appendVersion(), and surface the
// failure persistently in the AutoSaveIndicator.
//
// Returns `{ savedToBackup: true }` when the circuit breaker is open and the
// emergency localStorage fallback succeeds (caller knows the row is in
// localStorage, not IDB, but data is safe).
// ============================================================================
export type IdbSaveErrorCode =
  | 'idb_unhealthy'
  | 'timeout'
  | 'quota_exceeded'
  | 'storage_unavailable'
  | 'unknown';

export class IdbSaveError extends Error {
  readonly code: IdbSaveErrorCode;
  readonly operationName: string;
  readonly cause?: unknown;
  constructor(code: IdbSaveErrorCode, operationName: string, cause?: unknown) {
    super(`[${operationName}] save failed: ${code}`);
    this.name = 'IdbSaveError';
    this.code = code;
    this.operationName = operationName;
    this.cause = cause;
  }
}

export function isIdbSaveError(e: unknown): e is IdbSaveError {
  return e instanceof IdbSaveError || (
    !!e && typeof e === 'object' && (e as any).name === 'IdbSaveError' && typeof (e as any).code === 'string'
  );
}

export type SaveResult = { savedToBackup: boolean };

async function withIndexedDBSaveBoundary(
  operation: () => Promise<void>,
  operationName: string,
  parentDataForFallback?: any,
): Promise<SaveResult> {
  // Circuit breaker open — try emergency localStorage write
  if (isCircuitBreakerOpen()) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Circuit breaker open, attempting localStorage fallback for ${operationName}`);
    }
    const fallbackSucceeded = parentDataForFallback
      ? emergencyLocalStorageFallback(operationName, parentDataForFallback)
      : false;

    // Show toast once per session like the silent boundary
    try {
      const cbWarningKey = 'circuit-breaker-warning-shown';
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(cbWarningKey)) {
        sessionStorage.setItem(cbWarningKey, 'true');
        import('@/hooks/use-toast').then(({ toast }) => {
          if (fallbackSucceeded) {
            toast({
              title: 'Using backup storage',
              description: "Your changes are saved locally. They'll sync when storage recovers.",
            });
          } else {
            toast({
              title: 'Storage unavailable',
              description: 'Your changes are NOT saved. Stay on this page until storage recovers.',
              variant: 'destructive',
            });
          }
        }).catch(() => {});
        const resetTime = getCircuitBreakerResetTime();
        setTimeout(() => sessionStorage.removeItem(cbWarningKey), resetTime + 1000);
      }
    } catch { /* ignore */ }

    if (fallbackSucceeded) return { savedToBackup: true };
    throw new IdbSaveError('storage_unavailable', operationName);
  }

  // Pick timeout tier (mirror silent boundary)
  const opLowerForTier = operationName.toLowerCase();
  let OPERATION_TIMEOUT: number;
  if (opLowerForTier.includes('photo')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write;
  } else if (
    opLowerForTier.includes('batch') ||
    opLowerForTier.includes('related') ||
    opLowerForTier.includes('training') ||
    opLowerForTier.includes('assessment') ||
    opLowerForTier.includes('getall') ||
    opLowerForTier.includes('unsynced')
  ) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.batch;
  } else if (opLowerForTier.includes('save') || opLowerForTier.includes('delete') || opLowerForTier.includes('put')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write;
  } else {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.light;
  }
  const TIMEOUT_SENTINEL = Symbol('timeout');

  try {
    const result = await withTimeout(
      (async () => {
        if (!dbConnectionVerified) {
          const isHealthy = await checkIndexedDBHealth();
          if (!isHealthy) {
            throw new IdbSaveError('idb_unhealthy', operationName);
          }
          dbConnectionVerified = true;
        }
        await operation();
        return 'ok' as const;
      })(),
      OPERATION_TIMEOUT,
      TIMEOUT_SENTINEL as any,
    );

    if (result === TIMEOUT_SENTINEL) {
      console.warn(`[Offline Storage] Save timeout for ${operationName}, resetting DB connection`);
      dbConnectionVerified = false;
      recordIndexedDBFailure();
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
      throw new IdbSaveError('timeout', operationName);
    }

    recordIndexedDBSuccess();
    return { savedToBackup: false };
  } catch (error: any) {
    if (isIdbSaveError(error)) {
      // Already-tagged failures (idb_unhealthy / timeout) — re-throw as-is
      if (error.code === 'idb_unhealthy') recordIndexedDBFailure();
      throw error;
    }

    console.error(`[Offline Storage] Save error in ${operationName}:`, error);
    dbConnectionVerified = false;

    const isQuotaError = error?.name === 'QuotaExceededError' || error?.message?.includes('QuotaExceeded');
    if (!isQuotaError) {
      recordIndexedDBFailure();
    }

    if (isQuotaError && typeof window !== 'undefined') {
      import('@/hooks/use-toast').then(({ toast }) => {
        toast({
          title: 'Storage full',
          description: 'Device storage is full. Please sync your data and clear old reports.',
          variant: 'destructive',
        });
      }).catch(() => {});
      throw new IdbSaveError('quota_exceeded', operationName, error);
    }

    throw new IdbSaveError('unknown', operationName, error);
  }
}

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
    const opLower = operationName.toLowerCase();
    const isWriteOp = opLower.includes('save') || opLower.includes('put') || 
                      opLower.includes('delete') || opLower.includes('queue') || 
                      opLower.includes('update');
    
    // Classify: is this a user-facing report save or a background operation?
    const isUserFacingSave = ['saveinspectionoffline', 'savetrainingoffline', 'savedailyassessmentoffline']
      .some(op => opLower.includes(op.toLowerCase()));

    if (isWriteOp && typeof window !== 'undefined') {
      // Attempt emergency localStorage save for all write ops
      const fallbackSucceeded = emergencyLocalStorageFallback(operationName, fallbackValue);

      // Only show toasts for user-facing saves (not background ops like photo marking)
      if (isUserFacingSave) {
        const cbWarningKey = 'circuit-breaker-warning-shown';
        if (!sessionStorage.getItem(cbWarningKey)) {
          sessionStorage.setItem(cbWarningKey, 'true');
          import('@/hooks/use-toast').then(({ toast }) => {
            if (fallbackSucceeded) {
              // Soft toast — data IS saved to localStorage backup
              toast({
                title: "Using backup storage",
                description: "Your changes are saved locally. They'll sync when storage recovers.",
              });
            } else {
              // Red toast — both IndexedDB and localStorage failed
              toast({
                title: "Storage temporarily unavailable",
                description: "Your changes may not be saved locally. Stay connected to sync your work.",
                variant: "destructive",
              });
            }
          }).catch(() => {});
          const resetTime = getCircuitBreakerResetTime();
          setTimeout(() => sessionStorage.removeItem(cbWarningKey), resetTime + 1000);
        }
      }
    }
    return fallbackValue;
  }

  const opLowerForTier = operationName.toLowerCase();
  let OPERATION_TIMEOUT: number;
  if (opLowerForTier.includes('photo')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write; // photo blob writes
  } else if (
    opLowerForTier.includes('batch') ||
    opLowerForTier.includes('related') ||
    opLowerForTier.includes('training') ||
    opLowerForTier.includes('assessment') ||
    opLowerForTier.includes('getall') ||
    opLowerForTier.includes('unsynced')
  ) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.batch;
  } else if (opLowerForTier.includes('save') || opLowerForTier.includes('delete') || opLowerForTier.includes('put')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write;
  } else {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.light;
  }
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
      console.warn(`[Offline Storage] Timeout detected for ${operationName}, resetting DB connection`);
      dbConnectionVerified = false;
      recordIndexedDBFailure();
      // Close and discard the stale connection so the next operation opens a fresh one
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
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
    const DB_VERSION = 17;

    // Phase 5 — Schema Migration Safety. Lazy-load to avoid circular imports
    // and to keep the boot path resilient if this module ever fails to parse.
    let migrationSafety: typeof import('./idb-migration-safety') | null = null;
    try {
      migrationSafety = await import('./idb-migration-safety');
    } catch (err) {
      console.warn('[Offline Storage] migration-safety unavailable:', err);
    }

    let upgradeStartTs = 0;
    let upgradeFromVersion = 0;
    let upgradeError: string | undefined;
    let snapshotCreated = false;

    const openDBV8WithTimeout = async () => {
      return openDB<InspectionDB>(DB_NAME, DB_VERSION, {
        async blocked(currentVersion, blockedVersion) {
          console.warn(
            `[Offline Storage] DB upgrade blocked: open at v${currentVersion}, want v${blockedVersion}. ` +
            `Asking Service Worker to release its connection.`
          );
          // Ask the SW to close any IDB handles it's holding so the upgrade can proceed.
          try {
            if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
              const reg = await navigator.serviceWorker.ready;
              reg.active?.postMessage({
                type: 'CLOSE_IDB_FOR_UPGRADE',
                dbName: DB_NAME,
                targetVersion: blockedVersion,
              });
            }
          } catch (err) {
            console.warn('[Offline Storage] Could not notify SW about upgrade:', err);
          }
          // Best-effort user notification — only fires if the upgrade is actually slow.
          // Defer 1500ms so the common case (fast SW close + auto-retry) stays silent.
          setTimeout(() => {
            if (dbPromise) {
              try {
                void import('./notification-center').then(({ addSyncNotification }) => {
                  try {
                    addSyncNotification(
                      'Database upgrade pending — close other tabs of this app to complete the upgrade.'
                    );
                  } catch { /* swallow */ }
                }).catch(() => {});
              } catch { /* swallow */ }
            }
          }, 1500);
        },
        async blocking(currentVersion, blockedVersion, event) {
          console.warn(
            `[Offline Storage] This tab is blocking DB upgrade: holding v${currentVersion}, ` +
            `another context wants v${blockedVersion}. Closing connection.`
          );
          try {
            // Close our handle so the other context can upgrade.
            (event.target as IDBDatabase | null)?.close?.();
            // Invalidate the cached promise so the next getDB() call reopens at the new version.
            dbPromise = null;
          } catch (err) {
            console.warn('[Offline Storage] Failed to close blocking connection:', err);
          }
        },
        upgrade(db, oldVersion, newVersion, transaction) {
          upgradeStartTs = Date.now();
          upgradeFromVersion = oldVersion;
          if (import.meta.env.DEV) {
            console.log(`[Offline Storage] Upgrade v${oldVersion} → v${newVersion}`);
          }
          // Best-effort audit (fire-and-forget; we cannot await inside upgrade).
          try {
            migrationSafety?.recordMigrationStarted(DB_NAME, oldVersion, newVersion ?? DB_VERSION);
          } catch { /* ignore */ }
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
          // === NEW in v10: equipment_type_cache store ===
          if (!db.objectStoreNames.contains('equipment_type_cache')) {
            const etStore = db.createObjectStore('equipment_type_cache', { keyPath: 'id' });
            etStore.createIndex('by-category', 'equipment_category');
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created equipment_type_cache store (v10 upgrade)');
            }
          }
          // === NEW in v11: sync_regression_counters store (S10) ===
          // Persists field-count regression skip counters across reloads so the
          // guard's "after MAX_REGRESSION_SKIPS, allow sync" release isn't lost
          // when a user happens to refresh between sync cycles.
          if (!db.objectStoreNames.contains('sync_regression_counters' as any)) {
            (db as any).createObjectStore('sync_regression_counters', { keyPath: 'id' });
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created sync_regression_counters store (v11 upgrade)');
            }
          }
          // === NEW in v12: dead_letter_soft_deletes store (S28) ===
          // Holds soft-delete queue ops that exhausted MAX_SOFT_DELETE_ATTEMPTS.
          // Operator-visible only — never auto-retried.
          if (!db.objectStoreNames.contains('dead_letter_soft_deletes' as any)) {
            (db as any).createObjectStore('dead_letter_soft_deletes', { keyPath: 'id' });
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created dead_letter_soft_deletes store (v12 upgrade)');
            }
          }
          // === NEW in v13: sync_empty_local_conflicts store (C2) ===
          // Holds parent records where the empty-local-guard tripped — server has
          // child data but local cache is empty and the user_cleared_at marker
          // wasn't stamped. Surfaced in SyncDiagnosticsSheet for user resolution
          // instead of silently restoring server data.
          if (!db.objectStoreNames.contains('sync_empty_local_conflicts' as any)) {
            (db as any).createObjectStore('sync_empty_local_conflicts', { keyPath: 'id' });
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created sync_empty_local_conflicts store (v13 upgrade)');
            }
          }
          // === NEW in v14: admin_edit_snapshot_queue store (H10) ===
          // Queues admin pre-edit snapshot intents captured while offline so they
          // can be uploaded to admin_edit_snapshots on the next online cycle —
          // before the admin's edit itself syncs to the server.
          if (!db.objectStoreNames.contains('admin_edit_snapshot_queue' as any)) {
            const aeqStore = (db as any).createObjectStore('admin_edit_snapshot_queue', {
              keyPath: 'id',
              autoIncrement: true,
            });
            aeqStore.createIndex('by-report', ['reportType', 'reportId']);
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created admin_edit_snapshot_queue store (v14 upgrade)');
            }
          }
          // === NEW in v15: photo_upload_failures store (1.C) ===
          // Persistent dead-letter for photos that crossed MAX_PHOTO_RETRIES.
          // Surfaces in SyncDiagnosticsSheet so failures aren't silent orphans.
          if (!db.objectStoreNames.contains('photo_upload_failures' as any)) {
            const pufStore = (db as any).createObjectStore('photo_upload_failures', {
              keyPath: 'id',
            });
            pufStore.createIndex('by-failed-at', 'lastErrorAt');
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created photo_upload_failures store (v15 upgrade)');
            }
          }
          // === NEW in v16: coerce photos.uploaded boolean → 0|1 ===
          // IndexedDB silently drops boolean values from indexes, so the
          // by-uploaded index returned no results. Rewrite legacy rows so
          // the index actually keys them. Safe to re-run (idempotent).
          if (oldVersion < 16 && db.objectStoreNames.contains('photos')) {
            try {
              // Use the raw IDBObjectStore so we can drive the cursor with
              // native onsuccess callbacks inside the upgrade transaction.
              const photoStore = (transaction as any).objectStore('photos') as IDBObjectStore;
              const cursorReq = photoStore.openCursor();
              cursorReq.onsuccess = (ev: any) => {
                const cursor: IDBCursorWithValue | null = ev.target.result;
                if (!cursor) return;
                const v = cursor.value;
                if (typeof v.uploaded === 'boolean') {
                  v.uploaded = v.uploaded ? 1 : 0;
                  cursor.update(v);
                }
                cursor.continue();
              };
              if (import.meta.env.DEV) {
                console.log('[Offline Storage] Rewriting photos.uploaded boolean → 0|1 (v16 upgrade)');
              }
            } catch (err) {
              console.warn('[Offline Storage] v16 photos.uploaded coercion failed:', err);
            }
          }

          // === NEW in v17: backfill `dirty` flag on inspections / trainings / daily_assessments ===
          // C3: a per-record `dirty` boolean is the authoritative "user has
          // unshipped edits" signal. Drift-vs-tolerance becomes a secondary
          // belt-and-braces check. For legacy rows we conservatively backfill:
          //   - any row without `synced_at` ⇒ dirty (never uploaded)
          //   - any row with updated_at meaningfully ahead of synced_at ⇒ dirty
          //   - everything else ⇒ not dirty
          // Idempotent — re-running just re-confirms the same flag.
          if (oldVersion < 17) {
            const SYNC_DRIFT_TOLERANCE_MS = 30_000; // mirror src/lib/local-data-guards.ts
            const backfillDirty = (storeName: 'inspections' | 'trainings' | 'daily_assessments') => {
              if (!db.objectStoreNames.contains(storeName)) return;
              try {
                const store = (transaction as any).objectStore(storeName) as IDBObjectStore;
                const cursorReq = store.openCursor();
                cursorReq.onsuccess = (ev: any) => {
                  const cursor: IDBCursorWithValue | null = ev.target.result;
                  if (!cursor) return;
                  const v = cursor.value;
                  if (typeof v.dirty !== 'boolean') {
                    let dirty = false;
                    if (!v.synced_at) {
                      dirty = true;
                    } else if (v.updated_at) {
                      const u = new Date(v.updated_at).getTime();
                      const s = new Date(v.synced_at).getTime();
                      if (Number.isFinite(u) && Number.isFinite(s) && u - s > SYNC_DRIFT_TOLERANCE_MS) {
                        dirty = true;
                      }
                    }
                    v.dirty = dirty;
                    cursor.update(v);
                  }
                  cursor.continue();
                };
                if (import.meta.env.DEV) {
                  console.log(`[Offline Storage] Backfilling dirty flag on ${storeName} (v17 upgrade)`);
                }
              } catch (err) {
                console.warn(`[Offline Storage] v17 dirty backfill failed for ${storeName}:`, err);
              }
            };
            backfillDirty('inspections');
            backfillDirty('trainings');
            backfillDirty('daily_assessments');
          }
        },
      });
    };

    // Phase 5 — pre-flight snapshot when an actual version bump is coming.
    // We detect the existing version by opening with no upgrade hook first.
    try {
      if (migrationSafety) {
        let existingVersion = 0;
        try {
          const probe = await openDB(DB_NAME);
          existingVersion = probe.version;
          probe.close();
        } catch { /* fresh install */ }
        if (existingVersion > 0 && existingVersion < DB_VERSION) {
          const snap = await migrationSafety.createPreMigrationSnapshot(DB_NAME, existingVersion, DB_VERSION);
          snapshotCreated = !!snap.ok;
        }
        // Always prune old snapshots to keep storage bounded.
        migrationSafety.pruneOldSnapshots().catch(() => {});
      }
    } catch (err) {
      console.warn('[Offline Storage] pre-migration snapshot failed:', err);
    }

    // RC-3: Use 8s timeout on mobile (Safari bfcache restore + iPad cold boot can take 5-6s)
    const DB_OPEN_TIMEOUT = isMobile() ? 8000 : 5000;
    dbPromise = Promise.race([
      openDBV8WithTimeout(),
      new Promise<never>((_, reject) => 
        setTimeout(() => {
          console.warn(`[Offline Storage] IndexedDB open timed out after ${DB_OPEN_TIMEOUT / 1000}s`);
          reject(new Error('IndexedDB open timed out'));
        }, DB_OPEN_TIMEOUT)
      )
    ]).then(async (db) => {
      // Phase 5 — post-upgrade fingerprint validation.
      if (upgradeStartTs > 0 && migrationSafety) {
        try {
          const expected = [
            { storeName: 'inspections', indexes: ['by-status', 'by-synced'] },
            { storeName: 'operations' },
            { storeName: 'photos', indexes: ['by-inspection', 'by-uploaded'] },
            { storeName: 'inspection_systems', indexes: ['by-inspection'] },
            { storeName: 'inspection_ziplines', indexes: ['by-inspection'] },
            { storeName: 'inspection_equipment', indexes: ['by-inspection'] },
            { storeName: 'inspection_standards', indexes: ['by-inspection'] },
            { storeName: 'inspection_summary', indexes: ['by-inspection'] },
            { storeName: 'daily_assessments', indexes: ['by-status', 'by-synced'] },
            { storeName: 'trainings', indexes: ['by-status', 'by-synced'] },
            { storeName: 'report_backups', indexes: ['by-report', 'by-timestamp'] },
            { storeName: 'report_versions', indexes: ['by-report', 'by-timestamp', 'by-report-version'] },
            { storeName: 'autocomplete_history', indexes: ['by-field-type', 'by-synced'] },
            { storeName: 'equipment_type_cache', indexes: ['by-category'] },
            { storeName: 'dead_letter_soft_deletes' },
          ];
          const fp = await migrationSafety.validateSchemaFingerprint(db as any, expected);
          await migrationSafety.recordMigrationOutcome({
            dbName: DB_NAME,
            fromVersion: upgradeFromVersion,
            toVersion: DB_VERSION,
            ok: true,
            durationMs: Date.now() - upgradeStartTs,
            fingerprintMissing: fp.ok ? undefined : fp.missing,
          });
          if (!fp.ok && import.meta.env.DEV) {
            console.warn('[Offline Storage] Post-upgrade fingerprint mismatch:', fp.missing);
          }
        } catch (err) {
          console.warn('[Offline Storage] post-upgrade validation failed:', err);
        }
      }
      return db;
    }).catch(error => {
      console.error('[Offline Storage] Failed to open IndexedDB:', error);
      // Phase 5 — record the failure so the recovery UI can offer rollback.
      if (upgradeStartTs > 0 && migrationSafety) {
        upgradeError = (error as any)?.message || String(error);
        migrationSafety.recordMigrationOutcome({
          dbName: DB_NAME,
          fromVersion: upgradeFromVersion,
          toVersion: DB_VERSION,
          ok: false,
          durationMs: Date.now() - upgradeStartTs,
          error: upgradeError,
        }).catch(() => {});
      }
      if (snapshotCreated) {
        try {
          localStorage.setItem('idb-migration-rollback-available', '1');
        } catch { /* ignore */ }
      }
      dbPromise = null; // Reset so next attempt can retry
      throw error;
    });
  }
  return dbPromise;
}

// Inspection functions

/**
 * Save an inspection to IndexedDB.
 * Throws `IdbSaveError` on hard failure (Gap 2.1) — callers MUST handle rejection
 * to avoid clearing the form's dirty flag while data is unsaved.
 * Returns `{ savedToBackup: true }` if the row was written to the localStorage
 * emergency fallback instead of IDB.
 */
export async function saveInspectionOffline(
  inspection: any,
  opts?: { childCountHint?: number }
): Promise<SaveResult> {
  return withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      // S30: prefer caller-provided hint; otherwise preserve existing hint.
      if (opts?.childCountHint != null && opts.childCountHint >= 0) {
        inspection.child_count_hint = opts.childCountHint;
      }
      await db.put('inspections', inspection);
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved inspection:', inspection.id);
      }
    },
    'saveInspectionOffline',
    inspection,
  );
}

export async function getOfflineInspections(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allInspections = await db.getAll('inspections');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      // C9: Also filter out records quarantined due to remote soft-delete; they
      // remain in IDB pending user resolution via RemoteDeletedConflictDialog.
      const activeInspections = allInspections.filter(i => !i.deleted_at && !(i as any)._remote_deleted_at);
      
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
  return withIndexedDBReadBoundary(
    async () => {
      const db = await getDB();
      
      // Simple getAll() + filter — reliable across all browsers.
      // These stores typically hold <100 records so full scans are fast.
      const all = await db.getAll('inspections');
      // C9: Exclude quarantined records (remote was soft-deleted) from unsynced
      // candidates so we don't keep re-attempting to upload them.
      let unsynced = all.filter(record => !(record as any)._remote_deleted_at).filter(record => {
        if (!record.synced_at) return true; // never synced
        if (record.updated_at) {
          const drift = new Date(record.updated_at).getTime() - new Date(record.synced_at).getTime();
          const isUnsynced = isUpdatedAheadOfSync(new Date(record.updated_at).getTime(), new Date(record.synced_at).getTime());
          if (isUnsynced && import.meta.env.DEV) {
            console.log('[Offline Storage] Inspection flagged unsynced:', {
              id: String(record.id).substring(0, 8),
              localUpdated: record.updated_at,
              localSynced: record.synced_at,
              drift_ms: drift,
            });
          }
          return isUnsynced;
        }
        return false;
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
      
      // S8: registerInspectionSync removed — SW sync is disabled and the
      // main-thread useAutoSync hook is the sole consumer of queued operations.
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

export async function removeQueuedOperation(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot remove operation with undefined/null ID');
    return;
  }
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

// ============================================================
// S28 — Queued operation patch helpers + dead-letter store
// ============================================================

export interface DeadLetterSoftDelete {
  id: string;
  queueStore: 'operations' | 'assessment_operations' | 'training_operations';
  table: 'inspections' | 'trainings' | 'daily_assessments';
  recordId: string;
  attempts: number;
  firstFailedAt: string;
  lastError: string;
  deadLetteredAt: string;
  originalOp: any;
}

async function patchOpInStore(
  storeName: 'operations' | 'assessment_operations' | 'training_operations',
  id: number | undefined | null,
  patch: Record<string, any>
) {
  if (id === undefined || id === null) return;
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const op = await db.get(storeName as any, id);
      if (!op) return;
      const merged = { ...op, ...patch };
      await db.put(storeName as any, merged);
    },
    undefined,
    `patchOp:${storeName}`
  );
}

export async function updateQueuedOperation(id: number | undefined | null, patch: Record<string, any>) {
  return patchOpInStore('operations', id, patch);
}

export async function updateQueuedAssessmentOperation(id: number | undefined | null, patch: Record<string, any>) {
  return patchOpInStore('assessment_operations', id, patch);
}

export async function updateQueuedTrainingOperation(id: number | undefined | null, patch: Record<string, any>) {
  return patchOpInStore('training_operations', id, patch);
}

export async function addToDeadLetterSoftDeletes(entry: DeadLetterSoftDelete) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await (db as any).put('dead_letter_soft_deletes', entry);
      if (import.meta.env.DEV) {
        console.warn('[Offline Storage] Dead-lettered soft-delete:', entry.id, entry.lastError);
      }
    },
    undefined,
    'addToDeadLetterSoftDeletes'
  );
}

export async function getDeadLetterSoftDeletes(): Promise<DeadLetterSoftDelete[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const all = await (db as any).getAll('dead_letter_soft_deletes');
      return (all as DeadLetterSoftDelete[]).sort(
        (a, b) => new Date(b.deadLetteredAt).getTime() - new Date(a.deadLetteredAt).getTime()
      );
    },
    [],
    'getDeadLetterSoftDeletes'
  );
}

export async function removeDeadLetterSoftDelete(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await (db as any).delete('dead_letter_soft_deletes', id);
    },
    undefined,
    'removeDeadLetterSoftDelete'
  );
}


export async function savePhotoOffline(photo: {
  id: string;
  inspectionId: string;
  section: string;
  blob: Blob;
  fileName: string;
  uploaded?: 0 | 1 | boolean;
  photoUrl?: string;
  tableName?: string;
  storageBucket?: string;
  foreignKeyColumn?: string;
  caption?: string;
  capturedByUserId?: string | null; // S23
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
          // Coerce boolean → 0|1 so the by-uploaded index actually keys the row.
          uploaded: photo.uploaded ? 1 : 0,
        });
        
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Saved photo:', photo.id);
        }
        
        // S8: registerPhotoSync removed — SW background sync is disabled;
        // useAutoSync schedules photo uploads from the main thread.
        
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
        // Also normalize any photoUrl that still embeds the old temp ID
        if (photo.photoUrl && photo.photoUrl.includes(oldInspectionId)) {
          photo.photoUrl = photo.photoUrl.replace(oldInspectionId, newInspectionId);
        }
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

/**
 * Update the photoUrl for a specific photo record in IndexedDB.
 * Used by sync-manager to normalize pending/ paths.
 */
export async function updatePhotoUrl(photoId: string, newUrl: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      const photo = await tx.store.get(photoId);
      if (photo) {
        photo.photoUrl = newUrl;
        await tx.store.put(photo);
      }
      await tx.done;
    },
    undefined,
    'updatePhotoUrl'
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

/**
 * Maximum upload retry attempts for a single photo before it is considered
 * "dead-letter" (excluded from live pending counts but preserved in IDB).
 * Shared between sync-manager and count queries so they always agree.
 */
export const MAX_PHOTO_RETRIES = 5;

/**
 * Returns photos that are eligible to be counted as "pending sync".
 * Excludes:
 *  - photos with a null blob (already partially uploaded)
 *  - photos that exhausted MAX_PHOTO_RETRIES (dead-letter)
 *  - photos whose parent inspection is a temp-* id with no matching local row
 *    (orphan: the parent was deleted before sync, so they can never upload)
 */
export async function getUnuploadedPhotos(userId?: string) {
  return withIndexedDBReadBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readonly');
      const index = tx.store.index('by-uploaded');
      const unuploaded = await index.getAll(IDBKeyRange.only(0));
      await tx.done;

      const withBlob = unuploaded.filter(p => p.blob != null);
      const eligible = withBlob.filter(p => (p.retryCount || 0) < MAX_PHOTO_RETRIES);

      // Orphan check — only for temp-* parent ids
      const tempPhotos = eligible.filter(p => p.inspectionId?.startsWith('temp-'));
      const orphanIds = new Set<string>();
      if (tempPhotos.length > 0) {
        const inspTx = db.transaction('inspections', 'readonly');
        await Promise.all(
          tempPhotos.map(async (p) => {
            const parent = await inspTx.store.get(p.inspectionId);
            if (!parent) orphanIds.add(p.id);
          })
        );
        await inspTx.done;
      }
      return eligible.filter(p => !orphanIds.has(p.id));
    },
    'getUnuploadedPhotos'
  );
}

/**
 * Returns photos that are stuck (dead-letter): retry-exhausted or orphaned.
 * Used by the SyncPulse sheet so users can manually retry them.
 */
export async function getDeadLetterPhotos(): Promise<any[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readonly');
      const index = tx.store.index('by-uploaded');
      const unuploaded = await index.getAll(IDBKeyRange.only(0));
      await tx.done;

      const withBlob = unuploaded.filter(p => p.blob != null);
      const exhausted = withBlob.filter(p => (p.retryCount || 0) >= MAX_PHOTO_RETRIES);

      const tempPhotos = withBlob.filter(
        p => p.inspectionId?.startsWith('temp-') && (p.retryCount || 0) < MAX_PHOTO_RETRIES
      );
      const orphans: any[] = [];
      if (tempPhotos.length > 0) {
        const inspTx = db.transaction('inspections', 'readonly');
        await Promise.all(
          tempPhotos.map(async (p) => {
            const parent = await inspTx.store.get(p.inspectionId);
            if (!parent) orphans.push(p);
          })
        );
        await inspTx.done;
      }
      // Dedupe by id
      const seen = new Set<string>();
      return [...exhausted, ...orphans].filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
    },
    [],
    'getDeadLetterPhotos'
  );
}

/**
 * Reset retryCount = 0 on every photo. Used by the boot one-shot migration
 * and the manual "Retry" action in the SyncPulse sheet.
 */
export async function resetPhotoRetryCounts(onlyIds?: string[]): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      let cursor = await tx.store.openCursor();
      let reset = 0;
      const idSet = onlyIds ? new Set(onlyIds) : null;
      while (cursor) {
        const photo = cursor.value;
        const matches = idSet ? idSet.has(photo.id) : true;
        if (matches && (photo.retryCount || 0) > 0) {
          photo.retryCount = 0;
          await cursor.update(photo);
          reset++;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      if (reset > 0 && import.meta.env.DEV) {
        console.log(`[Offline Storage] Reset retryCount on ${reset} photos`);
      }
      return reset;
    },
    0,
    'resetPhotoRetryCounts'
  );
}

/**
 * Auto-prune synced photo blobs older than 7 days to free IndexedDB storage.
 * Never touches unsynced (uploaded = false) photos.
 */
export async function pruneOldSyncedPhotoBlobs(): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - SEVEN_DAYS;
      const tx = db.transaction('photos', 'readwrite');
      const index = tx.store.index('by-uploaded');
      // uploaded = true = 1 in IndexedDB index
      let cursor = await index.openCursor(IDBKeyRange.only(1));
      let pruned = 0;
      while (cursor) {
        const photo = cursor.value;
        // M6: Prune based on upload-confirmation time, not cache time. A photo
        // cached long ago but uploaded today must keep its blob as a recovery
        // source. Fall back to cachedAt only for legacy rows that predate the
        // uploadedAt field (they have no other timestamp signal available).
        const referenceTime = photo.uploadedAt ?? photo.cachedAt;
        if (photo.blob != null && referenceTime && referenceTime < cutoff) {
          photo.blob = null;
          await cursor.update(photo);
          pruned++;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      if (pruned > 0 && import.meta.env.DEV) {
        console.log(`[Offline Storage] Pruned ${pruned} old synced photo blobs`);
      }
      return pruned;
    },
    0,
    'pruneOldSyncedPhotoBlobs'
  );
}

export async function markPhotoAsUploaded(id: string, photoUrl: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        const now = Date.now();
        photo.uploaded = 1;
        photo.photoUrl = photoUrl;
        photo.lastValidated = now;
        // M6: Stamp upload-confirmation time so prune can age-out blobs
        // based on when the upload actually succeeded, not when the photo
        // was originally cached.
        photo.uploadedAt = now;
        // Release the binary blob to free IndexedDB storage quota
        photo.blob = null;
        photo.retryCount = 0;
        // S22: Clear any prior error state on success
        photo.lastError = null;
        photo.lastErrorAt = null;
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

/**
 * S22: Stamp a human-readable last-error message on a photo so the diagnostics
 * UI can show why it's stuck. Does NOT touch retryCount — callers decide
 * whether the error counts toward the dead-letter ceiling.
 */
export async function setPhotoLastError(id: string, message: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        photo.lastError = message.slice(0, 500);
        photo.lastErrorAt = Date.now();
        await db.put('photos', photo);
      }
    },
    undefined,
    'setPhotoLastError'
  );
}

/**
 * S22: Manual "Retry" action — zero retryCount and clear lastError so the
 * photo is eligible again on the next sync cycle.
 */
export async function resetPhotoForRetry(id: string): Promise<boolean> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (!photo) return false;
      photo.retryCount = 0;
      photo.lastError = null;
      photo.lastErrorAt = null;
      await db.put('photos', photo);
      return true;
    },
    false,
    'resetPhotoForRetry'
  );
}

/**
 * S23: Stamp the user-id that captured a staged photo so the sync path can
 * refuse to upload it under a different signed-in user's tree.
 */
export async function setPhotoCapturedBy(id: string, userId: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo && !photo.capturedByUserId) {
        photo.capturedByUserId = userId;
        await db.put('photos', photo);
      }
    },
    undefined,
    'setPhotoCapturedBy'
  );
}

/**
 * 1.C — Persist a photo upload failure to the dead-letter store. Idempotent
 * on photo id; updates retryCount/lastError on each call. Preserves
 * `firstFailedAt` from the existing entry if present.
 */
export interface PhotoUploadFailureEntry {
  id: string;
  inspectionId: string;
  fileName: string;
  photoUrl?: string;
  section?: string;
  retryCount: number;
  lastError: string;
  lastErrorAt: number;
  firstFailedAt: number;
  capturedByUserId?: string | null;
}

export async function recordPhotoUploadFailure(
  entry: Omit<PhotoUploadFailureEntry, 'firstFailedAt'> & { firstFailedAt?: number }
): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const existing = await (db as any).get('photo_upload_failures', entry.id).catch(() => null);
      const merged: PhotoUploadFailureEntry = {
        id: entry.id,
        inspectionId: entry.inspectionId,
        fileName: entry.fileName,
        photoUrl: entry.photoUrl,
        section: entry.section,
        retryCount: entry.retryCount,
        lastError: (entry.lastError || '').slice(0, 500),
        lastErrorAt: entry.lastErrorAt,
        firstFailedAt: existing?.firstFailedAt ?? entry.firstFailedAt ?? entry.lastErrorAt,
        capturedByUserId: entry.capturedByUserId ?? null,
      };
      await (db as any).put('photo_upload_failures', merged);
      if (import.meta.env.DEV) {
        console.warn('[Offline Storage] Photo upload failure recorded:', merged.id, merged.lastError);
      }
    },
    undefined,
    'recordPhotoUploadFailure'
  );
}

export async function listPhotoUploadFailures(): Promise<PhotoUploadFailureEntry[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const all: PhotoUploadFailureEntry[] = await (db as any).getAll('photo_upload_failures');
      // Newest failures first.
      return (all || []).sort((a, b) => (b.lastErrorAt || 0) - (a.lastErrorAt || 0));
    },
    [],
    'listPhotoUploadFailures'
  );
}

export async function removePhotoUploadFailure(id: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await (db as any).delete('photo_upload_failures', id);
    },
    undefined,
    'removePhotoUploadFailure'
  );
}

export async function getPhotoUploadFailureCount(): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await (db as any).count('photo_upload_failures');
    },
    0,
    'getPhotoUploadFailureCount'
  );
}

/**
 * S23: One-time boot migration. For any legacy photo with `pending/` prefix
 * and no `capturedByUserId`, backfill it ONLY if exactly one user-id is known
 * on this device (per the user_mappings store in offline-auth-store). Otherwise
 * leave them untouched — the sync path will route them to the dead-letter UI.
 */
export async function backfillCapturedByUserIdForPendingPhotos(): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      // Resolve the set of user-ids ever known on this device.
      let knownUserIds = new Set<string>();
      try {
        const authDb = await openDB('offline-auth-store');
        if (authDb.objectStoreNames.contains('user_mappings')) {
          const mappings: any[] = await authDb.getAll('user_mappings');
          for (const m of mappings) {
            if (m?.userId) knownUserIds.add(m.userId);
          }
        }
        authDb.close();
      } catch {
        // Best-effort; if we can't read auth-store, skip migration.
        return 0;
      }

      if (knownUserIds.size !== 1) {
        return 0; // ambiguous — let sync route them to dead-letter
      }
      const onlyUserId = Array.from(knownUserIds)[0];

      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      let updated = 0;
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const p: any = cursor.value;
        if (
          !p.uploaded &&
          !p.capturedByUserId &&
          typeof p.photoUrl === 'string' &&
          p.photoUrl.startsWith('pending/')
        ) {
          p.capturedByUserId = onlyUserId;
          await cursor.update(p);
          updated++;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      if (updated > 0 && import.meta.env.DEV) {
        console.log(`[Offline Storage] S23 backfill: tagged ${updated} pending photo(s) with capturedByUserId=${onlyUserId}`);
      }
      return updated;
    },
    0,
    'backfillCapturedByUserIdForPendingPhotos'
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

// S30: Recompute child_count_hint on the parent record after a child mutation.
// Called fire-and-forget from child-save helpers so it never blocks the save.
// Uses cheap count() per "other" store (not getAllFromIndex) to minimize IDB load,
// and skips entirely on read errors (a stale hint is safe for the SW guard).
async function recomputeInspectionChildCountHint(
  db: any,
  inspectionId: string,
  justSavedType: RelatedDataType,
  justSavedCount: number,
): Promise<void> {
  try {
    const inspection = await db.get('inspections', inspectionId).catch(() => null);
    if (!inspection) return;

    const otherTypes: RelatedDataType[] = (['systems', 'ziplines', 'equipment', 'standards', 'summary'] as RelatedDataType[])
      .filter(t => t !== justSavedType);
    let anyReadFailed = false;
    const counts = await Promise.all(
      otherTypes.map(async (t) => {
        try {
          const idx = db.transaction(storeNameMap[t]).store.index('by-inspection');
          return (await idx.count(inspectionId)) as number;
        } catch {
          // M2: signal degradation instead of silently treating as 0.
          anyReadFailed = true;
          return 0;
        }
      })
    );

    // H2: Bump parent updated_at on every child mutation. Without this, an
    // edit to a child row (e.g. zipline_name) leaves the parent's
    // updated_at == synced_at and `shouldPreserveLocalRecord` returns false,
    // so the Dashboard's network pipeline overwrites the parent and
    // downstream "empty-vs-populated" guards see a parent/child mismatch.
    inspection.updated_at = new Date().toISOString();

    // M2: If any sibling-store count failed (e.g. circuit breaker open),
    // do NOT overwrite child_count_hint with a partial total. A wrong hint
    // (e.g. 0 when there are really 10 rows) defeats downstream regression
    // detectors that compare hint vs live count. Preserve the existing hint
    // so the SW guard still has a real signal to compare against.
    if (!anyReadFailed) {
      const otherTotal = counts.reduce((a, b) => a + b, 0);
      // Summary contributes 1 if any row exists; align with old "summary?.length > 0 ? 1 : 0" semantics.
      const newHint = otherTotal + (justSavedType === 'summary' ? (justSavedCount > 0 ? 1 : 0) : justSavedCount);
      inspection.child_count_hint = newHint;
    } else if (import.meta.env.DEV) {
      console.warn('[Offline Storage] child_count_hint recompute skipped — sibling read failed', {
        inspectionId,
        justSavedType,
      });
    }

    await db.put('inspections', inspection);
  } catch {
    // non-fatal; SW guard tolerates a stale hint
  }
}

async function recomputeAssessmentChildCountHint(
  db: any,
  assessmentId: string,
  justSavedType: AssessmentDataType,
  justSavedCount: number,
): Promise<void> {
  try {
    const assessment = await db.get('daily_assessments', assessmentId).catch(() => null);
    if (!assessment) return;

    const allTypes: AssessmentDataType[] = ['beginning_of_day', 'end_of_day', 'operating_systems', 'equipment_checks', 'structure_checks', 'environment_checks'];
    const otherTypes = allTypes.filter(t => t !== justSavedType);
    let anyReadFailed = false;
    const counts = await Promise.all(
      otherTypes.map(async (t) => {
        try {
          const idx = db.transaction(assessmentStoreNameMap[t]).store.index('by-assessment');
          return (await idx.count(assessmentId)) as number;
        } catch {
          anyReadFailed = true;
          return 0;
        }
      })
    );
    // H2: Always bump parent updated_at on child mutation (see Inspection note).
    assessment.updated_at = new Date().toISOString();
    // M2: preserve existing hint when any sibling read failed.
    if (!anyReadFailed) {
      assessment.child_count_hint = counts.reduce((a, b) => a + b, 0) + justSavedCount;
    } else if (import.meta.env.DEV) {
      console.warn('[Offline Storage] assessment child_count_hint recompute skipped — sibling read failed', { assessmentId, justSavedType });
    }
    await db.put('daily_assessments', assessment);
  } catch {
    // non-fatal
  }
}

async function recomputeTrainingChildCountHint(
  db: any,
  trainingId: string,
  justSavedType: TrainingDataType,
  justSavedCount: number,
): Promise<void> {
  try {
    const training = await db.get('trainings', trainingId).catch(() => null);
    if (!training) return;

    const allTypes: TrainingDataType[] = ['delivery_approaches', 'operating_systems', 'immediate_attention', 'verifiable_items', 'systems_in_place', 'summary'];
    const otherTypes = allTypes.filter(t => t !== justSavedType);
    let anyReadFailed = false;
    const counts = await Promise.all(
      otherTypes.map(async (t) => {
        try {
          const idx = db.transaction(trainingStoreNameMap[t]).store.index('by-training');
          return (await idx.count(trainingId)) as number;
        } catch {
          anyReadFailed = true;
          return 0;
        }
      })
    );
    // H2: Always bump parent updated_at on child mutation (see Inspection note).
    training.updated_at = new Date().toISOString();
    // M2: preserve existing hint when any sibling read failed.
    if (!anyReadFailed) {
      training.child_count_hint = counts.reduce((a, b) => a + b, 0) + justSavedCount;
    } else if (import.meta.env.DEV) {
      console.warn('[Offline Storage] training child_count_hint recompute skipped — sibling read failed', { trainingId, justSavedType });
    }
    await db.put('trainings', training);
  } catch {
    // non-fatal
  }
}

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

      // S30: Recompute child_count_hint on the parent only when children mutate.
      // Fire-and-forget; never block the child save.
      void recomputeInspectionChildCountHint(db, inspectionId, type, data.length);
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

/**
 * Status-aware variant: returns whether THIS specific read truly succeeded.
 * Uses a local try/catch + timeout instead of diffing global counters, so a
 * concurrent failing IDB call cannot poison this read's status flag.
 */
export async function getRelatedDataOfflineWithStatus(
  type: RelatedDataType,
  inspectionId: string
): Promise<{ items: any[]; readSucceeded: boolean }> {
  // If the circuit breaker is already open, the read is guaranteed to be a fallback.
  if (isCircuitBreakerOpen()) {
    return { items: [], readSucceeded: false };
  }
  const { data, timedOut } = await withIDBTimeout(
    `getRelatedData(${type}/${inspectionId})`,
    'batch',
    () => getRelatedDataOffline(type, inspectionId),
    [] as any[]
  );
  return { items: data || [], readSucceeded: !timedOut };
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
/**
 * Save a daily assessment to IndexedDB.
 * Throws `IdbSaveError` on hard failure (Gap 2.1) — callers MUST handle rejection.
 */
export async function saveDailyAssessmentOffline(
  assessment: any,
  opts?: { childCountHint?: number }
): Promise<SaveResult> {
  return withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      if (opts?.childCountHint != null && opts.childCountHint >= 0) {
        assessment.child_count_hint = opts.childCountHint;
      }
      await db.put('daily_assessments', assessment);
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved daily assessment:', assessment.id);
      }
    },
    'saveDailyAssessmentOffline',
    assessment,
  );
}

export async function getOfflineDailyAssessments(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allAssessments = await db.getAll('daily_assessments');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      // C9: Also filter out quarantined remote-deleted records.
      const activeAssessments = allAssessments.filter(a => !a.deleted_at && !(a as any)._remote_deleted_at);
      
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
  return withIndexedDBReadBoundary(
    async () => {
      const db = await getDB();
      
      const all = await db.getAll('daily_assessments');
      // C9: Exclude quarantined records.
      let unsynced = all.filter(record => !(record as any)._remote_deleted_at).filter(record => {
        if (!record.synced_at) return true;
        if (record.updated_at) {
          return isUpdatedAheadOfSync(new Date(record.updated_at).getTime(), new Date(record.synced_at).getTime());
        }
        return false;
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
      
      // S8: registerInspectionSync removed (no-op since SW sync is disabled).
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

      // S30: Recompute child_count_hint on the parent (fire-and-forget).
      void recomputeAssessmentChildCountHint(db, assessmentId, type, data.length);
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

/** Status-aware variant — see getRelatedDataOfflineWithStatus. */
export async function getAssessmentDataOfflineWithStatus(
  type: AssessmentDataType,
  assessmentId: string
): Promise<{ items: any[]; readSucceeded: boolean }> {
  if (isCircuitBreakerOpen()) {
    return { items: [], readSucceeded: false };
  }
  const { data, timedOut } = await withIDBTimeout(
    `getAssessmentData(${type}/${assessmentId})`,
    'batch',
    () => getAssessmentDataOffline(type, assessmentId),
    [] as any[]
  );
  return { items: data || [], readSucceeded: !timedOut };
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
/**
 * Save a training to IndexedDB.
 * Throws `IdbSaveError` on hard failure (Gap 2.1) — callers MUST handle rejection.
 */
export async function saveTrainingOffline(
  training: any,
  opts?: { childCountHint?: number }
): Promise<SaveResult> {
  return withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      if (opts?.childCountHint != null && opts.childCountHint >= 0) {
        training.child_count_hint = opts.childCountHint;
      }
      await db.put('trainings', training);
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved training:', training.id);
      }
    },
    'saveTrainingOffline',
    training,
  );
}

export async function getOfflineTrainings(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allTrainings = await db.getAll('trainings');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      // C9: Also filter out quarantined remote-deleted records.
      const activeTrainings = allTrainings.filter(t => !t.deleted_at && !(t as any)._remote_deleted_at);
      
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
  return withIndexedDBReadBoundary(
    async () => {
      const db = await getDB();
      
      const all = await db.getAll('trainings');
      // C9: Exclude quarantined records.
      let unsynced = all.filter(record => !(record as any)._remote_deleted_at).filter(record => {
        if (!record.synced_at) return true;
        if (record.updated_at) {
          return isUpdatedAheadOfSync(new Date(record.updated_at).getTime(), new Date(record.synced_at).getTime());
        }
        return false;
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
    'getUnsyncedTrainings'
  );
}

// `getUnsyncedCounts` (batched single-transaction reader) was removed (Fix C2).
// It used `withIndexedDBErrorBoundary` with an empty-array fallback, which
// silently turned IDB hiccups into "queue empty" — zeroing the badge and
// tripping the sync early-exit. Callers must now use the three individual
// `getUnsynced{Inspections,Trainings,DailyAssessments}` readers in parallel
// and inspect each result with `isIdbReadFailure` so a failed read never
// masquerades as an empty queue.

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
      
      // S8: registerInspectionSync removed (no-op since SW sync is disabled).
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

      // S30: Recompute child_count_hint on the parent (fire-and-forget).
      void recomputeTrainingChildCountHint(db, trainingId, type, items.length);
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

/** Status-aware variant — see getRelatedDataOfflineWithStatus. */
export async function getTrainingDataOfflineWithStatus(
  type: TrainingDataType,
  trainingId: string
): Promise<{ items: any[]; readSucceeded: boolean }> {
  if (isCircuitBreakerOpen()) {
    return { items: [], readSucceeded: false };
  }
  const { data, timedOut } = await withIDBTimeout(
    `getTrainingData(${type}/${trainingId})`,
    'batch',
    () => getTrainingDataOffline(type, trainingId),
    [] as any[]
  );
  return { items: data || [], readSucceeded: !timedOut };
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

// ============= STORAGE EVICTION FUNCTIONS =============

/**
 * Child store names grouped by parent store type.
 * Used for cascading eviction of synced report data.
 */
const INSPECTION_CHILD_STORES = [
  'inspection_systems', 'inspection_ziplines', 'inspection_equipment',
  'inspection_standards', 'inspection_summary',
] as const;

const TRAINING_CHILD_STORES = [
  'training_delivery_approaches', 'training_operating_systems',
  'training_immediate_attention', 'training_verifiable_items',
  'training_systems_in_place', 'training_summary',
] as const;

const ASSESSMENT_CHILD_STORES = [
  'daily_assessment_beginning_of_day', 'daily_assessment_end_of_day',
  'daily_assessment_operating_systems', 'daily_assessment_equipment_checks',
  'daily_assessment_structure_checks', 'daily_assessment_environment_checks',
] as const;

/**
 * Get the current route's report ID (if any) to avoid evicting the open report.
 */
function getCurrentReportId(): string | null {
  const path = window.location.pathname;
  const match = path.match(/\/(inspection|training|daily-assessment)\/([^/]+)/);
  return match ? match[2] : null;
}

/**
 * Evict synced reports older than `ageDays` from IndexedDB.
 * Only evicts records where synced_at >= updated_at (confirmed synced).
 * Returns the number of evicted parent records.
 */
export async function evictSyncedReports(ageDays: number): Promise<number> {
  let evictedCount = 0;
  const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  const currentReportId = getCurrentReportId();

  try {
    const db = await getDB();

    // Helper to evict from a parent store + its child stores
    const evictFromStore = async (
      parentStoreName: 'inspections' | 'trainings' | 'daily_assessments',
      childStores: readonly string[],
      childIndexPrefix: string,
      photoIndexField: string,
    ) => {
      const readTx = db.transaction(parentStoreName, 'readonly');
      const allRecords = await readTx.store.getAll();
      await readTx.done;

      // V8: Pre-scan unsynced photo IDs to skip eviction for any report with pending uploads.
      // Photos store has its own 'by-uploaded' index; do this once per evict pass, not per record.
      const unsyncedReportIds = new Set<string>();
      if (db.objectStoreNames.contains('photos')) {
        try {
          const photoTx = db.transaction('photos', 'readonly');
          const allPhotos = await photoTx.store.getAll();
          await photoTx.done;
          for (const p of allPhotos) {
            if (p && p.uploaded === 0 && p.inspectionId) {
              unsyncedReportIds.add(p.inspectionId);
            }
          }
        } catch (e) {
          console.warn('[Eviction] Failed to scan unsynced photos -- skipping eviction this pass:', e);
          return; // Be conservative: if we can't verify, skip eviction entirely
        }
      }

      const RECENT_EDIT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
      const nowMs = Date.now();

      for (const record of allRecords) {
        const id = record.id;
        if (!id || id === currentReportId) continue;

        // Safety: only evict if synced and not modified since sync
        const syncedAt = record.synced_at ? new Date(record.synced_at).getTime() : 0;
        const updatedAt = record.updated_at ? new Date(record.updated_at).getTime() : 0;
        if (!syncedAt || syncedAt < updatedAt) continue;
        if (syncedAt > cutoff) continue;

        // V8: Skip if parent was edited within the last 30 minutes regardless of synced_at.
        // (Defends against a stale synced_at stamped while another tab was editing.)
        if (updatedAt && (nowMs - updatedAt) < RECENT_EDIT_WINDOW_MS) {
          if (import.meta.env.DEV) {
            console.log(`[Eviction] Skip ${id.substring(0, 8)} -- recently edited (<30 min)`);
          }
          continue;
        }

        // V8: Skip if there are any unsynced (uploaded === 0) photos for this report.
        if (unsyncedReportIds.has(id)) {
          if (import.meta.env.DEV) {
            console.log(`[Eviction] Skip ${id.substring(0, 8)} -- has unsynced photos`);
          }
          continue;
        }

        // Evict parent + children in a single transaction
        // Use 'as any' to bypass strict store name typing for dynamic store list
        const allStoreNames = [parentStoreName, ...childStores, 'photos'];
        const availableStores = allStoreNames.filter(s => db.objectStoreNames.contains(s as any));
        const deleteTx = db.transaction(availableStores as any, 'readwrite');

        (deleteTx as any).objectStore(parentStoreName).delete(id);

        // Evict child records
        for (const childStore of childStores) {
          if (!db.objectStoreNames.contains(childStore as any)) continue;
          const store = (deleteTx as any).objectStore(childStore);
          const indexName = `by-${childIndexPrefix}`;
          if (store.indexNames.contains(indexName)) {
            const childKeys = await store.index(indexName).getAllKeys(id);
            for (const key of childKeys) {
              await store.delete(key);
            }
          }
        }

        // Evict photo metadata for this report
        if (db.objectStoreNames.contains('photos')) {
          const photoStore = deleteTx.objectStore('photos');
          if (photoStore.indexNames.contains('by-inspection')) {
            const photoKeys = await photoStore.index('by-inspection').getAllKeys(id);
            for (const key of photoKeys) {
              await photoStore.delete(key);
            }
          }
        }

        await deleteTx.done;
        evictedCount++;
      }
    };

    await evictFromStore('inspections', INSPECTION_CHILD_STORES, 'inspection', 'inspectionId');
    await evictFromStore('trainings', TRAINING_CHILD_STORES, 'training', 'trainingId');
    await evictFromStore('daily_assessments', ASSESSMENT_CHILD_STORES, 'assessment', 'assessmentId');

  } catch (error) {
    console.warn('[Eviction] evictSyncedReports failed:', error);
  }

  return evictedCount;
}

/**
 * Evict report_backups entries older than `ageDays`.
 * Returns number of evicted entries.
 */
export async function evictOldReportBackups(ageDays: number): Promise<number> {
  let evictedCount = 0;
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('report_backups')) return 0;

    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    const tx = db.transaction('report_backups', 'readwrite');
    const index = tx.store.index('by-timestamp');

    // IDBKeyRange.upperBound gets all entries with timestamp <= cutoff
    const range = IDBKeyRange.upperBound(cutoff);
    let cursor = await index.openCursor(range);
    while (cursor) {
      await cursor.delete();
      evictedCount++;
      cursor = await cursor.continue();
    }
    await tx.done;

    if (evictedCount > 0 && import.meta.env.DEV) {
      console.log(`[Eviction] Removed ${evictedCount} old report_backups entries`);
    }
  } catch (error) {
    console.warn('[Eviction] evictOldReportBackups failed:', error);
  }
  return evictedCount;
}

/**
 * Garbage-collect photos whose parent inspection has been stuck on a temp-* id
 * for longer than `ageDays`. Covers two failure modes:
 *   1. Parent was deleted from IDB before sync (orphan) — already filtered from
 *      live queue, but the row still consumes storage.
 *   2. Parent still exists but its sync keeps failing (validation/RLS) so its
 *      id never gets rewritten to a real UUID. Without this GC the blob sits
 *      in IDB forever, growing storage on every failed-sync device.
 *
 * Safety: only deletes rows whose `inspectionId` STILL starts with `temp-` at
 * the moment of GC. If the parent later syncs successfully and `relinkPhotosToNewInspectionId`
 * rewrites the id to a UUID, the photo is no longer eligible for this eviction.
 *
 * Default age = 30 days. Returns count of evicted photos.
 */
export async function evictStuckTempPhotos(ageDays: number = 30): Promise<number> {
  let evictedCount = 0;
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('photos')) return 0;

    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    const tx = db.transaction('photos', 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const photo = cursor.value;
      if (
        photo.inspectionId?.startsWith('temp-') &&
        photo.uploaded === 0 &&
        typeof photo.timestamp === 'number' &&
        photo.timestamp < cutoff
      ) {
        await cursor.delete();
        evictedCount++;
      }
      cursor = await cursor.continue();
    }
    await tx.done;

    if (evictedCount > 0 && import.meta.env.DEV) {
      console.log(`[Eviction] Removed ${evictedCount} stuck temp-* photos older than ${ageDays}d`);
    }
  } catch (error) {
    console.warn('[Eviction] evictStuckTempPhotos failed:', error);
  }
  return evictedCount;
}

/**
 * Evict photo metadata rows where blob is null (already uploaded) and synced older than ageDays.
 */
export async function evictSyncedPhotoMetadata(ageDays: number): Promise<number> {
  let evictedCount = 0;
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('photos')) return 0;

    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    const currentReportId = getCurrentReportId();

    const tx = db.transaction('photos', 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const photo = cursor.value;
      // Only evict if: blob already nullified, uploaded, and old enough
      if (
        photo.blob === null &&
        photo.uploaded === 1 &&
        photo.timestamp < cutoff &&
        photo.inspectionId !== currentReportId
      ) {
        await cursor.delete();
        evictedCount++;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (error) {
    console.warn('[Eviction] evictSyncedPhotoMetadata failed:', error);
  }
  return evictedCount;
}

// ============= EQUIPMENT TYPE CACHE =============

interface EquipmentTypeCacheEntry {
  id: string;
  equipment_category: string;
  label: string;
  display_order: number;
  is_active: boolean;
  synced: boolean;
}

export async function getEquipmentTypeOptions(category: string): Promise<EquipmentTypeCacheEntry[]> {
  return withIndexedDBErrorBoundary(async () => {
    const db = await getDB();
    const all = await db.getAllFromIndex('equipment_type_cache', 'by-category', category);
    return all.filter(e => e.is_active).sort((a, b) => a.display_order - b.display_order);
  }, [], 'getEquipmentTypeOptions');
}

export async function putEquipmentTypeOption(entry: EquipmentTypeCacheEntry): Promise<void> {
  return withIndexedDBErrorBoundary(async () => {
    const db = await getDB();
    await db.put('equipment_type_cache', entry);
  }, undefined, 'putEquipmentTypeOption');
}

export async function bulkPutEquipmentTypeOptions(entries: EquipmentTypeCacheEntry[]): Promise<void> {
  return withIndexedDBErrorBoundary(async () => {
    const db = await getDB();
    const tx = db.transaction('equipment_type_cache', 'readwrite');
    for (const entry of entries) {
      await tx.store.put(entry);
    }
    await tx.done;
  }, undefined, 'bulkPutEquipmentTypeOptions');
}

// ─── C9: Remote-deleted quarantine helpers ─────────────────────────────────
// When a sync detects the server-side row has been soft-deleted but the
// local copy still has unsynced edits, we mark the local parent with
// `_remote_deleted_at` + `_quarantine_reason` instead of wiping it. The
// dashboard / list-getters and getUnsynced* filters skip quarantined rows;
// the user resolves them via RemoteDeletedConflictDialog.
//
// These helpers are intentionally additive — no existing call sites change.

export type QuarantineTable = 'inspections' | 'trainings' | 'daily_assessments';

export interface QuarantinedRecord {
  table: QuarantineTable;
  id: string;
  organization?: string | null;
  location?: string | null;
  site?: string | null;
  remoteDeletedAt: string;
  reason: string;
  raw: any;
}

export async function quarantineRecord(
  table: QuarantineTable,
  id: string,
  remoteDeletedAt: string,
  reason: string = 'remote_soft_delete',
): Promise<boolean> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const row = await db.get(table, id);
      if (!row) return false;
      const updated = {
        ...row,
        _remote_deleted_at: remoteDeletedAt,
        _quarantine_reason: reason,
      };
      await db.put(table, updated);
      if (import.meta.env.DEV) {
        console.warn('[C9] Quarantined local record (remote was soft-deleted):', {
          table,
          id: id.substring(0, 8),
          remoteDeletedAt,
        });
      }
      return true;
    },
    false,
    'quarantineRecord',
  );
}

export async function getQuarantinedRecords(
  table?: QuarantineTable,
): Promise<QuarantinedRecord[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tables: QuarantineTable[] = table
        ? [table]
        : ['inspections', 'trainings', 'daily_assessments'];
      const out: QuarantinedRecord[] = [];
      for (const t of tables) {
        const all = await db.getAll(t);
        for (const r of all as any[]) {
          if (r._remote_deleted_at) {
            out.push({
              table: t,
              id: r.id,
              organization: r.organization ?? null,
              location: r.location ?? null,
              site: r.site ?? null,
              remoteDeletedAt: r._remote_deleted_at,
              reason: r._quarantine_reason ?? 'remote_soft_delete',
              raw: r,
            });
          }
        }
      }
      return out;
    },
    [],
    'getQuarantinedRecords',
  );
}

/** Permanently discard a quarantined record + its children (user-confirmed). */
export async function discardQuarantinedRecord(
  table: QuarantineTable,
  id: string,
): Promise<void> {
  switch (table) {
    case 'inspections':
      await deleteOfflineInspection(id);
      return;
    case 'trainings':
      await deleteOfflineTraining(id);
      return;
    case 'daily_assessments':
      await deleteOfflineDailyAssessment(id);
      return;
  }
}

/**
 * Clone a quarantined parent + all its children under a fresh UUID, mark
 * the new copy dirty (synced_at = null) so the next sync uploads it as a
 * new report on the server, and remove the quarantined original from IDB.
 *
 * Returns the new id, or null if the quarantined record could not be found.
 */
export async function restoreQuarantinedAsNew(
  table: QuarantineTable,
  id: string,
): Promise<string | null> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const row = await db.get(table, id);
      if (!row) return null;

      const newId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      // Strip quarantine + sync state on the clone so it looks like a
      // brand-new local record to the next sync cycle.
      const clone: any = {
        ...row,
        id: newId,
        synced_at: null,
        updated_at: nowIso,
        created_at: nowIso,
        client_idempotency_key: null,
        // Keep deleted_at clear — this is a fresh report.
        deleted_at: null,
        deleted_by: null,
        retention_until: null,
      };
      delete clone._remote_deleted_at;
      delete clone._quarantine_reason;

      // Copy children with rewritten parent FK and fresh ids.
      const childStores: Record<QuarantineTable, { name: string; fk: string; index: string }[]> = {
        inspections: [
          { name: 'systems', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'ziplines', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'equipment', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'standards', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'summary', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'inspection_photos', fk: 'inspection_id', index: 'by-inspection' },
        ],
        trainings: [
          { name: 'training_delivery_approaches', fk: 'training_id', index: 'by-training' },
          { name: 'training_operating_systems', fk: 'training_id', index: 'by-training' },
          { name: 'training_immediate_attention', fk: 'training_id', index: 'by-training' },
          { name: 'training_verifiable_items', fk: 'training_id', index: 'by-training' },
          { name: 'training_systems_in_place', fk: 'training_id', index: 'by-training' },
          { name: 'training_summary', fk: 'training_id', index: 'by-training' },
          { name: 'training_photos', fk: 'training_id', index: 'by-training' },
        ],
        daily_assessments: [
          { name: 'daily_assessment_beginning_of_day', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_end_of_day', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_operating_systems', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_equipment_checks', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_structure_checks', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_environment_checks', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_photos', fk: 'assessment_id', index: 'by-assessment' },
        ],
      };

      // Write the new parent.
      await db.put(table, clone);

      for (const store of childStores[table]) {
        try {
          const idx = db.transaction(store.name as any).store.index(store.index as any);
          const children = await idx.getAll(id);
          if (!children || children.length === 0) continue;
          const tx = db.transaction(store.name as any, 'readwrite');
          for (const child of children as any[]) {
            const newChild = {
              ...child,
              id: crypto.randomUUID(),
              [store.fk]: newId,
            };
            await tx.store.put(newChild);
          }
          await tx.done;
        } catch (err) {
          // Non-fatal — a missing/empty child store shouldn't block the restore.
          if (import.meta.env.DEV) {
            console.warn('[C9] restoreQuarantinedAsNew: child copy skipped', {
              store: store.name,
              err,
            });
          }
        }
      }

      // Drop the original quarantined parent + its children. Children under
      // the old id are now orphaned in IDB — clear them too.
      try {
        for (const store of childStores[table]) {
          const idx = db.transaction(store.name as any).store.index(store.index as any);
          const children = await idx.getAll(id);
          if (!children || children.length === 0) continue;
          const tx = db.transaction(store.name as any, 'readwrite');
          for (const child of children as any[]) {
            await tx.store.delete(child.id);
          }
          await tx.done;
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[C9] restoreQuarantinedAsNew: old child cleanup skipped', err);
        }
      }
      try {
        await db.delete(table, id);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[C9] restoreQuarantinedAsNew: old parent cleanup skipped', err);
        }
      }

      if (import.meta.env.DEV) {
        console.log('[C9] Restored quarantined record as new:', {
          table,
          oldId: id.substring(0, 8),
          newId: newId.substring(0, 8),
        });
      }
      return newId;
    },
    null,
    'restoreQuarantinedAsNew',
  );
}
