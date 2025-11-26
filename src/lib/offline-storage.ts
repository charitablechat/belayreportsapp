import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { checkStorageQuota, requestPersistentStorage } from './mobile-detection';

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
}

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;
let storageWarningShown = false;

/**
 * Check if IndexedDB is available and healthy
 */
export async function checkIndexedDBHealth(): Promise<boolean> {
  if (!('indexedDB' in window)) {
    console.error('[Offline Storage] IndexedDB not available');
    return false;
  }

  try {
    // Try to open a test database
    const testDb = await openDB('health-check', 1);
    testDb.close();
    return true;
  } catch (error) {
    console.error('[Offline Storage] IndexedDB health check failed:', error);
    return false;
  }
}

/**
 * Request persistent storage and check quota
 */
async function ensureStorage(): Promise<void> {
  // Request persistent storage (important on mobile)
  const isPersisted = await requestPersistentStorage();
  
  if (!isPersisted && !storageWarningShown) {
    console.warn('[Offline Storage] Persistent storage not granted - data may be cleared by browser');
    storageWarningShown = true;
  }

  // Check storage quota
  const quota = await checkStorageQuota();
  
  if (quota.percentUsed > 80 && !storageWarningShown) {
    console.warn('[Offline Storage] Storage almost full:', quota.percentUsed.toFixed(2) + '%');
    storageWarningShown = true;
  }
}

export async function getDB() {
  if (!dbPromise) {
    // Ensure storage is available before opening DB
    await ensureStorage();
    
    dbPromise = openDB<InspectionDB>('rope-works-inspections', 6, {
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
        
        // Daily assessments store
        if (!db.objectStoreNames.contains('daily_assessments')) {
          const assessmentStore = db.createObjectStore('daily_assessments', { keyPath: 'id' });
          assessmentStore.createIndex('by-status', 'status');
          assessmentStore.createIndex('by-synced', 'synced_at');
        }
        
        // Assessment operations store
        if (!db.objectStoreNames.contains('assessment_operations')) {
          db.createObjectStore('assessment_operations', { autoIncrement: true });
        }
        
        // Daily assessment related data stores
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
        
        // Training stores
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
      },
    });
  }
  return dbPromise;
}

// Inspection functions

export async function saveInspectionOffline(inspection: any) {
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

export async function getUnsyncedInspections(userId?: string) {
  const db = await getDB();
  const allInspections = await db.getAll('inspections');
  let unsynced = allInspections.filter(i => !i.synced_at || i.updated_at > i.synced_at);
  
  if (userId) {
    unsynced = unsynced.filter(i => i.inspector_id === userId);
  }
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Unsynced inspections:', {
      total: unsynced.length,
      userId: userId ? userId.substring(0, 8) + '...' : 'all',
    });
  }
  
  return unsynced;
}

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
  
  const { registerInspectionSync } = await import('./background-sync');
  await registerInspectionSync();
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

// Photo functions

export async function savePhotoOffline(photo: {
  id: string;
  inspectionId: string;
  section: string;
  blob: Blob;
  fileName: string;
  uploaded?: boolean;
  photoUrl?: string;
}) {
  try {
    const db = await getDB();
    
    const quota = await checkStorageQuota();
    if (quota.percentUsed > 90) {
      throw new Error('Storage almost full. Please sync photos to free up space.');
    }
    
    await db.put('photos', {
      ...photo,
      timestamp: Date.now(),
      uploaded: photo.uploaded || false,
    });
    
    if (import.meta.env.DEV) {
      console.log('[Offline Storage] Saved photo:', photo.id);
    }
    
    if (!photo.uploaded) {
      const { registerPhotoSync } = await import('./background-sync');
      await registerPhotoSync();
    }
  } catch (error: any) {
    console.error('[Offline Storage] Failed to save photo:', error);
    
    if (error.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please sync photos to free up space.');
    }
    
    throw error;
  }
}

export async function getOfflinePhotos(inspectionId: string) {
  const db = await getDB();
  const index = db.transaction('photos').store.index('by-inspection');
  return await index.getAll(inspectionId);
}

