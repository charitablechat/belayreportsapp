/**
 * Last-Known Account Pointer
 * ──────────────────────────
 * Non-secret, survives sign-out. Lets a returning user open the app
 * offline (or against an unreachable backend) and reach their local
 * data without re-entering a password.
 *
 * This is NOT a credential. It carries no token; it only identifies
 * "who last successfully signed in on this device" so the offline
 * fallback chain (cached supabase session → synthetic → captured
 * refresh-token → THIS → guest) has one more rung.
 *
 * Storage:
 *   - localStorage (primary, synchronous boot-time read)
 *   - IndexedDB mirror (best-effort, survives localStorage eviction
 *     on iOS Safari + PWA storage pressure)
 *
 * Lifecycle:
 *   - written on every successful online SIGNED_IN / TOKEN_REFRESHED
 *   - read by Index.tsx, RequireAuth, Auth.tsx, and cached-auth
 *     fallback helpers
 *   - explicit sign-out clears tokens but DOES NOT clear this row;
 *     the user can still re-enter their own local data offline
 *   - cleared only on explicit "forget this device" action (not yet
 *     surfaced in UI; see clearLastKnownAccount)
 */

import { openDB } from "idb";

const LS_KEY = "last_known_account";
const IDB_NAME = "rope-works-meta";
const IDB_STORE = "last_known_account";

export interface LastKnownAccount {
  userId: string;
  email: string | null;
  displayName: string | null;
  lastVerifiedAt: number; // epoch ms — last successful ONLINE auth
}

function isLkaShape(v: unknown): v is LastKnownAccount {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.userId === "string" &&
    o.userId.length > 0 &&
    typeof o.lastVerifiedAt === "number"
  );
}

function readLocalStorage(): LastKnownAccount | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isLkaShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalStorage(lka: LastKnownAccount): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(lka));
  } catch {
    // localStorage may be full / disabled — IDB mirror still runs.
  }
}

async function openMetaDb() {
  return openDB(IDB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "userId" });
      }
    },
  });
}

async function writeIdb(lka: LastKnownAccount): Promise<void> {
  try {
    const db = await openMetaDb();
    await db.put(IDB_STORE, lka);
    db.close();
  } catch {
    // best-effort
  }
}

async function readIdbMostRecent(): Promise<LastKnownAccount | null> {
  try {
    const db = await openMetaDb();
    const all = (await db.getAll(IDB_STORE)) as LastKnownAccount[];
    db.close();
    if (!all.length) return null;
    all.sort((a, b) => (b.lastVerifiedAt || 0) - (a.lastVerifiedAt || 0));
    return all[0];
  } catch {
    return null;
  }
}

/**
 * Synchronous read — safe for boot-time gates. Reads only localStorage;
 * the IDB mirror is consulted asynchronously elsewhere if needed.
 */
export function getLastKnownAccount(): LastKnownAccount | null {
  return readLocalStorage();
}

/**
 * Async read with IDB fallback. Use during boot recovery when
 * localStorage may have been evicted but IDB is intact.
 */
export async function getLastKnownAccountAsync(): Promise<LastKnownAccount | null> {
  const ls = readLocalStorage();
  if (ls) return ls;
  const idb = await readIdbMostRecent();
  if (idb) {
    // Re-hydrate localStorage so the next sync read finds it.
    writeLocalStorage(idb);
    return idb;
  }
  return null;
}

/**
 * Persist the pointer. Idempotent. Called from cached-auth's
 * onAuthStateChange after every real (non-placeholder) SIGNED_IN /
 * TOKEN_REFRESHED.
 */
export function saveLastKnownAccount(input: {
  userId: string;
  email?: string | null;
  displayName?: string | null;
}): void {
  if (!input?.userId) return;
  const lka: LastKnownAccount = {
    userId: input.userId,
    email: input.email ?? null,
    displayName: input.displayName ?? null,
    lastVerifiedAt: Date.now(),
  };
  writeLocalStorage(lka);
  // fire-and-forget IDB mirror
  void writeIdb(lka);
}

/**
 * Explicit "forget this device" — only called from an opt-in UI action,
 * NEVER from signOut(). Sign-out keeps the pointer so the same user can
 * reopen their local data offline without re-typing a password.
 */
export async function clearLastKnownAccount(): Promise<void> {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
  try {
    const db = await openMetaDb();
    await db.clear(IDB_STORE);
    db.close();
  } catch {
    // ignore
  }
}

export function hasLastKnownAccount(): boolean {
  return getLastKnownAccount() !== null;
}
