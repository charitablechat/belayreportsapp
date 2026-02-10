/**
 * Offline Authentication Module
 * 
 * Enables "trust then verify" offline sign-in:
 * 1. Users can sign in while offline with email/password
 * 2. A synthetic session is created in localStorage
 * 3. Credentials are stored temporarily in IndexedDB
 * 4. When online, credentials are verified with the backend
 * 5. If userId differs, all IndexedDB records are migrated
 */

import { openDB } from 'idb';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const OFFLINE_AUTH_DB = 'offline-auth-store';
const OFFLINE_AUTH_DB_VERSION = 1;
const SESSION_STORAGE_KEY = 'sb-ssgzcgvygnsrqalisshx-auth-token';

interface OfflineAuthDB {
  user_mappings: {
    key: string; // email (lowercased)
    value: {
      email: string;
      userId: string;
      savedAt: number;
    };
  };
  pending_credentials: {
    key: string; // 'pending'
    value: {
      id: string;
      email: string;
      encryptedPassword: string;
      syntheticUserId: string;
      createdAt: number;
    };
  };
}

/**
 * Open the offline auth IndexedDB (separate from main app DB to avoid version conflicts)
 */
async function getAuthDB() {
  return openDB<OfflineAuthDB>(OFFLINE_AUTH_DB, OFFLINE_AUTH_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('user_mappings')) {
        db.createObjectStore('user_mappings', { keyPath: 'email' });
      }
      if (!db.objectStoreNames.contains('pending_credentials')) {
        db.createObjectStore('pending_credentials', { keyPath: 'id' });
      }
    },
  });
}

/**
 * Generate a deterministic UUID from an email address using SHA-256.
 * Ensures the same email always produces the same userId across sessions.
 */
async function generateDeterministicUserId(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  
  // Format as UUID v4-like string (but deterministic)
  const hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Simple obfuscation for stored password (not true encryption, but better than plaintext).
 * Uses base64 encoding with a simple XOR against email bytes.
 */
function obfuscatePassword(password: string, email: string): string {
  const emailBytes = new TextEncoder().encode(email.toLowerCase());
  const passBytes = new TextEncoder().encode(password);
  const result = new Uint8Array(passBytes.length);
  
  for (let i = 0; i < passBytes.length; i++) {
    result[i] = passBytes[i] ^ emailBytes[i % emailBytes.length];
  }
  
  return btoa(String.fromCharCode(...result));
}

/**
 * Deobfuscate a stored password
 */
function deobfuscatePassword(obfuscated: string, email: string): string {
  const emailBytes = new TextEncoder().encode(email.toLowerCase());
  const decoded = atob(obfuscated);
  const bytes = new Uint8Array(decoded.length);
  
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i) ^ emailBytes[i % emailBytes.length];
  }
  
  return new TextDecoder().decode(bytes);
}

// ==================== PUBLIC API ====================

/**
 * Save email-to-userId mapping. Called on every successful online sign-in.
 * This enables returning users to get their REAL userId when signing in offline.
 */
export async function saveUserMapping(email: string, userId: string): Promise<void> {
  try {
    const db = await getAuthDB();
    await db.put('user_mappings', {
      email: email.toLowerCase().trim(),
      userId,
      savedAt: Date.now(),
    });
    
    if (import.meta.env.DEV) {
      console.log('[OfflineAuth] Saved user mapping for', email);
    }
  } catch (error) {
    // Non-critical - just means offline sign-in might need migration later
    console.warn('[OfflineAuth] Failed to save user mapping:', error);
  }
}

/**
 * Look up a previously-cached real user ID for the given email.
 * Returns null for brand-new users who have never signed in on this device.
 */
export async function getStoredUserId(email: string): Promise<string | null> {
  try {
    const db = await getAuthDB();
    const mapping = await db.get('user_mappings', email.toLowerCase().trim());
    return mapping?.userId || null;
  } catch (error) {
    console.warn('[OfflineAuth] Failed to get stored userId:', error);
    return null;
  }
}

/**
 * Create an offline session. The main offline sign-in function.
 * 
 * 1. Looks up cached real userId for this email (from previous online login)
 * 2. If found, uses the real userId (no migration needed later)
 * 3. If not, generates a deterministic UUID from email hash
 * 4. Stores credentials for deferred verification
 * 5. Creates synthetic session in localStorage
 */
export async function createOfflineSession(email: string, password: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  
  // Try to get the real userId from a previous login
  let userId = await getStoredUserId(normalizedEmail);
  let isRealUserId = !!userId;
  
  if (!userId) {
    // Generate deterministic userId from email
    userId = await generateDeterministicUserId(normalizedEmail);
    isRealUserId = false;
    
    if (import.meta.env.DEV) {
      console.log('[OfflineAuth] Generated deterministic userId for', normalizedEmail);
    }
  } else if (import.meta.env.DEV) {
    console.log('[OfflineAuth] Using cached real userId for', normalizedEmail);
  }
  
  // Store credentials for deferred verification
  try {
    const db = await getAuthDB();
    await db.put('pending_credentials', {
      id: 'pending',
      email: normalizedEmail,
      encryptedPassword: obfuscatePassword(password, normalizedEmail),
      syntheticUserId: userId,
      createdAt: Date.now(),
    });
  } catch (error) {
    console.warn('[OfflineAuth] Failed to store credentials:', error);
    // Continue anyway - user can still work offline, just won't auto-verify
  }
  
  // Create synthetic session in localStorage (matches Supabase session format)
  const syntheticSession = {
    access_token: 'offline_placeholder_token',
    refresh_token: 'offline_placeholder',
    expires_at: 9999999999,
    token_type: 'bearer',
    user: {
      id: userId,
      email: normalizedEmail,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
  };
  
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(syntheticSession));
  localStorage.setItem('offline_auth_pending', 'true');
  
  if (import.meta.env.DEV) {
    console.log('[OfflineAuth] Synthetic session created', { email: normalizedEmail, userId, isRealUserId });
  }
}