export async function getUnuploadedPhotos(userId?: string) {
  const db = await getDB();
  const allPhotos = await db.getAll('photos');
  let unuploaded = allPhotos.filter(p => !p.uploaded);
  
  if (userId) {
    const userInspections = await getUnsyncedInspections(userId);
    const userInspectionIds = new Set(userInspections.map(i => i.id));
    unuploaded = unuploaded.filter(p => userInspectionIds.has(p.inspectionId));
  }
  
  return unuploaded;
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
  
  const existingData = await getRelatedDataOffline(type, inspectionId);
  for (const item of existingData) {
    await db.delete(storeName, item.id);
  }
  
  for (const item of data) {
    const dataWithInspectionId = {
      ...item,
      inspection_id: inspectionId,
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

// Daily Assessment functions
export async function saveDailyAssessmentOffline(assessment: any) {
  try {
    const db = await getDB();
    await db.put('daily_assessments', assessment);
    
    if (import.meta.env.DEV) {
      console.log('[Offline Storage] Saved daily assessment:', assessment.id);
    }
  } catch (error: any) {
    console.error('[Offline Storage] Failed to save daily assessment:', error);
    
    if (error.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please sync and clear old data.');
    }
    
    throw error;
  }
}

export async function getOfflineDailyAssessments() {
  const db = await getDB();
  return await db.getAll('daily_assessments');
}

export async function getOfflineDailyAssessment(id: string) {
  const db = await getDB();
  return await db.get('daily_assessments', id);
}

export async function deleteOfflineDailyAssessment(id: string) {
  const db = await getDB();
  await db.delete('daily_assessments', id);
}

export async function getUnsyncedDailyAssessments(userId?: string) {
  const db = await getDB();
  const allAssessments = await db.getAll('daily_assessments');
  let unsynced = allAssessments.filter(a => !a.synced_at || a.updated_at > a.synced_at);
  
  if (userId) {
    unsynced = unsynced.filter(a => a.inspector_id === userId);
  }
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Unsynced daily assessments:', {
      total: unsynced.length,
      userId: userId ? userId.substring(0, 8) + '...' : 'all',
    });
  }
  
  return unsynced;
}

export async function queueAssessmentOperation(type: 'create' | 'update' | 'delete', assessmentId: string, data: any) {
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
  
  const { registerInspectionSync } = await import('./background-sync');
  await registerInspectionSync();
}

export async function getQueuedAssessmentOperations() {
  const db = await getDB();
  const operations = await db.getAll('assessment_operations');
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Queued assessment operations:', operations.length);
  }
  
  return operations;
}

export async function removeQueuedAssessmentOperation(id: number) {
  const db = await getDB();
  await db.delete('assessment_operations', id);
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Removed queued assessment operation:', id);
  }
}

