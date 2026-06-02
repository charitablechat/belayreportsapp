import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  atomicReplaceAvatar,
  parseOwnedAvatarStorageKey,
  pickSafeExtension,
  generateOpaqueId,
  safeDeleteOldAvatar,
  validateAvatarFile,
  AvatarReplaceError,
  type AvatarSupabaseLike,
} from '@/lib/avatar-replace';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const PUBLIC_URL = `https://example.supabase.co/storage/v1/object/public/avatars/${USER_ID}/old-id.png`;

function makeFile(opts: { size?: number; type?: string; name?: string } = {}): File {
  const blob = new Blob([new Uint8Array(opts.size ?? 1024)], { type: opts.type ?? 'image/png' });
  return new File([blob], opts.name ?? 'photo.png', { type: opts.type ?? 'image/png' });
}

interface MockCalls {
  uploads: Array<{ path: string; opts: any }>;
  updates: Array<{ values: Record<string, unknown>; id: string }>;
  removes: string[][];
}

function makeSupabase(opts: {
  uploadError?: { message: string };
  updateError?: { message: string };
  removeError?: { message: string };
  removeThrows?: boolean;
  publicUrl?: string;
} = {}): { client: AvatarSupabaseLike; calls: MockCalls } {
  const calls: MockCalls = { uploads: [], updates: [], removes: [] };
  const client: AvatarSupabaseLike = {
    storage: {
      from: (_bucket: string) => ({
        upload: async (path, _file, optsArg) => {
          calls.uploads.push({ path, opts: optsArg });
          return { data: opts.uploadError ? null : { path }, error: opts.uploadError ?? null };
        },
        remove: async (paths) => {
          if (opts.removeThrows) throw new Error('remove threw');
          calls.removes.push(paths);
          return { data: null, error: opts.removeError ?? null };
        },
        getPublicUrl: (path) => ({
          data: { publicUrl: opts.publicUrl ?? `https://example.supabase.co/storage/v1/object/public/avatars/${path}` },
        }),
      }),
    },
    from: (_table: string) => ({
      update: (values) => ({
        eq: async (_col, value) => {
          calls.updates.push({ values, id: value });
          return { data: null, error: opts.updateError ?? null };
        },
      }),
    }),
  };
  return { client, calls };
}

describe('parseOwnedAvatarStorageKey', () => {
  it('returns null for null/empty/undefined', () => {
    expect(parseOwnedAvatarStorageKey(null, USER_ID)).toBeNull();
    expect(parseOwnedAvatarStorageKey('', USER_ID)).toBeNull();
    expect(parseOwnedAvatarStorageKey(undefined, USER_ID)).toBeNull();
  });
  it('returns null for malformed URLs', () => {
    expect(parseOwnedAvatarStorageKey('not a url', USER_ID)).toBeNull();
    expect(parseOwnedAvatarStorageKey('javascript:alert(1)', USER_ID)).toBeNull();
  });
  it('returns null for external/wrong-bucket URLs', () => {
    expect(parseOwnedAvatarStorageKey(`https://other.com/${USER_ID}/x.png`, USER_ID)).toBeNull();
    expect(
      parseOwnedAvatarStorageKey(
        `https://example.supabase.co/storage/v1/object/public/photos/${USER_ID}/x.png`,
        USER_ID,
      ),
    ).toBeNull();
  });
  it('returns null for another user folder', () => {
    const other = '99999999-9999-9999-9999-999999999999';
    expect(
      parseOwnedAvatarStorageKey(
        `https://example.supabase.co/storage/v1/object/public/avatars/${other}/x.png`,
        USER_ID,
      ),
    ).toBeNull();
  });
  it('returns null for nested folders or traversal', () => {
    expect(
      parseOwnedAvatarStorageKey(
        `https://example.supabase.co/storage/v1/object/public/avatars/${USER_ID}/sub/x.png`,
        USER_ID,
      ),
    ).toBeNull();
    expect(
      parseOwnedAvatarStorageKey(
        `https://example.supabase.co/storage/v1/object/public/avatars/${USER_ID}/..%2Fevil.png`,
        USER_ID,
      ),
    ).toBeNull();
  });
  it('returns the decoded key for valid owned URL', () => {
    expect(parseOwnedAvatarStorageKey(PUBLIC_URL, USER_ID)).toBe(`${USER_ID}/old-id.png`);
  });
});

describe('pickSafeExtension', () => {
  it('prefers mime mapping', () => {
    expect(pickSafeExtension({ type: 'image/jpeg', name: 'whatever.exe' })).toBe('jpg');
    expect(pickSafeExtension({ type: 'image/webp', name: 'a' })).toBe('webp');
  });
  it('falls back to whitelisted extension', () => {
    expect(pickSafeExtension({ type: '', name: 'a.PNG' })).toBe('png');
  });
  it('falls back to "bin" for unknown', () => {
    expect(pickSafeExtension({ type: '', name: 'evil.exe' })).toBe('bin');
  });
});

describe('generateOpaqueId', () => {
  it('produces a non-empty opaque string', () => {
    const a = generateOpaqueId();
    const b = generateOpaqueId();
    expect(a).toMatch(/^[0-9a-f-]{16,}$/i);
    expect(a).not.toEqual(b);
  });
});

describe('validateAvatarFile', () => {
  it('rejects oversized files', () => {
    const f = makeFile({ size: 6 * 1024 * 1024 });
    expect(() => validateAvatarFile(f)).toThrow(AvatarReplaceError);
  });
  it('rejects unsupported mime types', () => {
    const f = makeFile({ type: 'application/pdf' });
    expect(() => validateAvatarFile(f)).toThrow(AvatarReplaceError);
  });
  it('accepts supported types under limit', () => {
    expect(() => validateAvatarFile(makeFile())).not.toThrow();
  });
});

