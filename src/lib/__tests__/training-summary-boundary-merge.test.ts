/**
 * Boundary preservation tests for `mergeTrainingSummaryAtBoundary`.
 *
 * Covers the sync / cache / save boundaries hardened by the
 * "disappearing Training summary text" fix:
 *   - refetchTrainingPackage (server → local cache)
 *   - syncTrainingAtomic (local → server upsert)
 *   - pushTrainingToRemote (local → server upsert)
 *   - TrainingForm.completeTraining (local → server upsert)
 *   - sw-sync.js syncTrainingsAtomic (mirrored rule)
 *
 * Rule: populated wins over blank UNLESS the blank side carries an explicit
 * per-field `field_timestamps[field]` strictly newer than the populated
 * side's effective timestamp. Row-level `updated_at` alone is NEVER proof of
 * an explicit clear.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  mergeTrainingSummaryAtBoundary,
  isTrainingSummaryFieldMissing,
} from '@/lib/training-summary-merge';

const T1 = '2026-05-28T10:40:00.000Z';
const T2 = '2026-05-28T10:42:00.000Z';
const T3 = '2026-05-28T10:55:00.000Z';

describe('mergeTrainingSummaryAtBoundary — protected field preservation', () => {
  it('preserves populated local observations against blank stale server (refetch direction)', () => {
    const local = {
      observations: '<p>Solid intro session.</p>',
      recommendations: '<p>Schedule follow-up.</p>',
      person_submitting: 'Luke',
      submission_date: '2026-05-28',
      updated_at: T2,
      field_timestamps: { observations: T2, recommendations: T2, person_submitting: T2, submission_date: T2 },
    };
    const serverBlankStale = {
      observations: '',
      recommendations: null,
      person_submitting: null,
      submission_date: null,
      updated_at: T3, // newer row-level — must NOT count as explicit clear
    };
    const { merged, preservations } = mergeTrainingSummaryAtBoundary(local, serverBlankStale);
    expect(merged.observations).toBe('<p>Solid intro session.</p>');
    expect(merged.recommendations).toBe('<p>Schedule follow-up.</p>');
    expect(merged.person_submitting).toBe('Luke');
    expect(merged.submission_date).toBe('2026-05-28');
    expect(preservations.map((p) => p.field).sort()).toEqual(
      ['observations', 'person_submitting', 'recommendations', 'submission_date'],
    );
    expect(preservations.every((p) => p.reason === 'no_explicit_field_clear')).toBe(true);
  });

  it('preserves populated server observations against blank local sync replay (upsert direction)', () => {
    const localBlank = {
      observations: '',
      recommendations: '<p>local recs</p>',
      updated_at: T3,
    };
    const serverPopulated = {
      observations: '<p>server obs do not erase</p>',
      recommendations: '<p>server recs older</p>',
      updated_at: T1,
      field_timestamps: { observations: T1, recommendations: T1 },
    };
    const { merged, preservations } = mergeTrainingSummaryAtBoundary(localBlank, serverPopulated);
    expect(merged.observations).toBe('<p>server obs do not erase</p>');
    // recommendations: both populated → LWW. Local has no explicit ts so
    // effective ts = updated_at T3 > server T1, local wins.
    expect(merged.recommendations).toBe('<p>local recs</p>');
    expect(preservations.find((p) => p.field === 'observations')).toBeTruthy();
  });

  it('honours a genuine explicit per-field clear from the other device', () => {
    const local = {
      observations: '<p>old text</p>',
      field_timestamps: { observations: T1 },
      updated_at: T1,
    };
    const incomingExplicitClear = {
      observations: '',
      field_timestamps: { observations: T3 }, // explicit clear strictly newer
      updated_at: T3,
    };
    const { merged, preservations } = mergeTrainingSummaryAtBoundary(local, incomingExplicitClear);
    expect(merged.observations).toBe('');
    // No preservation should fire — the clear was honoured.
    expect(preservations.find((p) => p.field === 'observations')).toBeFalsy();
  });

  it('row-level updated_at alone never overrides preservation', () => {
    const local = {
      observations: '<p>kept</p>',
      field_timestamps: { observations: T1 },
      updated_at: T1,
    };
    const incomingRowOnlyNewer = {
      observations: '',
      updated_at: T3, // no field_timestamps entry — NOT an explicit clear
    };
    const { merged, preservations } = mergeTrainingSummaryAtBoundary(local, incomingRowOnlyNewer);
    expect(merged.observations).toBe('<p>kept</p>');
    expect(preservations[0]?.reason).toBe('no_explicit_field_clear');
  });

  it('TipTap empty-paragraph "<p></p>" is treated as missing', () => {
    expect(isTrainingSummaryFieldMissing('<p></p>')).toBe(true);
    expect(isTrainingSummaryFieldMissing('   ')).toBe(true);
    expect(isTrainingSummaryFieldMissing(null)).toBe(true);
    expect(isTrainingSummaryFieldMissing(undefined)).toBe(true);
    expect(isTrainingSummaryFieldMissing('<p>x</p>')).toBe(false);
  });

  it('both sides blank → stays blank, no preservation entries', () => {
    const { merged, preservations } = mergeTrainingSummaryAtBoundary(
      { observations: '' },
      { observations: null },
    );
    expect(isTrainingSummaryFieldMissing(merged.observations)).toBe(true);
    expect(preservations).toEqual([]);
  });

  it('null/undefined sides are safe and treated as fully missing', () => {
    const populated = {
      observations: '<p>obs</p>',
      recommendations: '<p>recs</p>',
      person_submitting: 'p',
      submission_date: '2026-05-28',
      field_timestamps: { observations: T2 },
      updated_at: T2,
    };
    const { merged, preservations } = mergeTrainingSummaryAtBoundary(populated, null);
    expect(merged.observations).toBe('<p>obs</p>');
    expect(preservations.find((p) => p.field === 'observations')).toBeFalsy(); // b had undefined, not missing-with-explicit
    const result2 = mergeTrainingSummaryAtBoundary(undefined, populated);
    expect(result2.merged.observations).toBe('<p>obs</p>');
  });

  it('breadcrumb metadata never contains the preserved text', () => {
    const local = {
      observations: '<p>secret training notes</p>',
      field_timestamps: { observations: T2 },
      updated_at: T2,
    };
    const server = { observations: '', updated_at: T3 };
    const { preservations } = mergeTrainingSummaryAtBoundary(local, server);
    const serialized = JSON.stringify(preservations);
    expect(serialized).not.toContain('secret training notes');
    expect(preservations[0]).toMatchObject({
      field: 'observations',
      blankSide: 'b',
      populatedSide: 'a',
      preservedLength: '<p>secret training notes</p>'.length,
    });
  });
});

describe('Boundary merge wired into Training save / sync / cache paths (source tripwires)', () => {
  function readSrc(relFromTestsDir: string): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(resolve(here, '..', relFromTestsDir), 'utf8');
  }

  it('atomic-sync-manager wires preservation into refetchTrainingPackage', () => {
    const src = readSrc('atomic-sync-manager.ts');
    const refetchBlock = src.match(/export async function refetchTrainingPackage[\s\S]{0,5000}?\n\}/);
    expect(refetchBlock, 'refetchTrainingPackage should exist').toBeTruthy();
    expect(refetchBlock![0]).toMatch(/mergeTrainingSummaryAtBoundary/);
    expect(refetchBlock![0]).toMatch(/logTrainingSummaryPreservation/);
  });

  it('atomic-sync-manager wires preservation into syncTrainingAtomic summary step', () => {
    const src = readSrc('atomic-sync-manager.ts');
    // Find the training_summary upsert step block.
    const block = src.match(
      /if\s*\(summary\)\s*\{[\s\S]{0,4000}?table:\s*['"]training_summary['"][\s\S]{0,400}?\}\s*\)\s*;\s*\}/,
    );
    expect(block, 'training_summary upsert block should exist').toBeTruthy();
    expect(block![0]).toMatch(/mergeTrainingSummaryAtBoundary/);
  });

  it('form-savers/trainingSaver wires preservation into pushTrainingToRemote', () => {
    const src = readSrc('form-savers/trainingSaver.ts');
    expect(src).toMatch(/mergeTrainingSummaryAtBoundary/);
    expect(src).toMatch(/logTrainingSummaryPreservation/);
  });

  it('TrainingForm.completeTraining wires preservation into final summary upsert', () => {
    const src = readSrc('../pages/TrainingForm.tsx');
    const block = src.match(/Summary - use upsert for atomic operation[\s\S]{0,3000}?onConflict:\s*['"]training_id['"]/);
    expect(block, 'completeTraining summary upsert block should exist').toBeTruthy();
    expect(block![0]).toMatch(/mergeTrainingSummaryAtBoundary/);
  });

  it('public/sw-sync.js mirrors the preservation rule for background PWA sync', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sw = readFileSync(resolve(here, '..', '..', '..', 'public', 'sw-sync.js'), 'utf8');
    expect(sw).toMatch(/TRAINING_SUMMARY_PROTECTED_FIELDS/);
    expect(sw).toMatch(/mergeTrainingSummaryAtBoundarySW/);
    expect(sw).toMatch(/fetchServerTrainingSummarySW/);
    // The 4 protected fields must be present verbatim.
    expect(sw).toMatch(/'observations'.*'recommendations'.*'person_submitting'.*'submission_date'/);
  });
});