export async function incrementAssessmentOperationRetry(id: number) {
  const db = await getDB();
  const operation = await db.get('assessment_operations', id);
  if (operation) {
    operation.retries += 1;
    await db.put('assessment_operations', operation);
  }
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
  data: any[]
) {
  const db = await getDB();
  const storeName = assessmentStoreNameMap[type];
  
  const existingData = await getAssessmentDataOffline(type, assessmentId);
  for (const item of existingData) {
    await db.delete(storeName, item.id);
  }
  
  for (const item of data) {
    const dataWithAssessmentId = {
      ...item,
      assessment_id: assessmentId,
      id: item.id || `${assessmentId}-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
    await db.put(storeName, dataWithAssessmentId);
  }
  
  if (import.meta.env.DEV) {
    console.log(`[Offline Storage] Saved assessment ${type}:`, data.length, 'items');
  }
}

export async function getAssessmentDataOffline(
  type: AssessmentDataType,
  assessmentId: string
): Promise<any[]> {
  const db = await getDB();
  const storeName = assessmentStoreNameMap[type];
  const index = db.transaction(storeName).store.index('by-assessment');
  return await index.getAll(assessmentId);
}

export async function clearAssessmentDataOffline(
  type: AssessmentDataType,
  assessmentId: string
) {
  const db = await getDB();
  const storeName = assessmentStoreNameMap[type];
  const existingData = await getAssessmentDataOffline(type, assessmentId);
  
  for (const item of existingData) {
    await db.delete(storeName, item.id);
  }
  
  if (import.meta.env.DEV) {
    console.log(`[Offline Storage] Cleared ${type} for assessment:`, assessmentId);
  }
}

// Training functions
export async function saveTrainingOffline(training: any) {
  try {
    const db = await getDB();
    await db.put('trainings', training);
    
    if (import.meta.env.DEV) {
      console.log('[Offline Storage] Saved training:', training.id);
    }
  } catch (error: any) {
    console.error('[Offline Storage] Failed to save training:', error);
    
    if (error.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please sync and clear old data.');
    }
    
    throw error;
  }
}

export async function getOfflineTrainings() {
  const db = await getDB();
  return await db.getAll('trainings');
}

export async function getOfflineTraining(id: string) {
  const db = await getDB();
  return await db.get('trainings', id);
}

export async function deleteOfflineTraining(id: string) {
  const db = await getDB();
  await db.delete('trainings', id);
}

export async function getUnsyncedTrainings(userId?: string) {
  const db = await getDB();
  const allTrainings = await db.getAll('trainings');
  let unsynced = allTrainings.filter(t => !t.synced_at || t.updated_at > t.synced_at);
  
  if (userId) {
    unsynced = unsynced.filter(t => t.inspector_id === userId);
  }
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Unsynced trainings:', {
      total: unsynced.length,
      userId: userId ? userId.substring(0, 8) + '...' : 'all',
    });
  }
  
  return unsynced;
}

export async function queueTrainingOperation(type: 'create' | 'update' | 'delete', trainingId: string, data: any) {
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
  
  const { registerInspectionSync } = await import('./background-sync');
  await registerInspectionSync();
}

export async function getQueuedTrainingOperations() {
  const db = await getDB();
  const operations = await db.getAll('training_operations');
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Queued training operations:', operations.length);
  }
  
  return operations;
}

export async function removeQueuedTrainingOperation(id: number) {
  const db = await getDB();
  await db.delete('training_operations', id);
  
  if (import.meta.env.DEV) {
    console.log('[Offline Storage] Removed queued training operation:', id);
  }
}

export async function incrementTrainingOperationRetry(id: number) {
  const db = await getDB();
  const operation = await db.get('training_operations', id);
  if (operation) {
    operation.retries += 1;
    await db.put('training_operations', operation);
  }
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
  data: any[] | any
) {
  const db = await getDB();
  const storeName = trainingStoreNameMap[type];
  
  const existingData = await getTrainingDataOffline(type, trainingId);
  for (const item of existingData) {
    await db.delete(storeName, item.id);
  }
  
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) {
    const dataWithTrainingId = {
      ...item,
      training_id: trainingId,
      id: item.id || `${trainingId}-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
    await db.put(storeName, dataWithTrainingId);
  }
  
  if (import.meta.env.DEV) {
    console.log(`[Offline Storage] Saved training ${type}:`, items.length, 'items');
  }
}

export async function getTrainingDataOffline(
  type: TrainingDataType,
  trainingId: string
): Promise<any[]> {
  const db = await getDB();
  const storeName = trainingStoreNameMap[type];
  const index = db.transaction(storeName).store.index('by-training');
  return await index.getAll(trainingId);
}

export async function clearTrainingDataOffline(
  type: TrainingDataType,
  trainingId: string
) {
  const db = await getDB();
  const storeName = trainingStoreNameMap[type];
  const existingData = await getTrainingDataOffline(type, trainingId);
  
  for (const item of existingData) {
    await db.delete(storeName, item.id);
  }
  
  if (import.meta.env.DEV) {
    console.log(`[Offline Storage] Cleared ${type} for training:`, trainingId);
  }
}
