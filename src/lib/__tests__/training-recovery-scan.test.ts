/**
 * Phase 1 — unit tests for scanTrainingForRecoverableText.
 *
 * Mocks offline-storage and report-version-manager so we exercise the
 * scanner's logic (dedupe, empty-HTML filtering, source labels, sorting)
 * without spinning up the real IDB migration chain.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/offline-storage', () => ({
  getDB: vi.fn(),
}));
vi.mock('@/lib/report-version-manager', () => ({
  getVersionHistory: vi.fn(),
}));

import { getDB } from '@/lib/offline-storage';
import { getVersionHistory } from '@/lib/report-version-manager';
import { scanTrainingForRecoverableText } from '@/lib/recovery/training-recovery-scan';

const T_ID = 'd49114c7-6264-4168-859b-900d2bb1c9ea';

function makeDb(rows: {
  training_summary?: Array<Record<string, unknown>>;
  trainings?: Record<string, Record<string, unknown>>;
}) {
  const tsRows = rows.training_summary ?? [];
  return {
    objectStoreNames: {
      contains: (n: string) =>
        n === 'training_summary' || n === 'trainings',
    } as unknown as DOMStringList,
    transaction: (_store: string, _mode: string) => ({
      objectStore: () => ({
        indexNames: { contains: () => true } as unknown as DOMStringList,
        index: () => ({
          getAll: async (id: string) =>
            tsRows.filter((r) => r.training_id === id),
        }),
        getAll: async () => tsRows,
      }),
      done: Promise.resolve(),
    }),
    get: async (store: string, id: string) =>
      store === 'trainings' ? rows.trainings?.[id] : undefined,
  } as unknown as Awaited<ReturnType<typeof getDB>>;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getDB).mockReset();
  vi.mocked(getVersionHistory).mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe('scanTrainingForRecoverableText', () => {
  it('returns text from the current training_summary draft', async () => {
    vi.mocked(getDB).mockResolvedValue(
      makeDb({
        training_summary: [
          {
            id: 's-1',
            training_id: T_ID,
            observations: '<p>Solid intro session.</p>',
            recommendations: '',
            updated_at: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      }),
    );
    vi.mocked(getVersionHistory).mockResolvedValue([]);

    const findings = await scanTrainingForRecoverableText(T_ID);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('observations');
    expect(findings[0].sourceLabel).toMatch(/draft/i);
  });

  it('returns text from report_versions when current row is empty', async () => {
    vi.mocked(getDB).mockResolvedValue(makeDb({ training_summary: [] }));
    vi.mocked(getVersionHistory).mockResolvedValue([
      {
        // @ts-expect-error -- minimal shape
        versionNumber: 7,
        timestamp: Date.now() - 3_600_000,
        childrenData: {
          summary: [
            {
              observations: '<p>Recovered from version 7.</p>',
              recommendations: '<p>Schedule follow-up.</p>',
            },
          ],
        },
        parentData: {},
      },
    ]);

    const findings = await scanTrainingForRecoverableText(T_ID);
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.field === 'observations')?.sourceDetail).toBe('version 7');
  });

  it('returns text from rw_backup_* localStorage envelopes', async () => {
    vi.mocked(getDB).mockResolvedValue(makeDb({ training_summary: [] }));
    vi.mocked(getVersionHistory).mockResolvedValue([]);

    localStorage.setItem(
      'rw_backup_training_summary_xyz',
      JSON.stringify({
        timestamp: Date.now() - 86_400_000,
        data: {
          training_id: T_ID,
          observations: '<p>Backup observations text.</p>',
          recommendations: '<p>Backup recs.</p>',
        },
      }),
    );

    const findings = await scanTrainingForRecoverableText(T_ID);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.sourceLabel.toLowerCase().includes('backup'))).toBe(true);
  });

  it('treats empty HTML (<p></p>, whitespace) as not found', async () => {
    vi.mocked(getDB).mockResolvedValue(
      makeDb({
        training_summary: [
          {
            id: 's-1',
            training_id: T_ID,
            observations: '<p></p>',
            recommendations: '   ',
          },
        ],
      }),
    );
    vi.mocked(getVersionHistory).mockResolvedValue([]);

    const findings = await scanTrainingForRecoverableText(T_ID);
    expect(findings).toEqual([]);
  });

  it('dedupes identical text across sources, keeping the most recent timestamp first', async () => {
    const sharedText = '<p>Identical observation across draft and version.</p>';
    vi.mocked(getDB).mockResolvedValue(
      makeDb({
        training_summary: [
          {
            id: 's-1',
            training_id: T_ID,
            observations: sharedText,
            updated_at: new Date(Date.now() - 1_000).toISOString(),
          },
        ],
      }),
    );
    vi.mocked(getVersionHistory).mockResolvedValue([
      {
        // @ts-expect-error -- minimal shape
        versionNumber: 3,
        timestamp: Date.now() - 7_200_000,
        childrenData: { summary: [{ observations: sharedText }] },
        parentData: {},
      },
    ]);

    const findings = await scanTrainingForRecoverableText(T_ID, ['observations']);
    expect(findings).toHaveLength(1);
    // The current-draft source wins because it was iterated first
    // (newest) — confirms dedupe keeps the first-seen entry.
    expect(findings[0].sourceLabel).toMatch(/draft/i);
  });

  it('returns [] when all sources are empty', async () => {
    vi.mocked(getDB).mockResolvedValue(makeDb({ training_summary: [] }));
    vi.mocked(getVersionHistory).mockResolvedValue([]);

    const findings = await scanTrainingForRecoverableText(T_ID);
    expect(findings).toEqual([]);
  });
});
