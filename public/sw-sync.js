// Background Sync API handler for offline data synchronization with atomic operations

// Import shared DB config (set by db-config.js loaded before this script, or fallback)
var DB_NAME = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.name) || 'rope-works-inspections';
var DB_VERSION = (typeof DB_CONFIG !== 'undefined' && DB_CONFIG.version) || 8;

// Supabase config constants
var SUPABASE_URL = 'https://ssgzcgvygnsrqalisshx.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZ3pjZ3Z5Z25zcnFhbGlzc2h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzM5NjksImV4cCI6MjA3NzgwOTk2OX0.buTFy44tZdRIlRSFIm5BqeOGb4nX3ARuHawWA9hZN54';

/**
 * Extract the user's JWT access token from the Supabase auth session in localStorage.
 * Returns the access_token if valid (not expired), otherwise null.
 * The SW uses this instead of the anon key for Authorization: Bearer to pass RLS policies.
 */
function getUserAccessToken() {
  try {
    var session = self && typeof indexedDB !== 'undefined' ? null : null; // SW has no window
    // Service workers can access localStorage indirectly — but actually they CANNOT.
    // However, the main thread can pass the token via a message. For now, we read from
    // the clients and cache it, or use a fallback strategy.
    // 
    // Actually, Service Workers DO NOT have access to localStorage.
    // We need to request the token from the main thread via postMessage.
    return null;
  } catch (e) {
    return null;
  }
}

// Cache for the user's JWT token, received from the main thread
var cachedUserToken = null;
var cachedTokenExpiry = 0;

/**
 * Listen for auth token messages from the main thread.
 * The main thread sends the JWT whenever it refreshes the session.
 */
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'AUTH_TOKEN') {
    cachedUserToken = event.data.accessToken || null;
    cachedTokenExpiry = event.data.expiresAt || 0;
    console.log('[SW Auth] Received auth token from main thread, expires:', new Date(cachedTokenExpiry * 1000).toISOString());
  }
});

/**
 * Get the best available bearer token for Authorization header.
 * Prefers the user's JWT (for RLS), falls back to anon key.
 * Returns null if no valid token is available (should skip sync).
 */
function getBearerToken() {
  // Check if we have a cached user token that hasn't expired
  if (cachedUserToken && cachedTokenExpiry) {
    var nowSeconds = Math.floor(Date.now() / 1000);
    if (cachedTokenExpiry > nowSeconds + 30) { // 30s buffer
      return cachedUserToken;
    }
    console.warn('[SW Auth] Cached token expired, requesting refresh from main thread');
    // Request a fresh token from the main thread
    self.clients.matchAll().then(function(clients) {
      clients.forEach(function(client) {
        client.postMessage({ type: 'REQUEST_AUTH_TOKEN' });
      });
    });
    cachedUserToken = null;
    cachedTokenExpiry = 0;
  }
  
  // No valid user token — cannot authenticate as the user for RLS
  return null;
}

/**
 * Build standard headers for Supabase REST API requests.
 * Uses the user's JWT for Authorization to satisfy RLS policies.
 * Returns null if no valid auth token is available (sync should be skipped).
 */
function getAuthHeaders(contentType) {
  var bearerToken = getBearerToken();
  if (!bearerToken) {
    return null; // Signal to caller: skip this sync cycle
  }
  var headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + bearerToken
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  return headers;
}

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

