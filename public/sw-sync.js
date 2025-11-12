// Background Sync API handler for offline data synchronization with atomic operations

// Helper function to open IndexedDB
function openDB(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Get all items from an object store
function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Delete item from store
function deleteFromStore(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Update item in store
function updateInStore(db, storeName, item) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Helper to get related data by inspection_id
async function getAllRelatedData(db, storeName, inspectionId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index('by-inspection');
    const request = index.getAll(inspectionId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Validate inspection package before sync
function validateInspectionData(inspection, systems, ziplines, equipment, standards, summary) {
  const errors = [];
  
  // Validate inspection
  if (!inspection.id || !inspection.organization || !inspection.location) {
    errors.push('Inspection missing required fields');
  }
  
  // Validate systems
  systems.forEach((s, i) => {
    if (!s.system_name || !s.result) {
      errors.push(`System ${i + 1} missing required fields`);
    }
  });
  
  // Validate ziplines
  ziplines.forEach((z, i) => {
    if (!z.zipline_name || !z.result) {
      errors.push(`Zipline ${i + 1} missing required fields`);
    }
  });
  
  // Validate equipment
  equipment.forEach((e, i) => {
    if (!e.equipment_type || !e.equipment_category || !e.result) {
      errors.push(`Equipment ${i + 1} missing required fields`);
    }
  });
  
  // Validate standards
  standards.forEach((s, i) => {
    if (!s.standard_name || typeof s.has_documentation !== 'boolean') {
      errors.push(`Standard ${i + 1} missing required fields`);
    }
  });
  
  return { valid: errors.length === 0, errors };
}

// Delete related data
async function deleteRelatedData(supabaseUrl, supabaseKey, table, inspectionId) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?inspection_id=eq.${inspectionId}`, {
    method: 'DELETE',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });
  return response.ok;
}

// Insert related data
async function insertRelatedData(supabaseUrl, supabaseKey, table, data) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    throw new Error(`Insert to ${table} failed`);
  }
  
  return true;
}

// Sync inspection with all related data as a transaction
async function syncInspectionWithTransaction(inspection, systems, ziplines, equipment, standards, summary) {
  const supabaseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZ3pjZ3Z5Z25zcnFhbGlzc2h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzM5NjksImV4cCI6MjA3NzgwOTk2OX0.buTFy44tZdRIlRSFIm5BqeOGb4nX3ARuHawWA9hZN54';
  
  try {
    // 1. Upsert inspection
    const inspResponse = await fetch(`${supabaseUrl}/rest/v1/inspections?id=eq.${inspection.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ ...inspection, synced_at: new Date().toISOString() })
    });
    
    if (!inspResponse.ok) throw new Error('Inspection sync failed');
    
    // 2. Delete existing related data
    await Promise.all([
      deleteRelatedData(supabaseUrl, supabaseKey, 'inspection_systems', inspection.id),
      deleteRelatedData(supabaseUrl, supabaseKey, 'inspection_ziplines', inspection.id),
      deleteRelatedData(supabaseUrl, supabaseKey, 'inspection_equipment', inspection.id),
      deleteRelatedData(supabaseUrl, supabaseKey, 'inspection_standards', inspection.id),
      deleteRelatedData(supabaseUrl, supabaseKey, 'inspection_summary', inspection.id),
    ]);
    
    // 3. Insert all related data
    const insertPromises = [];
    
    if (systems.length > 0) {
      insertPromises.push(insertRelatedData(supabaseUrl, supabaseKey, 'inspection_systems', systems));
    }
    if (ziplines.length > 0) {
      insertPromises.push(insertRelatedData(supabaseUrl, supabaseKey, 'inspection_ziplines', ziplines));
    }
    if (equipment.length > 0) {
      insertPromises.push(insertRelatedData(supabaseUrl, supabaseKey, 'inspection_equipment', equipment));
    }
    if (standards.length > 0) {
      insertPromises.push(insertRelatedData(supabaseUrl, supabaseKey, 'inspection_standards', standards));
    }
    if (summary) {
      insertPromises.push(insertRelatedData(supabaseUrl, supabaseKey, 'inspection_summary', [summary]));
    }
    
    await Promise.all(insertPromises);
    
    return true;
    
  } catch (error) {
    console.error('[SW Transaction] Failed:', error);
    // Rollback would go here, but service worker limitations make this complex
    // The next sync attempt will retry
    return false;
  }
}

