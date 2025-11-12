// Background Sync API handler for offline data synchronization

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

// Sync inspections to Supabase
async function syncInspections() {
  console.log('[SW Sync] Starting inspection sync...');
  
  try {
    const db = await openDB('rope-works-inspections', 4);
    
    // Get queued operations
    const operations = await getAllFromStore(db, 'operations');
    
    // Get unsynced inspections
    const allInspections = await getAllFromStore(db, 'inspections');
    const unsynced = allInspections.filter(i => !i.synced_at || new Date(i.updated_at) > new Date(i.synced_at));
    
    console.log('[SW Sync] Found:', operations.length, 'operations,', unsynced.length, 'unsynced inspections');
    
    if (operations.length === 0 && unsynced.length === 0) {
      console.log('[SW Sync] Nothing to sync');
      return;
    }
    
    // Process each operation
    for (const op of operations) {
      try {
        const supabaseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZ3pjZ3Z5Z25zcnFhbGlzc2h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzM5NjksImV4cCI6MjA3NzgwOTk2OX0.buTFy44tZdRIlRSFIm5BqeOGb4nX3ARuHawWA9hZN54';
        
        let endpoint = `${supabaseUrl}/rest/v1/inspections`;
        let method = 'POST';
        
        if (op.type === 'update') {
          endpoint += `?id=eq.${op.inspectionId}`;
          method = 'PATCH';
        } else if (op.type === 'delete') {
          endpoint += `?id=eq.${op.inspectionId}`;
          method = 'DELETE';
        }
        
        const response = await fetch(endpoint, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=representation'
          },
          body: op.type !== 'delete' ? JSON.stringify(op.data) : undefined
        });
        
        if (response.ok) {
          // Remove operation from queue
          await deleteFromStore(db, 'operations', op.id);
          console.log('[SW Sync] Operation completed:', op.type, op.inspectionId);
        }
      } catch (error) {
        console.error('[SW Sync] Operation failed:', error);
      }
    }
    
    // Sync unsynced inspections
    for (const inspection of unsynced) {
      try {
        const supabaseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZ3pjZ3Z5Z25zcnFhbGlzc2h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzM5NjksImV4cCI6MjA3NzgwOTk2OX0.buTFy44tZdRIlRSFIm5BqeOGb4nX3ARuHawWA9hZN54';
        
        const response = await fetch(`${supabaseUrl}/rest/v1/inspections?id=eq.${inspection.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            ...inspection,
            synced_at: new Date().toISOString()
          })
        });
        
        if (response.ok) {
          // Update local inspection with sync timestamp
          inspection.synced_at = new Date().toISOString();
          await updateInStore(db, 'inspections', inspection);
          console.log('[SW Sync] Inspection synced:', inspection.id);
        }
      } catch (error) {
        console.error('[SW Sync] Inspection sync failed:', error);
      }
    }
    
    // Notify all clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETED',
        tag: 'inspection-sync',
        success: true,
        count: operations.length + unsynced.length
      });
    });
    
    console.log('[SW Sync] Inspection sync completed');
    
  } catch (error) {
    console.error('[SW Sync] Inspection sync failed:', error);
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
    event.waitUntil(syncInspections());
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
        syncInspections(),
        syncPhotos()
      ])
    );
  }
});

console.log('[SW Sync] Background sync worker loaded');