// Verify that a fetch response returned at least 1 row.
// PostgREST returns 200 OK with [] when RLS blocks or record doesn't exist.
async function verifyResponseRows(response, context) {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${context}: HTTP ${response.status} — ${errorText}`);
  }
  const body = await response.json();
  if (Array.isArray(body) && body.length === 0) {
    throw new Error(`${context}: Server returned 200 OK but 0 rows affected (possible RLS block or missing record)`);
  }
  return body;
}

// SAFETY: Upsert related data using PostgREST merge-duplicates (never deletes)
async function upsertRelatedData(supabaseUrl, authHeaders, table, data) {
  if (!data || data.length === 0) {
    console.log(`[SW Upsert] Skipping ${table} -- empty array, preserving server data`);
    return true;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(data)
  });
  
  await verifyResponseRows(response, `Upsert ${table}`);
  return true;
}

// Sync inspection with all related data using upsert-only (no deletes)
async function syncInspectionWithTransaction(inspection, systems, ziplines, equipment, standards, summary) {
  const authHeaders = getAuthHeaders();
  if (!authHeaders) {
    console.warn('[SW Transaction] No valid auth token — skipping inspection sync');
    return false;
  }
  
  try {
    // Step 1: Upsert inspection data WITHOUT synced_at (deferred marking pattern)
    const inspData = { ...inspection };
    delete inspData.synced_at;
    
    const inspResponse = await fetch(`${SUPABASE_URL}/rest/v1/inspections`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(inspData)
    });
    
    await verifyResponseRows(inspResponse, 'Inspection parent upsert');
    
    // Step 2: Upsert all child data (NO deletes -- upsert-only for zero data loss)
    await Promise.all([
      upsertRelatedData(SUPABASE_URL, authHeaders, 'inspection_systems', systems),
      upsertRelatedData(SUPABASE_URL, authHeaders, 'inspection_ziplines', ziplines),
      upsertRelatedData(SUPABASE_URL, authHeaders, 'inspection_equipment', equipment),
      upsertRelatedData(SUPABASE_URL, authHeaders, 'inspection_standards', standards),
      summary ? upsertRelatedData(SUPABASE_URL, authHeaders, 'inspection_summary', [summary]) : Promise.resolve(true),
    ]);
    
    // Step 3: ONLY NOW mark as synced on the server (deferred synced_at)
    const now = new Date().toISOString();
    const syncStampResponse = await fetch(`${SUPABASE_URL}/rest/v1/inspections?id=eq.${inspection.id}`, {
      method: 'PATCH',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ synced_at: now, updated_at: now, last_sync_source: 'service_worker' })
    });
    
    await verifyResponseRows(syncStampResponse, 'Inspection sync stamp');
    
    // Step 4: Post-sync verification
    const verifyResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/inspections?id=eq.${inspection.id}&select=id,synced_at&synced_at=not.is.null`,
      {
        method: 'GET',
        headers: authHeaders
      }
    );
    const verifyRows = await verifyResponse.json();
    if (!Array.isArray(verifyRows) || verifyRows.length === 0) {
      throw new Error('Post-sync verification failed: record not found with synced_at on server');
    }
    
    return now;
    
  } catch (error) {
    console.error('[SW Transaction] Failed:', error);
    return false;
  }
}

