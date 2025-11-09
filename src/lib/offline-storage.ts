import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface InspectionDB extends DBSchema {
  inspections: {
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
}

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;

export async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<InspectionDB>('rope-works-inspections', 2, {
      upgrade(db, oldVersion, newVersion, transaction) {
        let inspectionStore;
        
        // Create or get the inspections store
        if (!db.objectStoreNames.contains('inspections')) {
          inspectionStore = db.createObjectStore('inspections', {
            keyPath: 'id',
          });
          inspectionStore.createIndex('by-status', 'status');
          inspectionStore.createIndex('by-synced', 'synced_at');
        } else {
          inspectionStore = transaction.objectStore('inspections');
          // Add new index if it doesn't exist
          if (!inspectionStore.indexNames.contains('by-synced')) {
            inspectionStore.createIndex('by-synced', 'synced_at');
          }
        }
        
        // Create operations store if it doesn't exist
        if (!db.objectStoreNames.contains('operations')) {
          db.createObjectStore('operations', { autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveInspectionOffline(inspection: any) {
  const db = await getDB();
  await db.put('inspections', inspection);
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Saved inspection:', inspection.id);
  }
}

export async function getOfflineInspections() {
  const db = await getDB();
  return await db.getAll('inspections');
}

export async function getOfflineInspection(id: string) {
  const db = await getDB();
  return await db.get('inspections', id);
}

export async function deleteOfflineInspection(id: string) {
  const db = await getDB();
  await db.delete('inspections', id);
}

export async function getUnsyncedInspections() {
  const db = await getDB();
  const allInspections = await db.getAll('inspections');
  const unsynced = allInspections.filter(i => !i.synced_at || i.updated_at > i.synced_at);
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Unsynced inspections:', unsynced.length);
  }
  
  return unsynced;
}

// Operation queue management
export async function queueOperation(type: 'create' | 'update' | 'delete', inspectionId: string, data: any) {
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
}

export async function getQueuedOperations() {
  const db = await getDB();
  const operations = await db.getAll('operations');
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Queued operations:', operations.length);
  }
  
  return operations;
}

export async function removeQueuedOperation(id: number) {
  const db = await getDB();
  await db.delete('operations', id);
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Removed queued operation:', id);
  }
}

export async function incrementOperationRetry(id: number) {
  const db = await getDB();
  const operation = await db.get('operations', id);
  if (operation) {
    operation.retries += 1;
    await db.put('operations', operation);
  }
}
