/**
 * Regression coverage for the disappearing-inspection-summary bug.
 *
 * The four user-editable `inspection_summary` columns are exercised:
 *   - repairs_performed       (rich-text)
 *   - critical_actions        (rich-text)
 *   - future_considerations   (rich-text)
 *   - next_inspection_date    (yyyy-MM-dd)
 *
 * Strict explicit-clear gate: an empty incoming value can ONLY overwrite
 * a non-empty local value when the incoming row carries an EXPLICIT
 * per-field timestamp strictly newer than the local per-field timestamp.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  INSPECTION_SUMMARY_FIELDS,
  isEmptyPlaceholderInspectionSummary,
  isFieldMissing,
  inspectionSummaryFieldTimestampMs,
  mergeInspectionSummaryPreservingPopulated,
} from '@/lib/inspection-summary-merge';

vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn() }));

const T1 = '2026-05-28T10:40:00.000Z';
const T2 = '2026-05-28T10:42:00.000Z';
const T3 = '2026-05-28T10:55:00.000Z';

type Row = Record<string, unknown> & {
  updated_at?: string | null;
  field_timestamps?: Record<string, string> | null;
};

describe('INSPECTION_SUMMARY_FIELDS', () => {
  it('locks the four user-editable columns', () => {
    expect([...INSPECTION_SUMMARY_FIELDS]).toEqual([
      'repairs_performed',
      'critical_actions',
      'future_considerations',
      'next_inspection_date',
    ]);
  });
});

describe('isEmptyPlaceholderInspectionSummary', () => {
  it('treats null / undefined / fresh placeholder as empty', () => {
    expect(isEmptyPlaceholderInspectionSummary(null)).toBe(true);
    expect(isEmptyPlaceholderInspectionSummary(undefined)).toBe(true);
    expect(isEmptyPlaceholderInspectionSummary({ id: 's', inspection_id: 'i' })).toBe(true);
  });

  it('treats TipTap empty-paragraph shells as empty', () => {
    expect(
      isEmptyPlaceholderInspectionSummary({
        repairs_performed: '<p></p>',
        critical_actions: '<p><br/></p>',
        future_considerations: '   ',
        next_inspection_date: null,
      }),
    ).toBe(true);
  });

  it('treats any populated user field as non-empty', () => {
    expect(isEmptyPlaceholderInspectionSummary({ repairs_performed: 'x' })).toBe(false);
    expect(isEmptyPlaceholderInspectionSummary({ critical_actions: 'y' })).toBe(false);
    expect(isEmptyPlaceholderInspectionSummary({ future_considerations: 'z' })).toBe(false);
    expect(isEmptyPlaceholderInspectionSummary({ next_inspection_date: '2027-01-01' })).toBe(false);
  });

  it('treats a row with any field_timestamps as non-empty (user has touched form)', () => {
    expect(
      isEmptyPlaceholderInspectionSummary({
        field_timestamps: { repairs_performed: T1 },
      }),
    ).toBe(false);
  });
});

describe('isFieldMissing', () => {
  it('null/undefined → missing', () => {
    expect(isFieldMissing(null)).toBe(true);
    expect(isFieldMissing(undefined)).toBe(true);
  });
  it('whitespace and TipTap shells → missing', () => {
    expect(isFieldMissing('')).toBe(true);
    expect(isFieldMissing('   \n')).toBe(true);
    expect(isFieldMissing('<p></p>')).toBe(true);
    expect(isFieldMissing('<p><br/></p>')).toBe(true);
  });
  it('any populated text → present', () => {
    expect(isFieldMissing('Fixed the brake')).toBe(false);
    expect(isFieldMissing('<p>x</p>')).toBe(false);
  });
});

describe('inspectionSummaryFieldTimestampMs', () => {
  it('explicit field timestamp wins over row updated_at', () => {
    const row = { updated_at: T1, field_timestamps: { repairs_performed: T3 } };
    expect(inspectionSummaryFieldTimestampMs(row, 'repairs_performed')).toBe(Date.parse(T3));
  });
  it('falls back to updated_at when no per-field stamp', () => {
    const row = { updated_at: T2 };
    expect(inspectionSummaryFieldTimestampMs(row, 'repairs_performed')).toBe(Date.parse(T2));
  });
  it('returns 0 when neither present', () => {
    expect(inspectionSummaryFieldTimestampMs({}, 'repairs_performed')).toBe(0);
    expect(inspectionSummaryFieldTimestampMs(null, 'repairs_performed')).toBe(0);
  });
});

describe('mergeInspectionSummaryPreservingPopulated', () => {
  it('THE BUG: stale empty server row does NOT wipe locally-typed text (no per-field stamps)', () => {
    // Reproduces the in-the-wild race: local React state has typed text
    // but no per-field timestamps were stamped (older code path), and the
    // server returns an empty row with a newer row-level updated_at from
    // an unrelated background write. Without the guard, LWW falls back
    // to updated_at and picks the empty incoming.
    const local: Row = {
      id: 's', inspection_id: 'i',
      repairs_performed: 'Fixed the cable brake on Zip 3',
      critical_actions: '<p>Replace harness #7</p>',
      future_considerations: '',
      next_inspection_date: null,
      updated_at: T1,
    };
    const incoming: Row = {
      id: 's', inspection_id: 'i',
      repairs_performed: '',
      critical_actions: null,
      future_considerations: '',
      next_inspection_date: null,
      updated_at: '2026-06-01T00:00:00.000Z',
      field_timestamps: {},
    };

    const { merged, preserved } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(merged.repairs_performed).toBe('Fixed the cable brake on Zip 3');
    expect(merged.critical_actions).toBe('<p>Replace harness #7</p>');
    expect(preserved.map(p => p.field).sort()).toEqual(['critical_actions', 'repairs_performed']);
  });

  it('local explicit per-field stamps already protect via plain LWW (guard is silent)', () => {
    // When local stamped its edits explicitly, mergeRecordFields itself
    // keeps the local text — our extra guard does not need to intervene
    // and reports no preserved entries.
    const local: Row = {
      id: 's',
      repairs_performed: 'kept by LWW',
      updated_at: T3,
      field_timestamps: { repairs_performed: T3 },
    };
    const incoming: Row = {
      id: 's',
      repairs_performed: '',
      updated_at: '2026-06-01T00:00:00.000Z',
      field_timestamps: {},
    };
    const { merged, preserved } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(merged.repairs_performed).toBe('kept by LWW');
    expect(preserved).toEqual([]);
  });

  it('honours an EXPLICIT cross-device clear (newer per-field timestamp + empty value)', () => {
    const local: Row = {
      id: 's',
      repairs_performed: 'old text',
      updated_at: T1,
      field_timestamps: { repairs_performed: T1 },
    };
    const incoming: Row = {
      id: 's',
      repairs_performed: '',
      updated_at: T3,
      field_timestamps: { repairs_performed: T3 },
    };
    const { merged, honouredClears } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(isFieldMissing(merged.repairs_performed)).toBe(true);
    expect(honouredClears.map(p => p.field)).toEqual(['repairs_performed']);
  });

  it('does NOT honour a clear when incoming lacks an explicit per-field timestamp', () => {
    // Background save bumped updated_at but did not stamp the field.
    const local: Row = {
      id: 's',
      repairs_performed: 'Fixed brake',
      updated_at: T1,
      field_timestamps: { repairs_performed: T1 },
    };
    const incoming: Row = {
      id: 's',
      repairs_performed: '',
      updated_at: T3,
      field_timestamps: {},
    };
    const { merged, preserved } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(merged.repairs_performed).toBe('Fixed brake');
    expect(preserved.length).toBe(1);
  });

  it('lets newer non-empty incoming win (legitimate cross-device edit)', () => {
    const local: Row = {
      id: 's',
      repairs_performed: 'old',
      updated_at: T1,
      field_timestamps: { repairs_performed: T1 },
    };
    const incoming: Row = {
      id: 's',
      repairs_performed: 'NEW from other device',
      updated_at: T3,
      field_timestamps: { repairs_performed: T3 },
    };
    const { merged } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(merged.repairs_performed).toBe('NEW from other device');
  });

  it('partial payload: server row missing one field → only that field is preserved, others merge', () => {
    const local: Row = {
      id: 's',
      repairs_performed: 'local repairs',
      critical_actions: 'local critical',
      future_considerations: '',
      next_inspection_date: '2027-01-01',
      updated_at: T1,
      field_timestamps: {
        repairs_performed: T1,
        critical_actions: T1,
        next_inspection_date: T1,
      },
    };
    const incoming: Row = {
      id: 's',
      // repairs_performed missing entirely (undefined)
      critical_actions: 'remote critical (newer)',
      future_considerations: 'remote future',
      next_inspection_date: '2027-06-01',
      updated_at: T3,
      field_timestamps: {
        critical_actions: T3,
        future_considerations: T3,
        next_inspection_date: T3,
      },
    };
    const { merged } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(merged.repairs_performed).toBe('local repairs');
    expect(merged.critical_actions).toBe('remote critical (newer)');
    expect(merged.future_considerations).toBe('remote future');
    expect(merged.next_inspection_date).toBe('2027-06-01');
  });

  it('TipTap empty shells are treated as empty and preserved-against', () => {
    const local: Row = {
      id: 's',
      repairs_performed: '<p>Real content</p>',
      updated_at: T1,
      field_timestamps: { repairs_performed: T1 },
    };
    const incoming: Row = {
      id: 's',
      repairs_performed: '<p></p>',
      updated_at: T3,
      field_timestamps: {},
    };
    const { merged } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(merged.repairs_performed).toBe('<p>Real content</p>');
  });

  it('next_inspection_date: stale null does not wipe a set date', () => {
    const local: Row = {
      id: 's',
      next_inspection_date: '2027-09-15',
      updated_at: T1,
      field_timestamps: { next_inspection_date: T1 },
    };
    const incoming: Row = {
      id: 's',
      next_inspection_date: null,
      updated_at: T3,
      field_timestamps: {},
    };
    const { merged } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(merged.next_inspection_date).toBe('2027-09-15');
  });

  it('both sides empty → stays empty, no preservation noise', () => {
    const local: Row = { id: 's', repairs_performed: '', updated_at: T1 };
    const incoming: Row = { id: 's', repairs_performed: '', updated_at: T2 };
    const { merged, preserved, honouredClears } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    expect(isFieldMissing(merged.repairs_performed)).toBe(true);
    expect(preserved).toEqual([]);
    expect(honouredClears).toEqual([]);
  });

  it('non-tracked fields (id, inspection_id) are not touched by the merge guard', () => {
    const local: Row = { id: 'local-id', inspection_id: 'i', repairs_performed: 'a', updated_at: T1, field_timestamps: { repairs_performed: T1 } };
    const incoming: Row = { id: 'server-id', inspection_id: 'i', repairs_performed: '', updated_at: T3, field_timestamps: {} };
    const { merged } = mergeInspectionSummaryPreservingPopulated(local, incoming);
    // Whichever LWW chose for id is fine — we only care that repairs is preserved.
    expect(merged.repairs_performed).toBe('a');
  });
});