/**
 * Check if there are unverified offline credentials pending verification.
 */
export function hasPendingOfflineAuth(): boolean {
  return localStorage.getItem('offline_auth_pending') === 'true';
}

/**
 * Verify stored offline credentials with the backend when connectivity returns.
 * 
 * On success: Real session replaces synthetic, data migrated if needed, credentials cleared.
 * On failure: User warned, data preserved, credentials cleared.
 */
export async function verifyAndReconcileOfflineAuth(): Promise<boolean> {
  if (!hasPendingOfflineAuth()) return false;
  if (!navigator.onLine) return false;
  
  try {
    const db = await getAuthDB();
    const pending = await db.get('pending_credentials', 'pending');
    
    if (!pending) {
      // No credentials stored - just clear the flag
      localStorage.removeItem('offline_auth_pending');
      return false;
    }
    
    const { email, encryptedPassword, syntheticUserId } = pending;
    const password = deobfuscatePassword(encryptedPassword, email);
    
    if (import.meta.env.DEV) {
      console.log('[OfflineAuth] Verifying credentials for', email);
    }
    
    // Attempt real sign-in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error || !data.user) {
      console.warn('[OfflineAuth] Credential verification failed:', error?.message);
      toast.error('Could not verify your offline credentials. Please sign in again when online.', {
        duration: 10000,
      });
      
      // Clear pending flag but DON'T destroy data
      localStorage.removeItem('offline_auth_pending');
      await db.delete('pending_credentials', 'pending');
      return false;
    }
    
    // Success! Real session is now active (Supabase client handles this automatically)
    const realUserId = data.user.id;
    
    if (import.meta.env.DEV) {
      console.log('[OfflineAuth] Verification successful', { realUserId, syntheticUserId });
    }
    
    // Save mapping for future offline logins
    await saveUserMapping(email, realUserId);
    
    // Migrate data if userId changed
    if (realUserId !== syntheticUserId) {
      console.log('[OfflineAuth] UserId changed, migrating data...', {
        from: syntheticUserId,
        to: realUserId,
      });
      await migrateUserData(syntheticUserId, realUserId);
      toast.success('Your offline data has been linked to your account.');
    } else {
      toast.success('Offline credentials verified successfully.');
    }
    
    // Clean up
    localStorage.removeItem('offline_auth_pending');
    await db.delete('pending_credentials', 'pending');
    
    return true;
  } catch (error) {
    console.error('[OfflineAuth] Error during verification:', error);
    localStorage.removeItem('offline_auth_pending');
    return false;
  }
}

/**
 * Migrate all IndexedDB records from one userId to another.
 * Updates inspector_id fields across all stores.
 */
async function migrateUserData(oldUserId: string, newUserId: string): Promise<void> {
  try {
    // Import getDB dynamically to avoid circular dependency
    const { getDB } = await import('./offline-storage');
    const db = await getDB();
    
    const storesToMigrate = [
      { name: 'inspections' as const, idField: 'inspector_id' },
      { name: 'trainings' as const, idField: 'inspector_id' },
      { name: 'daily_assessments' as const, idField: 'inspector_id' },
    ];
    
    let totalMigrated = 0;
    
    for (const { name, idField } of storesToMigrate) {
      try {
        const tx = db.transaction(name, 'readwrite');
        const store = tx.objectStore(name);
        const allRecords = await store.getAll();
        
        for (const record of allRecords) {
          if (record[idField] === oldUserId) {
            record[idField] = newUserId;
            await store.put(record);
            totalMigrated++;
          }
        }
        
        await tx.done;
      } catch (storeError) {
        console.warn(`[OfflineAuth] Failed to migrate store ${name}:`, storeError);
      }
    }
    
    if (import.meta.env.DEV) {
      console.log(`[OfflineAuth] Migrated ${totalMigrated} records from ${oldUserId} to ${newUserId}`);
    }
  } catch (error) {
    console.error('[OfflineAuth] Data migration failed:', error);
    // Don't throw - data is still accessible, just under the old userId
  }
}

/**
 * Clear offline auth state. Called on sign-out.
 */
export async function clearOfflineAuth(): Promise<void> {
  localStorage.removeItem('offline_auth_pending');
  
  try {
    const db = await getAuthDB();
    await db.delete('pending_credentials', 'pending');
  } catch (error) {
    // Non-critical
    console.warn('[OfflineAuth] Failed to clear credentials:', error);
  }
}
