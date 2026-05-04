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
 *      ClaimGuestDataDialog flow after a successful online sign-in.
 *   3. Guest sessions are accepted by RequireAuth only while offline. On
 *      reconnect the guard redirects to the sign-in screen so the user can
 *      claim or discard the work.
 */

const GUEST_SESSION_KEY = 'guest_session';

export interface GuestSession {
  id: string;            // Always starts with `guest-`
  email: null;
  isGuest: true;
  createdAt: number;
}

export function isGuestUserId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('guest-');
}

export function readGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && parsed.isGuest === true) {
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
  // Use a random UUID for uniqueness; prefix marks it non-Supabase so every
  // network-boundary guard can short-circuit.
  const uuid =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
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
    // ignore — caller will get the in-memory copy back at minimum
  }
  return session;
}

export function clearGuestSession(): void {
  try {
    localStorage.removeItem(GUEST_SESSION_KEY);
  } catch {
    // ignore
  }
}
