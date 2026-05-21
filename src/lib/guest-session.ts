/**
 * Guest Session — offline-only, local-only identity.
 *
 * For users who land on a device with no captured offline credentials and
 * no internet. Lets them open the app, take inspections, and store work in
 * IndexedDB under a synthetic "guest-…" user-id.
 *
 * Hard rules (enforced elsewhere — see references below):
 *   1. Guest sessions MUST NOT transmit anything to Supabase.
 *      - `assertRealSessionForSync` rejects on `id.startsWith('guest-')`.
 *      - `safeFunctionsInvoke` refuses to invoke edge functions as guest.
 *   2. Guest data is migrated to a real user only via the explicit
 *      claim flow (`guest-claim.ts`) after a successful online sign-in.
 *   3. Guest sessions are accepted by RequireAuth only while offline. On
 *      reconnect the guard redirects to the sign-in screen so the user can
 *      claim or discard the work.
 *
 * Storage durability
 * ------------------
 * Guest identity is mirrored to IndexedDB (`auth_meta` store, key
 * `guest_session`) in addition to localStorage. Some installed-PWA
 * contexts on iOS evict localStorage more aggressively than IDB, and
 * IDB is what holds the guest-owned reports/photos anyway — keeping
 * the identity beside the data prevents an orphaned-data scenario.
 *
 * On read we prefer IDB; if IDB is unavailable we fall back to
 * localStorage. On write we attempt both; either succeeding is fine.
 */

const GUEST_SESSION_KEY = "guest_session";
const IDB_DB_NAME = "auth_meta";
const IDB_STORE_NAME = "auth_meta";
const IDB_DB_VERSION = 1;

export interface GuestSession {
  id: string; // Always starts with `guest-`
  email: null;
  isGuest: true;
  createdAt: number;
}

export function isGuestUserId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("guest-");
}

// ---- IDB helpers (best-effort, never throw) ------------------------------

function openAuthMetaDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readGuestSessionFromIdb(): Promise<GuestSession | null> {
  const db = await openAuthMetaDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(GUEST_SESSION_KEY);
      req.onsuccess = () => {
        const v = req.result;
        if (
          v &&
          typeof v === "object" &&
          typeof (v as GuestSession).id === "string" &&
          (v as GuestSession).isGuest === true
        ) {
          resolve(v as GuestSession);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      try {
        db.close();
      } catch {
        /* noop */
      }
    }
  });
}

async function writeGuestSessionToIdb(session: GuestSession): Promise<void> {
  const db = await openAuthMetaDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(session, GUEST_SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  try {
    db.close();
  } catch {
    /* noop */
  }
}

async function clearGuestSessionFromIdb(): Promise<void> {
  const db = await openAuthMetaDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).delete(GUEST_SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  try {
    db.close();
  } catch {
    /* noop */
  }
}

// ---- Public sync API (unchanged signatures) ------------------------------
// Existing callers expect synchronous semantics, so the sync API reads
// localStorage. A background sweep (`hydrateGuestSessionFromIdb`) runs at
// app boot to restore a missing localStorage copy from IDB.

export function readGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && parsed.isGuest === true) {
      return parsed as GuestSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function createGuestSession(): GuestSession {
  const existing = readGuestSession();
  if (existing) return existing;
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const session: GuestSession = {
    id: `guest-${uuid}`,
    email: null,
    isGuest: true,
    createdAt: Date.now(),
  };
  try {
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore — caller still gets the in-memory copy */
  }
  // Mirror to IDB best-effort; never blocks the caller.
  void writeGuestSessionToIdb(session);
  return session;
}

export function clearGuestSession(): void {
  try {
    localStorage.removeItem(GUEST_SESSION_KEY);
  } catch {
    /* ignore */
  }
  void clearGuestSessionFromIdb();
}

/**
 * Boot-time helper: if localStorage lost the guest session but IDB still
 * has it (PWA eviction scenario), restore localStorage from IDB. Safe to
 * call multiple times; no-op when localStorage is already populated.
 */
export async function hydrateGuestSessionFromIdb(): Promise<GuestSession | null> {
  const fromLs = readGuestSession();
  if (fromLs) return fromLs;
  const fromIdb = await readGuestSessionFromIdb();
  if (!fromIdb) return null;
  try {
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(fromIdb));
  } catch {
    /* ignore */
  }
  return fromIdb;
}
