/**
 * Synthetic Session Guard
 *
 * Defense-in-depth helper that ensures the offline placeholder access token
 * never escapes to the network. If any code path tries to send it to Supabase
 * (REST, RPC, edge function), this guard logs a dev warning and returns true
 * so the caller can abort the request.
 */

export const OFFLINE_PLACEHOLDER_TOKEN = 'offline_placeholder_token';

/** JWT shape: three base64url segments separated by dots, header begins with `ey`. */
const JWT_SHAPE = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isPlaceholderToken(token: string | null | undefined): boolean {
  return token === OFFLINE_PLACEHOLDER_TOKEN;
}

export function looksLikeJwt(token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  if (token === OFFLINE_PLACEHOLDER_TOKEN) return false;
  return JWT_SHAPE.test(token);
}

/**
 * Returns true if the token would be unsafe to send over the network.
 * Logs a dev warning so any leak shows up in the browser console.
 */
export function isUnsafeToTransmit(token: string | null | undefined, ctx?: string): boolean {
  if (isPlaceholderToken(token)) {
    if (import.meta.env.DEV) {
      console.warn(
        `[SyntheticSessionGuard] Refused to transmit offline placeholder token${ctx ? ` (${ctx})` : ''}.`
      );
    }
    return true;
  }
  return false;
}
