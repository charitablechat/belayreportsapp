import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface InspectionDB extends DBSchema {
  inspections: {
    key: string;
    value: any;
    indexes: { 'by-status': string };
  };
}

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;

export async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<InspectionDB>('rope-works-inspections', 1, {
      upgrade(db) {
        const inspectionStore = db.createObjectStore('inspections', {
          keyPath: 'id',
        });
        inspectionStore.createIndex('by-status', 'status');
      },
    });
  }
  return dbPromise;
}

export async function saveInspectionOffline(inspection: any) {
  const db = await getDB();
  await db.put('inspections', inspection);
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
  const inspections = await db.getAllFromIndex('inspections', 'by-status', 'completed');
  return inspections.filter(i => !i.synced_at);
}