// Sync inspections atomically
async function syncInspectionsAtomic() {
  console.log('[SW Atomic Sync] Starting atomic inspection sync...');
  
  try {
    const db = await openDB(DB_NAME, DB_VERSION);
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
        
        // SUSPICIOUS EMPTY GUARD: If record was edited but ALL child data is empty,
        // IndexedDB reads likely failed silently. Skip to prevent marking as complete.
        const localIsCompletelyEmpty = systems.length === 0 && ziplines.length === 0 && 
          equipment.length === 0 && standards.length === 0 && !summary;
        const createdAt = new Date(inspection.created_at || inspection.updated_at).getTime();
        const updatedAt = new Date(inspection.updated_at).getTime();
        const ageMinutes = (Date.now() - createdAt) / 60000;
        const wasEdited = (updatedAt - createdAt) > 60000;
        
        if (localIsCompletelyEmpty && wasEdited && ageMinutes > 5) {
          console.warn('[SW SAFETY] suspicious_empty_guard: inspection edited but all children empty', inspection.id);
          continue;
        }
        
        // Sync using upsert-only transaction (no deletes)
        const syncTimestamp = await syncInspectionWithTransaction(
          inspection, systems, ziplines, equipment, standards, summary
        );
        
        if (syncTimestamp) {
          // Align local timestamps: set both synced_at AND updated_at to match server
          // This prevents re-sync loops caused by updated_at > synced_at drift
          inspection.synced_at = syncTimestamp;
          inspection.updated_at = syncTimestamp;
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
  
  const authHeaders = getAuthHeaders();
  if (!authHeaders) {
    console.warn('[SW Sync] No valid auth token — skipping photo sync');
    return;
  }
  
  try {
    const db = await openDB(DB_NAME, DB_VERSION);
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
        // Upload to storage
        const fileExt = photo.fileName.split('.').pop();
        const fileName = `${photo.inspectionId}/${Date.now()}.${fileExt}`;
        
        const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/inspection-photos/${fileName}`, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': photo.blob.type
          },
          body: photo.blob
        });
        
        if (!uploadResponse.ok) {
          console.error('[SW Sync] Photo upload failed:', await uploadResponse.text());
          continue;
        }
        
        // Save metadata to database
        const metadataResponse = await fetch(`${SUPABASE_URL}/rest/v1/inspection_photos`, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            inspection_id: photo.inspectionId,
            photo_url: fileName,
            photo_section: photo.section
          })
        });
        
        if (metadataResponse.ok) {
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

// Sync trainings atomically (mirrors syncInspectionsAtomic pattern)
async function syncTrainingsAtomic() {
  console.log('[SW Atomic Sync] Starting atomic training sync...');
  
  const authHeaders = getAuthHeaders();
  if (!authHeaders) {
    console.warn('[SW Atomic Sync] No valid auth token — skipping training sync');
    return;
  }
  
  try {
    const db = await openDB(DB_NAME, DB_VERSION);
    const allTrainings = await getAllFromStore(db, 'trainings');
    const unsynced = allTrainings.filter(t => !t.synced_at || new Date(t.updated_at) > new Date(t.synced_at));
    
    console.log('[SW Atomic Sync] Found', unsynced.length, 'unsynced trainings');
    if (unsynced.length === 0) return;
    
    let syncedCount = 0;
    
    for (const training of unsynced) {
      try {
        const deliveryApproaches = await getAllRelatedData(db, 'training_delivery_approaches', training.id).catch(() => []);
        const operatingSystems = await getAllRelatedData(db, 'training_operating_systems', training.id).catch(() => []);
        const immediateAttention = await getAllRelatedData(db, 'training_immediate_attention', training.id).catch(() => []);
        const verifiableItems = await getAllRelatedData(db, 'training_verifiable_items', training.id).catch(() => []);
        const systemsInPlace = await getAllRelatedData(db, 'training_systems_in_place', training.id).catch(() => []);
        const summaryArray = await getAllRelatedData(db, 'training_summary', training.id).catch(() => []);
        
        const trainingChildEmpty = deliveryApproaches.length === 0 && operatingSystems.length === 0 && 
          immediateAttention.length === 0 && verifiableItems.length === 0 && 
          systemsInPlace.length === 0 && summaryArray.length === 0;
        const tCreatedAt = new Date(training.created_at || training.updated_at).getTime();
        const tUpdatedAt = new Date(training.updated_at).getTime();
        const tAgeMinutes = (Date.now() - tCreatedAt) / 60000;
        const tWasEdited = (tUpdatedAt - tCreatedAt) > 60000;
        
        if (trainingChildEmpty && tWasEdited && tAgeMinutes > 5) {
          console.warn('[SW SAFETY] suspicious_empty_guard: training edited but all children empty', training.id);
          continue;
        }
        
        const trainingData = { ...training };
        delete trainingData.synced_at;
        
        const response = await fetch(`${SUPABASE_URL}/rest/v1/trainings`, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify(trainingData)
        });
        
        await verifyResponseRows(response, 'Training parent upsert');
        
        await Promise.all([
          upsertRelatedData(SUPABASE_URL, authHeaders, 'training_delivery_approaches', deliveryApproaches),
          upsertRelatedData(SUPABASE_URL, authHeaders, 'training_operating_systems', operatingSystems),
          upsertRelatedData(SUPABASE_URL, authHeaders, 'training_immediate_attention', immediateAttention),
          upsertRelatedData(SUPABASE_URL, authHeaders, 'training_verifiable_items', verifiableItems),
          upsertRelatedData(SUPABASE_URL, authHeaders, 'training_systems_in_place', systemsInPlace),
          summaryArray.length > 0 ? upsertRelatedData(SUPABASE_URL, authHeaders, 'training_summary', summaryArray) : Promise.resolve(true),
        ]);
        
        const now = new Date().toISOString();
        const syncStampResponse = await fetch(`${SUPABASE_URL}/rest/v1/trainings?id=eq.${training.id}`, {
          method: 'PATCH',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({ synced_at: now, updated_at: now, last_sync_source: 'service_worker' })
        });
        
        await verifyResponseRows(syncStampResponse, 'Training sync stamp');
        
        const verifyResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/trainings?id=eq.${training.id}&select=id,synced_at&synced_at=not.is.null`,
          { method: 'GET', headers: authHeaders }
        );
        const verifyRows = await verifyResponse.json();
        if (!Array.isArray(verifyRows) || verifyRows.length === 0) {
          throw new Error('Post-sync verification failed: training not found with synced_at on server');
        }
        
        training.synced_at = now;
        training.updated_at = now;
        await updateInStore(db, 'trainings', training);
        syncedCount++;
        console.log('[SW Atomic Sync] Synced training:', training.id);
        
      } catch (error) {
        console.error('[SW Atomic Sync] Failed to sync training:', training.id, error);
      }
    }
    
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_COMPLETED', tag: 'training-sync', success: true, count: syncedCount });
    });
    
  } catch (error) {
    console.error('[SW Atomic Sync] Training sync failed:', error);
    throw error;
  }
}