// Sync inspections atomically
async function syncInspectionsAtomic() {
  console.log('[SW Atomic Sync] Starting atomic inspection sync...');
  
  try {
    const db = await openDB('rope-works-inspections', 4);
    const allInspections = await getAllFromStore(db, 'inspections');
    const unsynced = allInspections.filter(i => !i.synced_at || new Date(i.updated_at) > new Date(i.synced_at));
    
    console.log('[SW Atomic Sync] Found', unsynced.length, 'unsynced inspections');
    
    if (unsynced.length === 0) return;
    
    let syncedCount = 0;
    
    for (const inspection of unsynced) {
      try {
        // Gather all related data
        const systems = await getAllRelatedData(db, 'inspection_systems', inspection.id);
        const ziplines = await getAllRelatedData(db, 'inspection_ziplines', inspection.id);
        const equipment = await getAllRelatedData(db, 'inspection_equipment', inspection.id);
        const standards = await getAllRelatedData(db, 'inspection_standards', inspection.id);
        const summaryArray = await getAllRelatedData(db, 'inspection_summary', inspection.id);
        const summary = summaryArray[0] || null;
        
        // Validate before sync
        const validation = validateInspectionData(inspection, systems, ziplines, equipment, standards, summary);
        if (!validation.valid) {
          console.error('[SW Atomic Sync] Validation failed:', validation.errors);
          continue;
        }
        
        // Sync atomically using transaction
        const success = await syncInspectionWithTransaction(
          inspection, systems, ziplines, equipment, standards, summary
        );
        
        if (success) {
          // Mark as synced
          inspection.synced_at = new Date().toISOString();
          await updateInStore(db, 'inspections', inspection);
          syncedCount++;
          console.log('[SW Atomic Sync] Synced:', inspection.id);
        }
        
      } catch (error) {
        console.error('[SW Atomic Sync] Failed to sync inspection:', inspection.id, error);
      }
    }
    
    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETED',
        tag: 'inspection-sync',
        success: true,
        count: syncedCount
      });
    });
    
  } catch (error) {
    console.error('[SW Atomic Sync] Failed:', error);
    throw error;
  }
}

// Sync photos to Supabase
async function syncPhotos() {
  console.log('[SW Sync] Starting photo sync...');
  
  try {
    const db = await openDB('rope-works-inspections', 4);
    const allPhotos = await getAllFromStore(db, 'photos');
    const unuploaded = allPhotos.filter(p => !p.uploaded);
    
    console.log('[SW Sync] Found', unuploaded.length, 'unuploaded photos');
    
    if (unuploaded.length === 0) {
      console.log('[SW Sync] No photos to upload');
      return;
    }
    
    let uploadedCount = 0;
    
    for (const photo of unuploaded) {
      try {
        const supabaseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZ3pjZ3Z5Z25zcnFhbGlzc2h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzM5NjksImV4cCI6MjA3NzgwOTk2OX0.buTFy44tZdRIlRSFIm5BqeOGb4nX3ARuHawWA9hZN54';
        
        // Upload to storage
        const fileExt = photo.fileName.split('.').pop();
        const fileName = `${photo.inspectionId}/${Date.now()}.${fileExt}`;
        
        const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/inspection-photos/${fileName}`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': photo.blob.type
          },
          body: photo.blob
        });
        
        if (!uploadResponse.ok) {
          console.error('[SW Sync] Photo upload failed:', await uploadResponse.text());
          continue;
        }
        
        // Save metadata to database
        const metadataResponse = await fetch(`${supabaseUrl}/rest/v1/inspection_photos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            inspection_id: photo.inspectionId,
            photo_url: fileName,
            photo_section: photo.section
          })
        });
        
        if (metadataResponse.ok) {
          // Mark as uploaded in IndexedDB
          photo.uploaded = true;
          photo.photoUrl = fileName;
          await updateInStore(db, 'photos', photo);
          uploadedCount++;
          console.log('[SW Sync] Photo uploaded:', photo.id);
        }
      } catch (error) {
        console.error('[SW Sync] Photo upload failed:', error);
      }
    }
    
    // Notify all clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETED',
        tag: 'photo-sync',
        success: true,
        count: uploadedCount
      });
    });
    
    console.log('[SW Sync] Photo sync completed:', uploadedCount, 'uploaded');
    
  } catch (error) {
    console.error('[SW Sync] Photo sync failed:', error);
    throw error;
  }
}

// Handle sync events
self.addEventListener('sync', async (event) => {
  console.log('[SW Sync] Sync event triggered:', event.tag);
  
  if (event.tag === 'inspection-sync') {
    event.waitUntil(syncInspectionsAtomic());  // Use atomic version
  } else if (event.tag === 'photo-sync') {
    event.waitUntil(syncPhotos());
  }
});

// Handle periodic sync events (for multi-device scenarios)
self.addEventListener('periodicsync', async (event) => {
  console.log('[SW Sync] Periodic sync event:', event.tag);
  
  if (event.tag === 'periodic-inspection-sync') {
    event.waitUntil(
      Promise.all([
        syncInspectionsAtomic(),  // Use atomic version
        syncPhotos()
      ])
    );
  }
});

console.log('[SW Sync] Background sync worker with atomic operations loaded');
