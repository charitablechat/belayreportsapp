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
  photos: {
    key: string;
    value: {
      id: string;
      inspectionId: string;
      section: string;
      blob: Blob;
      fileName: string;
      timestamp: number;
      uploaded: boolean;
      photoUrl?: string;
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
}

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;

export async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<InspectionDB>('rope-works-inspections', 4, {
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
        
        // Create photos store if it doesn't exist
        if (!db.objectStoreNames.contains('photos')) {
          const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
          photoStore.createIndex('by-inspection', 'inspectionId');
          photoStore.createIndex('by-uploaded', 'uploaded');
        }
        
        // Create related data stores
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

// Photo storage functions
export async function savePhotoOffline(photo: {
  id: string;
  inspectionId: string;
  section: string;
  blob: Blob;
  fileName: string;
  uploaded?: boolean;
  photoUrl?: string;
}) {
  const db = await getDB();
  await db.put('photos', {
    ...photo,
    timestamp: Date.now(),
    uploaded: photo.uploaded || false,
  });
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Saved photo:', photo.id);
  }
}

export async function getOfflinePhotos(inspectionId: string) {
  const db = await getDB();
  const index = db.transaction('photos').store.index('by-inspection');
  return await index.getAll(inspectionId);
}

export async function getUnuploadedPhotos() {
  const db = await getDB();
  const allPhotos = await db.getAll('photos');
  return allPhotos.filter(p => !p.uploaded);
}

export async function markPhotoAsUploaded(id: string, photoUrl: string) {
  const db = await getDB();
  const photo = await db.get('photos', id);
  if (photo) {
    photo.uploaded = true;
    photo.photoUrl = photoUrl;
    await db.put('photos', photo);
    
    if (import.meta.env.DEV) {
      console.log('[Offline Storage] Marked photo as uploaded:', id);
    }
  }
}

export async function deleteOfflinePhoto(id: string) {
  const db = await getDB();
  await db.delete('photos', id);
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Deleted photo:', id);
  }
}

// Related data storage functions
type RelatedDataType = 'systems' | 'ziplines' | 'equipment' | 'standards' | 'summary';
type RelatedStoreNames = 'inspection_systems' | 'inspection_ziplines' | 'inspection_equipment' | 'inspection_standards' | 'inspection_summary';

const storeNameMap: Record<RelatedDataType, RelatedStoreNames> = {
  systems: 'inspection_systems',
  ziplines: 'inspection_ziplines',
  equipment: 'inspection_equipment',
  standards: 'inspection_standards',
  summary: 'inspection_summary',
};

export async function saveRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string,
  data: any[]
) {
  const db = await getDB();
  const storeName = storeNameMap[type];
  
  // Clear existing data for this inspection
  const existingData = await getRelatedDataOffline(type, inspectionId);
  for (const item of existingData) {
    await db.delete(storeName, item.id);
  }
  
  // Save new data
  for (const item of data) {
    const dataWithInspectionId = {
      ...item,
      inspection_id: inspectionId,
      // Generate ID if not present
      id: item.id || `${inspectionId}-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
    await db.put(storeName, dataWithInspectionId);
  }
  
  if (import.meta.env.DEV) {
    console.log(`[Offline Storage] Saved ${type}:`, data.length, 'items');
  }
}

export async function getRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string
): Promise<any[]> {
  const db = await getDB();
  const storeName = storeNameMap[type];
  const index = db.transaction(storeName).store.index('by-inspection');
  return await index.getAll(inspectionId);
}

export async function clearRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string
) {
  const db = await getDB();
  const storeName = storeNameMap[type];
  const existingData = await getRelatedDataOffline(type, inspectionId);
  
  for (const item of existingData) {
    await db.delete(storeName, item.id);
  }
  
  if (import.meta.env.DEV) {
    console.log(`[Offline Storage] Cleared ${type} for inspection:`, inspectionId);
  }
}