// Sync daily assessments atomically (mirrors syncInspectionsAtomic pattern)
async function syncDailyAssessmentsAtomic() {
  console.log('[SW Atomic Sync] Starting atomic daily assessment sync...');
  
  try {
    const db = await openDB(DB_NAME, DB_VERSION);
    const allAssessments = await getAllFromStore(db, 'daily_assessments');
    const unsynced = allAssessments.filter(a => !a.synced_at || new Date(a.updated_at) > new Date(a.synced_at));
    
    console.log('[SW Atomic Sync] Found', unsynced.length, 'unsynced daily assessments');
    if (unsynced.length === 0) return;
    
    const supabaseUrl = 'https://ssgzcgvygnsrqalisshx.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZ3pjZ3Z5Z25zcnFhbGlzc2h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMzM5NjksImV4cCI6MjA3NzgwOTk2OX0.buTFy44tZdRIlRSFIm5BqeOGb4nX3ARuHawWA9hZN54';
    
    let syncedCount = 0;
    
    for (const assessment of unsynced) {
      try {
        // Gather child data
        const beginningOfDay = await getAllRelatedData(db, 'daily_assessment_beginning_of_day', assessment.id).catch(() => []);
        const endOfDay = await getAllRelatedData(db, 'daily_assessment_end_of_day', assessment.id).catch(() => []);
        const environmentChecks = await getAllRelatedData(db, 'daily_assessment_environment_checks', assessment.id).catch(() => []);
        const equipmentChecks = await getAllRelatedData(db, 'daily_assessment_equipment_checks', assessment.id).catch(() => []);
        const structureChecks = await getAllRelatedData(db, 'daily_assessment_structure_checks', assessment.id).catch(() => []);
        const operatingSystems = await getAllRelatedData(db, 'daily_assessment_operating_systems', assessment.id).catch(() => []);
        
        // SUSPICIOUS EMPTY GUARD for daily assessments
        const assessmentChildEmpty = beginningOfDay.length === 0 && endOfDay.length === 0 && 
          environmentChecks.length === 0 && equipmentChecks.length === 0 && 
          structureChecks.length === 0 && operatingSystems.length === 0;
        const aCreatedAt = new Date(assessment.created_at || assessment.updated_at).getTime();
        const aUpdatedAt = new Date(assessment.updated_at).getTime();
        const aAgeMinutes = (Date.now() - aCreatedAt) / 60000;
        const aWasEdited = (aUpdatedAt - aCreatedAt) > 60000;
        
        if (assessmentChildEmpty && aWasEdited && aAgeMinutes > 5) {
          console.warn('[SW SAFETY] suspicious_empty_guard: assessment edited but all children empty', assessment.id);
          continue;
        }
        
        // Step 1: Upsert assessment WITHOUT synced_at (deferred marking)
        // Uses POST + merge-duplicates instead of PATCH to handle offline-created records
        const assessmentData = { ...assessment };
        delete assessmentData.synced_at;
        
        const response = await fetch(`${supabaseUrl}/rest/v1/daily_assessments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify(assessmentData)
        });
        
        await verifyResponseRows(response, 'Assessment parent upsert');
        
        // Step 2: Upsert all children (no deletes)
        await Promise.all([
          upsertRelatedData(supabaseUrl, supabaseKey, 'daily_assessment_beginning_of_day', beginningOfDay),
          upsertRelatedData(supabaseUrl, supabaseKey, 'daily_assessment_end_of_day', endOfDay),
          upsertRelatedData(supabaseUrl, supabaseKey, 'daily_assessment_environment_checks', environmentChecks),
          upsertRelatedData(supabaseUrl, supabaseKey, 'daily_assessment_equipment_checks', equipmentChecks),
          upsertRelatedData(supabaseUrl, supabaseKey, 'daily_assessment_structure_checks', structureChecks),
          upsertRelatedData(supabaseUrl, supabaseKey, 'daily_assessment_operating_systems', operatingSystems),
        ]);
        
        // Step 3: NOW mark as synced (deferred synced_at)
        const now = new Date().toISOString();
        const syncStampResponse = await fetch(`${supabaseUrl}/rest/v1/daily_assessments?id=eq.${assessment.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({ synced_at: now, updated_at: now, last_sync_source: 'service_worker' })
        });
        
        await verifyResponseRows(syncStampResponse, 'Assessment sync stamp');
        
        // Step 4: Post-sync verification
        const verifyResponse = await fetch(
          `${supabaseUrl}/rest/v1/daily_assessments?id=eq.${assessment.id}&select=id,synced_at&synced_at=not.is.null`,
          {
            method: 'GET',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          }
        );
        const verifyRows = await verifyResponse.json();
        if (!Array.isArray(verifyRows) || verifyRows.length === 0) {
          throw new Error('Post-sync verification failed: assessment not found with synced_at on server');
        }
        
        // Align local timestamps
        assessment.synced_at = now;
        assessment.updated_at = now;
        await updateInStore(db, 'daily_assessments', assessment);
        syncedCount++;
        console.log('[SW Atomic Sync] Synced assessment:', assessment.id);
        
      } catch (error) {
        console.error('[SW Atomic Sync] Failed to sync assessment:', assessment.id, error);
      }
    }
    
    // Notify clients
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETED',
        tag: 'assessment-sync',
        success: true,
        count: syncedCount
      });
    });
    
  } catch (error) {
    console.error('[SW Atomic Sync] Assessment sync failed:', error);
    throw error;
  }
}

// Handle sync events
self.addEventListener('sync', async (event) => {
  console.log('[SW Sync] Sync event triggered:', event.tag);
  
  if (event.tag === 'inspection-sync') {
    event.waitUntil(syncInspectionsAtomic());
  } else if (event.tag === 'photo-sync') {
    event.waitUntil(syncPhotos());
  } else if (event.tag === 'training-sync') {
    event.waitUntil(syncTrainingsAtomic());
  } else if (event.tag === 'assessment-sync') {
    event.waitUntil(syncDailyAssessmentsAtomic());
  }
});

// Handle periodic sync events (for multi-device scenarios)
self.addEventListener('periodicsync', async (event) => {
  console.log('[SW Sync] Periodic sync event:', event.tag);
  
  if (event.tag === 'periodic-inspection-sync') {
    event.waitUntil(
      Promise.all([
        syncInspectionsAtomic(),
        syncPhotos(),
        syncTrainingsAtomic(),
        syncDailyAssessmentsAtomic()
      ])
    );
  }
});

console.log('[SW Sync] Background sync worker with upsert-only operations loaded (inspections, trainings, assessments)');
