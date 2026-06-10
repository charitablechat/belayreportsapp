import { describe, it, expect, beforeEach } from 'vitest';
import { applyIncomingSummary } from '@/lib/training-summary-merge';
import { clearSummaryTraceEntries, getSummaryTraceEntries } from '@/lib/training-summary-trace';

type TrainingSummaryTestRow = Record<string, unknown> & {
  id?: string;
  training_id?: string;
  observations?: string | null;
  recommendations?: string | null;
  updated_at?: string;
  field_timestamps?: Record<string, string>;
};

const summaryRow = (row: TrainingSummaryTestRow): TrainingSummaryTestRow => row;

const t0 = '2026-01-01T00:00:00.000Z';
const t1 = '2026-01-01T00:00:05.000Z';
const t2 = '2026-01-01T00:00:10.000Z';

beforeEach(() => clearSummaryTraceEntries());

describe('applyIncomingSummary — live-state guard', () => {
  it('never replaces populated prev with null incoming (no-server-row branch)', () => {
    const prev = summaryRow({
      id: 's', training_id: 'tr',
      observations: 'my obs',
      updated_at: t1,
      field_timestamps: { observations: t1 },
    });
    const r = applyIncomingSummary(prev, null, { source: 'no-server-row' });
    expect(r.next).toBe(prev);
    expect(getSummaryTraceEntries().some(e => e.source === 'placeholder-clobber-blocked')).toBe(true);
  });

  it('accepts incoming wholesale when prev is empty placeholder', () => {
    const prev = summaryRow({ id: 's', training_id: 'tr' });
    const incoming = summaryRow({ id: 's', training_id: 'tr', observations: 'server text', updated_at: t1 });
    const r = applyIncomingSummary(prev, incoming, { source: 'server-refetch' });
    expect(r.next).toEqual(incoming);
  });

  it('preserves populated local field over blank incoming without explicit field clear', () => {
    const prev = summaryRow({
      id: 's', training_id: 'tr',
      observations: 'recent typed text',
      updated_at: t1,
      field_timestamps: { observations: t1 },
    });
    const incoming = summaryRow({
      id: 's', training_id: 'tr',
      observations: null,
      updated_at: t2, // row-level updated_at newer but no explicit clear
    });
    const r = applyIncomingSummary(prev, incoming, { source: 'server-refetch' });
    expect(r.next?.observations).toBe('recent typed text');
    expect(r.preservedFields).toContain('observations');
    expect(r.guarded).toBe(true);
  });

  it('honours an explicit cross-device clear (incoming explicit ts > local explicit ts, value blank)', () => {
    const prev = summaryRow({
      id: 's', training_id: 'tr',
      observations: 'older typed text',
      updated_at: t0,
      field_timestamps: { observations: t0 },
    });
    const incoming = summaryRow({
      id: 's', training_id: 'tr',
      observations: '',
      field_timestamps: { observations: t2 }, // strictly newer per-field explicit stamp
    });
    const r = applyIncomingSummary(prev, incoming, { source: 'server-refetch' });
    expect(r.next?.observations).toBe('');
    expect(r.acceptedClears).toContain('observations');
  });

  it('keeps local populated when both populated and incoming lacks explicit per-field stamp', () => {
    const prev = summaryRow({
      id: 's', training_id: 'tr',
      recommendations: 'local new',
      updated_at: t1,
      field_timestamps: { recommendations: t1 },
    });
    const incoming = summaryRow({
      id: 's', training_id: 'tr',
      recommendations: 'server older snapshot',
      updated_at: t2, // server-side upsert time, no per-field stamp
    });
    const r = applyIncomingSummary(prev, incoming, { source: 'server-refetch' });
    expect(r.next?.recommendations).toBe('local new');
    expect(r.preservedFields).toContain('recommendations');
  });

  it('accepts genuinely newer populated incoming when explicit per-field stamp is newer', () => {
    const prev = summaryRow({
      id: 's', training_id: 'tr',
      recommendations: 'old local',
      updated_at: t0,
      field_timestamps: { recommendations: t0 },
    });
    const incoming = summaryRow({
      id: 's', training_id: 'tr',
      recommendations: 'cross-device newer',
      field_timestamps: { recommendations: t2 },
    });
    const r = applyIncomingSummary(prev, incoming, { source: 'idb-load' });
    expect(r.next?.recommendations).toBe('cross-device newer');
  });

  it('backup-restore with blank backup cannot wipe populated local summary', () => {
    const prev = summaryRow({
      id: 's', training_id: 'tr',
      observations: 'live editor text',
      recommendations: 'live recs',
      updated_at: t1,
      field_timestamps: { observations: t1, recommendations: t1 },
    });
    const backup = summaryRow({ id: 's', training_id: 'tr', observations: '', recommendations: null, updated_at: t2 });
    const r = applyIncomingSummary(prev, backup, { source: 'backup-restore' });
    expect(r.next?.observations).toBe('live editor text');
    expect(r.next?.recommendations).toBe('live recs');
  });

  it('TipTap empty shell <p></p> is treated as missing (not an explicit clear)', () => {
    const prev = summaryRow({
      id: 's', training_id: 'tr',
      observations: 'real text',
      updated_at: t1,
      field_timestamps: { observations: t1 },
    });
    const incoming = summaryRow({
      id: 's', training_id: 'tr',
      observations: '<p></p>',
      updated_at: t2,
    });
    const r = applyIncomingSummary(prev, incoming, { source: 'idb-load' });
    expect(r.next?.observations).toBe('real text');
  });

  it('records trace entries with metadata only (no field values)', () => {
    const prev = summaryRow({
      id: 's', training_id: 'tr',
      observations: 'abcdef',
      updated_at: t1,
      field_timestamps: { observations: t1 },
    });
    const incoming = summaryRow({ id: 's', training_id: 'tr', observations: null, updated_at: t2 });
    applyIncomingSummary(prev, incoming, {
      source: 'server-refetch',
      trainingId: 'training-uuid-1234',
      hasUnsaved: true,
    });
    const entries = getSummaryTraceEntries();
    const blocked = entries.find(e => e.blocked && e.field === 'observations');
    expect(blocked).toBeTruthy();
    expect(blocked!.prevLen).toBe(6);
    expect(blocked!.nextLen).toBe(0);
    // Trace must never carry the actual text.
    expect(JSON.stringify(entries)).not.toContain('abcdef');
  });
});