describe('atomicReplaceAvatar — ordering & atomicity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path: upload → update; returns owned old path for caller cleanup', async () => {
    const { client, calls } = makeSupabase();
    const result = await atomicReplaceAvatar({
      supabase: client,
      userId: USER_ID,
      oldUrl: PUBLIC_URL,
      file: makeFile(),
      generateId: () => 'new-id',
    });
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0].path).toBe(`${USER_ID}/new-id.png`);
    expect(calls.uploads[0].opts).toMatchObject({ upsert: false });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].values).toEqual({ avatar_url: result.publicUrl });
    expect(calls.updates[0].id).toBe(USER_ID);
    // No remove call inside the helper — caller deletes the old object.
    expect(calls.removes).toHaveLength(0);
    expect(result.oldPathToCleanup).toBe(`${USER_ID}/old-id.png`);
  });

  it('UPLOAD failure: does NOT call update or remove; OLD avatar untouched', async () => {
    const { client, calls } = makeSupabase({ uploadError: { message: 'boom' } });
    await expect(
      atomicReplaceAvatar({
        supabase: client,
        userId: USER_ID,
        oldUrl: PUBLIC_URL,
        file: makeFile(),
        generateId: () => 'new-id',
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect(calls.updates).toHaveLength(0);
    expect(calls.removes).toHaveLength(0);
  });

  it('DB UPDATE failure after successful upload: removes orphan NEW object, surfaces original DB error', async () => {
    const { client, calls } = makeSupabase({ updateError: { message: 'rls denied' } });
    await expect(
      atomicReplaceAvatar({
        supabase: client,
        userId: USER_ID,
        oldUrl: PUBLIC_URL,
        file: makeFile(),
        generateId: () => 'new-id',
      }),
    ).rejects.toMatchObject({ code: 'DB_UPDATE_FAILED' });
    expect(calls.uploads).toHaveLength(1);
    expect(calls.updates).toHaveLength(1);
    // Exactly one remove targeting the NEW path (orphan cleanup) — old path never touched.
    expect(calls.removes).toEqual([[`${USER_ID}/new-id.png`]]);
  });

  it('orphan cleanup failure during DB error path does NOT mask the DB error', async () => {
    const { client } = makeSupabase({
      updateError: { message: 'rls denied' },
      removeError: { message: 'cleanup failed' },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      atomicReplaceAvatar({
        supabase: client,
        userId: USER_ID,
        oldUrl: PUBLIC_URL,
        file: makeFile(),
        generateId: () => 'new-id',
      }),
    ).rejects.toMatchObject({ code: 'DB_UPDATE_FAILED' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('validation runs before any storage call', async () => {
    const { client, calls } = makeSupabase();
    await expect(
      atomicReplaceAvatar({
        supabase: client,
        userId: USER_ID,
        oldUrl: null,
        file: makeFile({ size: 10 * 1024 * 1024 }),
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(calls.uploads).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
    expect(calls.removes).toHaveLength(0);
  });

  it('null/external/wrong-user oldUrl yields oldPathToCleanup=null', async () => {
    for (const url of [null, '', 'https://other.com/x.png', `https://example.supabase.co/storage/v1/object/public/avatars/99999999-9999-9999-9999-999999999999/x.png`]) {
      const { client } = makeSupabase();
      const result = await atomicReplaceAvatar({
        supabase: client,
        userId: USER_ID,
        oldUrl: url as any,
        file: makeFile(),
        generateId: () => 'new-id',
      });
      expect(result.oldPathToCleanup).toBeNull();
    }
  });

  it('upload uses contentType + upsert:false + path under user folder', async () => {
    const { client, calls } = makeSupabase();
    await atomicReplaceAvatar({
      supabase: client,
      userId: USER_ID,
      oldUrl: null,
      file: makeFile({ type: 'image/webp' }),
      generateId: () => 'opaque-id-xyz',
    });
    expect(calls.uploads[0].path).toBe(`${USER_ID}/opaque-id-xyz.webp`);
    expect(calls.uploads[0].opts).toMatchObject({ upsert: false, contentType: 'image/webp' });
  });
});

describe('safeDeleteOldAvatar — best effort, never throws', () => {
  it('no-op when path is null', async () => {
    const { client, calls } = makeSupabase();
    const r = await safeDeleteOldAvatar(client, null);
    expect(r).toEqual({ deleted: false, failed: false });
    expect(calls.removes).toHaveLength(0);
  });

  it('deletes the provided path when present', async () => {
    const { client, calls } = makeSupabase();
    const r = await safeDeleteOldAvatar(client, `${USER_ID}/old-id.png`);
    expect(r).toEqual({ deleted: true, failed: false });
    expect(calls.removes).toEqual([[`${USER_ID}/old-id.png`]]);
  });

  it('swallows storage error and logs non-sensitive scope only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeSupabase({ removeError: { message: 'denied' } });
    const r = await safeDeleteOldAvatar(client, `${USER_ID}/old-id.png`);
    expect(r).toEqual({ deleted: false, failed: true });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('old-avatar cleanup failed'),
      expect.objectContaining({ scope: 'avatar-replace.old-cleanup' }),
    );
    // Logged metadata must NOT contain the path or any URL.
    const args = warn.mock.calls[0];
    expect(JSON.stringify(args)).not.toContain(USER_ID);
    expect(JSON.stringify(args)).not.toContain('old-id.png');
    warn.mockRestore();
  });

  it('swallows thrown errors and never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeSupabase({ removeThrows: true });
    const r = await safeDeleteOldAvatar(client, `${USER_ID}/old-id.png`);
    expect(r).toEqual({ deleted: false, failed: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
