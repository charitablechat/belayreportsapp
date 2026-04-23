/**
 * Phase 4a — Token encryption at rest.
 *
 * Generates a non-extractable AES-GCM 256 key on first use and persists the
 * `CryptoKey` handle in IndexedDB. The raw key bytes never leave the browser's
 * keystore — only the handle is stored, and `extractable: false` means even
 * `crypto.subtle.exportKey()` will refuse.
 *
 * Used by `auth-resilience.ts` to encrypt credential payloads before they hit
 * the redundant slot store. Reads transparently decrypt; payloads written by
 * older builds (plaintext JSON) are detected by shape and re-encrypted on the
 * next write — see `decryptFromStorage` for the migration path.
 *
 * SAFETY: every public helper is no-throw. If SubtleCrypto is unavailable
 * (very old browsers, insecure context), the helpers fall back to passthrough
 * so the offline-auth layer above keeps working — just without at-rest
 * encryption. This degrades gracefully rather than locking the user out.
 */
import { openDB, type IDBPDatabase } from 'idb';

const KEY_DB_NAME = 'auth-crypto-keystore';
const KEY_DB_VERSION = 1;
const KEY_STORE = 'keys';
const KEY_ID = 'auth-aes-gcm-v1';

const ENCRYPTED_PREFIX = 'enc:v1:';
const IV_BYTES = 12; // 96-bit IV is the AES-GCM standard.

let cachedKey: CryptoKey | null = null;
let keyPromise: Promise<CryptoKey | null> | null = null;

let dbPromise: Promise<IDBPDatabase> | null = null;
function getKeyDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(KEY_DB_NAME, KEY_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          db.createObjectStore(KEY_STORE);
        }
      },
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function hasSubtleCrypto(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

/**
 * Get-or-create the device AES-GCM key. The key is generated with
 * `extractable: false` so it stays inside the browser's keystore for life.
 */
export async function getOrCreateAuthKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  if (keyPromise) return keyPromise;
  if (!hasSubtleCrypto()) return null;

  keyPromise = (async () => {
    try {
      const db = await getKeyDB();
      const existing = (await db.get(KEY_STORE, KEY_ID)) as CryptoKey | undefined;
      if (existing) {
        cachedKey = existing;
        return existing;
      }

      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // extractable — false keeps key material inside the keystore
        ['encrypt', 'decrypt']
      );
      try {
        const tx = db.transaction(KEY_STORE, 'readwrite');
        await tx.objectStore(KEY_STORE).put(key, KEY_ID);
        await tx.done;
      } catch {
        // If the key can't be persisted we still cache it for this session —
        // worst case is a re-generation on next boot.
      }
      cachedKey = key;
      return key;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[AuthCrypto] Failed to get/create key:', err);
      }
      return null;
    } finally {
      // Allow re-entry on next call if we returned null.
      if (!cachedKey) keyPromise = null;
    }
  })();

  return keyPromise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when the value is a string produced by `encryptForStorage`. */
export function isEncryptedPayload(s: unknown): s is string {
  return typeof s === 'string' && s.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypt a UTF-8 plaintext (typically a JSON string) and return a tagged
 * string of the form `enc:v1:<iv-b64>:<ciphertext-b64>`. If crypto is
 * unavailable, returns the plaintext unchanged so callers can transparently
 * keep working — the lack of prefix signals "not encrypted".
 */
export async function encryptForStorage(plaintext: string): Promise<string> {
  const key = await getOrCreateAuthKey();
  if (!key || !hasSubtleCrypto()) return plaintext;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = new TextEncoder().encode(plaintext);
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return `${ENCRYPTED_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipherBuf))}`;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[AuthCrypto] encrypt failed, falling back to plaintext:', err);
    }
    return plaintext;
  }
}

/**
 * Reverse of `encryptForStorage`. Tagged ciphertexts are decrypted; values
 * without the prefix are returned unchanged so legacy plaintext payloads
 * (written before Phase 4) keep working — they get re-encrypted on the next
 * write.
 *
 * Returns `null` when the value looks encrypted but decryption fails (key
 * mismatch / tampering) — caller should treat as damaged.
 */
export async function decryptFromStorage(stored: string): Promise<string | null> {
  if (!isEncryptedPayload(stored)) return stored; // legacy plaintext passthrough
  const body = stored.slice(ENCRYPTED_PREFIX.length);
  const sepIdx = body.indexOf(':');
  if (sepIdx < 0) return null;
  const ivB64 = body.slice(0, sepIdx);
  const cipherB64 = body.slice(sepIdx + 1);

  const key = await getOrCreateAuthKey();
  if (!key || !hasSubtleCrypto()) return null;
  try {
    const iv = base64ToBytes(ivB64);
    const cipher = base64ToBytes(cipherB64);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipher as BufferSource
    );
    return new TextDecoder().decode(plain);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[AuthCrypto] decrypt failed:', err);
    }
    return null;
  }
}
