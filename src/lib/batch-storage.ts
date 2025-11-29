/**
 * Batched IndexedDB operations for better performance
 * Groups multiple operations into a single transaction
 */

import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'inspection-app';
const DB_VERSION = 2;

interface BatchOperation<T> {
  type: 'put' | 'delete' | 'get';
  storeName: string;
  key?: IDBValidKey;
  value?: T;
}

interface BatchResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}

/**
 * Execute multiple IndexedDB operations in a single transaction
 * Much more efficient than individual operations
 */
export const executeBatch = async <T = any>(
  operations: BatchOperation<T>[]
): Promise<BatchResult<T>[]> => {
  if (operations.length === 0) return [];

  const startTime = Date.now();
  const results: BatchResult<T>[] = [];

  try {
    const db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('inspections')) {
          db.createObjectStore('inspections', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id' });
        }
      },
    });

    // Group operations by store name for optimal batching
    const operationsByStore = new Map<string, BatchOperation<T>[]>();
    operations.forEach(op => {
      if (!operationsByStore.has(op.storeName)) {
        operationsByStore.set(op.storeName, []);
      }
      operationsByStore.get(op.storeName)!.push(op);
    });

    // Execute batched operations per store
    for (const [storeName, storeOps] of operationsByStore) {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      for (const op of storeOps) {
        try {
          let result: any;

          switch (op.type) {
            case 'put':
              if (!op.value) throw new Error('Put operation requires a value');
              await store.put(op.value);
              result = { success: true };
              break;

            case 'delete':
              if (!op.key) throw new Error('Delete operation requires a key');
              await store.delete(op.key);
              result = { success: true };
              break;

            case 'get':
              if (!op.key) throw new Error('Get operation requires a key');
              const data = await store.get(op.key);
              result = { success: true, data };
              break;

            default:
              throw new Error(`Unknown operation type: ${(op as any).type}`);
          }

          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      await tx.done;
    }

    const duration = Date.now() - startTime;
    if (import.meta.env.DEV) {
      console.log(
        `[Batch Storage] Executed ${operations.length} operations in ${duration}ms`,
        { successCount: results.filter(r => r.success).length }
      );
    }

    return results;
  } catch (error) {
    console.error('[Batch Storage] Batch execution failed:', error);
    
    // Return error for all operations
    return operations.map(() => ({
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }));
  }
};

/**
 * Batch save multiple records
 */
export const batchSave = async <T>(
  storeName: string,
  records: T[]
): Promise<BatchResult<T>[]> => {
  const operations: BatchOperation<T>[] = records.map(record => ({
    type: 'put',
    storeName,
    value: record,
  }));

  return executeBatch(operations);
};

/**
 * Batch delete multiple records
 */
export const batchDelete = async (
  storeName: string,
  keys: IDBValidKey[]
): Promise<BatchResult<void>[]> => {
  const operations: BatchOperation<void>[] = keys.map(key => ({
    type: 'delete',
    storeName,
    key,
  }));

  return executeBatch(operations);
};

/**
 * Batch get multiple records
 */
export const batchGet = async <T>(
  storeName: string,
  keys: IDBValidKey[]
): Promise<BatchResult<T>[]> => {
  const operations: BatchOperation<T>[] = keys.map(key => ({
    type: 'get',
    storeName,
    key,
  }));

  return executeBatch(operations);
};
