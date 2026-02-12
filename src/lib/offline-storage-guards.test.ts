import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock idb module so we can detect if openDB was ever called
vi.mock('idb', () => ({
  openDB: vi.fn(),
}));

// Mock mobile-detection to prevent side effects
vi.mock('./mobile-detection', () => ({
  checkStorageQuota: vi.fn().mockResolvedValue({ percentUsed: 10 }),
  requestPersistentStorage: vi.fn().mockResolvedValue(true),
}));

// Dynamic imports to get mocked versions
async function getOpenDB() {
  const { openDB } = await import('idb');
  return openDB;
}

describe('Empty-Array Save Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saveRelatedDataOffline blocks save of empty systems array', async () => {
    const { saveRelatedDataOffline } = await import('./offline-storage');
    const openDB = await getOpenDB();
    await saveRelatedDataOffline('systems', 'some-uuid', []);
    expect(openDB).not.toHaveBeenCalled();
  });

  it('saveRelatedDataOffline blocks save of empty ziplines array', async () => {
    const { saveRelatedDataOffline } = await import('./offline-storage');
    const openDB = await getOpenDB();
    await saveRelatedDataOffline('ziplines', 'some-uuid', []);
    expect(openDB).not.toHaveBeenCalled();
  });

  it('saveRelatedDataOffline blocks save of empty equipment array', async () => {
    const { saveRelatedDataOffline } = await import('./offline-storage');
    const openDB = await getOpenDB();
    await saveRelatedDataOffline('equipment', 'some-uuid', []);
    expect(openDB).not.toHaveBeenCalled();
  });

  it('saveRelatedDataOffline blocks save of empty standards array', async () => {
    const { saveRelatedDataOffline } = await import('./offline-storage');
    const openDB = await getOpenDB();
    await saveRelatedDataOffline('standards', 'some-uuid', []);
    expect(openDB).not.toHaveBeenCalled();
  });

  it('saveRelatedDataOffline blocks save of empty summary array', async () => {
    const { saveRelatedDataOffline } = await import('./offline-storage');
    const openDB = await getOpenDB();
    await saveRelatedDataOffline('summary', 'some-uuid', []);
    expect(openDB).not.toHaveBeenCalled();
  });

  it('saveAssessmentDataOffline blocks save of empty array', async () => {
    const { saveAssessmentDataOffline } = await import('./offline-storage');
    const openDB = await getOpenDB();
    await saveAssessmentDataOffline('beginning_of_day', 'some-uuid', []);
    expect(openDB).not.toHaveBeenCalled();
  });

  it('saveTrainingDataOffline blocks save of empty array', async () => {
    const { saveTrainingDataOffline } = await import('./offline-storage');
    const openDB = await getOpenDB();
    await saveTrainingDataOffline('delivery_approaches', 'some-uuid', []);
    expect(openDB).not.toHaveBeenCalled();
  });
});

describe('Temp-ID Restriction Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clearRelatedDataOffline blocks when called with permanent UUID', async () => {
    const { clearRelatedDataOffline } = await import('./offline-storage');
    const consoleSpy = vi.spyOn(console, 'error');
    await clearRelatedDataOffline('systems', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SAFETY] Blocked clear systems operation'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  it('clearRelatedDataOffline does NOT block when called with temp- prefixed ID', async () => {
    const { clearRelatedDataOffline } = await import('./offline-storage');
    const consoleSpy = vi.spyOn(console, 'error');
    await clearRelatedDataOffline('systems', 'temp-abc123');
    // The SAFETY block message should NOT appear — the guard was passed
    const safetyBlocked = consoleSpy.mock.calls.some(
      call => typeof call[0] === 'string' && call[0].includes('[SAFETY] Blocked clear')
    );
    expect(safetyBlocked).toBe(false);
    consoleSpy.mockRestore();
  });

  it('clearAssessmentDataOffline blocks on permanent UUID', async () => {
    const { clearAssessmentDataOffline } = await import('./offline-storage');
    const consoleSpy = vi.spyOn(console, 'error');
    await clearAssessmentDataOffline('beginning_of_day', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SAFETY] Blocked clear beginning_of_day operation'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  it('clearAssessmentDataOffline does NOT block on temp- ID', async () => {
    const { clearAssessmentDataOffline } = await import('./offline-storage');
    const consoleSpy = vi.spyOn(console, 'error');
    await clearAssessmentDataOffline('beginning_of_day', 'temp-xyz789');
    const safetyBlocked = consoleSpy.mock.calls.some(
      call => typeof call[0] === 'string' && call[0].includes('[SAFETY] Blocked clear')
    );
    expect(safetyBlocked).toBe(false);
    consoleSpy.mockRestore();
  });

  it('clearTrainingDataOffline blocks on permanent UUID', async () => {
    const { clearTrainingDataOffline } = await import('./offline-storage');
    const consoleSpy = vi.spyOn(console, 'error');
    await clearTrainingDataOffline('delivery_approaches', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SAFETY] Blocked clear delivery_approaches operation'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  it('clearTrainingDataOffline does NOT block on temp- ID', async () => {
    const { clearTrainingDataOffline } = await import('./offline-storage');
    const consoleSpy = vi.spyOn(console, 'error');
    await clearTrainingDataOffline('delivery_approaches', 'temp-train456');
    const safetyBlocked = consoleSpy.mock.calls.some(
      call => typeof call[0] === 'string' && call[0].includes('[SAFETY] Blocked clear')
    );
    expect(safetyBlocked).toBe(false);
    consoleSpy.mockRestore();
  });
});
