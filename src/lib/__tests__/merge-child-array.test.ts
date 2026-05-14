import { describe, it, expect, vi } from 'vitest';
import { mergeChildArray, type ChildArrayRow } from '../field-merge';

const T = (s: string) => new Date(s).toISOString();

interface Row extends ChildArrayRow {
  id: string;
  name?: string | null;
  result?: string | null;
  comments?: string | null;
  display_order?: number | null;
}

describe('mergeChildArray', () => {
  it('returns server rows unchanged when local is empty', () => {
    const server: Row[] = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ];
    const out = mergeChildArray<Row>([], server);
    expect(out).toEqual(server);
  });

  it('preserves a temp-* local row that has no server counterpart', () => {
    // Bug-fix invariant: the row the user just added must not vanish when
    // a refetch races the in-flight INSERT.
    const local: Row[] = [
      { id: 'real-1', name: 'Tower', result: 'Pass' },
      { id: 'temp-abc-123', name: 'Two Line Bridge', result: 'Pass' },
    ];
    const server: Row[] = [{ id: 'real-1', name: 'Tower', result: 'Pass' }];

    const out = mergeChildArray<Row>(local, server);

    expect(out).toHaveLength(2);
    expect(out.map(r => r.id)).toContain('temp-abc-123');
    expect(out.find(r => r.id === 'temp-abc-123')?.name).toBe('Two Line Bridge');
  });

  it('preserves multiple temp-* local rows in their original local order', () => {
    const local: Row[] = [
      { id: 'real-1', name: 'A' },
      { id: 'temp-1', name: 'New1' },
      { id: 'temp-2', name: 'New2' },
      { id: 'temp-3', name: 'New3' },
    ];
    const server: Row[] = [{ id: 'real-1', name: 'A' }];

    const out = mergeChildArray<Row>(local, server);
    expect(out.map(r => r.id)).toEqual(['real-1', 'temp-1', 'temp-2', 'temp-3']);
  });

  it('preserves a non-temp local-only row (drift signal) and beacons it', () => {
    // Server is transiently missing a row the user thinks is synced.
    // This must NOT silently drop the row; instead it fires the drift beacon.
    const local: Row[] = [
      { id: 'real-1', name: 'A' },
      { id: 'real-orphan', name: 'Server-missing row' },
    ];
    const server: Row[] = [{ id: 'real-1', name: 'A' }];
    const beacon = vi.fn();

    const out = mergeChildArray<Row>(local, server, {
      onLocalOnlyPreserved: beacon,
      table: 'systems',
    });

    expect(out.map(r => r.id)).toEqual(['real-1', 'real-orphan']);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon).toHaveBeenCalledWith(1, 'systems');
  });

  it('does NOT beacon when only temp-* rows are preserved (expected case)', () => {
    const local: Row[] = [
      { id: 'real-1', name: 'A' },
      { id: 'temp-1', name: 'New' },
    ];
    const server: Row[] = [{ id: 'real-1', name: 'A' }];
    const beacon = vi.fn();

    mergeChildArray<Row>(local, server, { onLocalOnlyPreserved: beacon });
    expect(beacon).not.toHaveBeenCalled();
  });

  it('merges per-field by timestamp when trackedFields is supplied', () => {
    const local: Row = {
      id: '1',
      name: 'Local name',                        // local newer
      result: 'OLD',                             // remote newer
      updated_at: T('2026-01-01T10:00:00Z'),
      field_timestamps: {
        name: T('2026-01-01T10:05:00Z'),
        result: T('2026-01-01T09:00:00Z'),
      },
    };
    const server: Row = {
      id: '1',
      name: 'Remote name',                       // older
      result: 'NEW result',                      // newer
      updated_at: T('2026-01-01T10:01:00Z'),
      field_timestamps: {
        name: T('2026-01-01T10:02:00Z'),
        result: T('2026-01-01T10:01:00Z'),
      },
    };
    const out = mergeChildArray<Row>([local], [server], {
      trackedFields: ['name', 'result'],
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Local name');      // local kept (newer per-field ts)
    expect(out[0].result).toBe('NEW result');    // server kept (newer per-field ts)
  });

  it('without trackedFields, server wins wholesale on overlap', () => {
    const local: Row = { id: '1', name: 'Local', result: 'L', comments: 'L-c' };
    const server: Row = { id: '1', name: 'Server', result: 'S', comments: 'S-c' };
    const out = mergeChildArray<Row>([local], [server]);
    expect(out).toEqual([server]);
  });

  it('uses mergeRow hook when provided (overrides trackedFields)', () => {
    const local: Row = { id: '1', name: 'Local' };
    const server: Row = { id: '1', name: 'Server' };
    const mergeRow = vi.fn(() => ({ id: '1', name: 'CUSTOM' }) as Row);

    const out = mergeChildArray<Row>([local], [server], {
      trackedFields: ['name'],
      mergeRow,
    });
    expect(mergeRow).toHaveBeenCalledWith(local, server);
    expect(out).toEqual([{ id: '1', name: 'CUSTOM' }]);
  });

  it('sorts by display_order when every row has one (so temp- inserts land where user placed them)', () => {
    // OperatingSystemsTable.addSystem prepends with `minOrder - 1` so the
    // new row should appear first.
    const local: Row[] = [
      { id: 'temp-new', name: 'New row', display_order: -1 },
      { id: 'real-1', name: 'A', display_order: 0 },
      { id: 'real-2', name: 'B', display_order: 1 },
    ];
    const server: Row[] = [
      { id: 'real-1', name: 'A', display_order: 0 },
      { id: 'real-2', name: 'B', display_order: 1 },
    ];
    const out = mergeChildArray<Row>(local, server);
    expect(out.map(r => r.id)).toEqual(['temp-new', 'real-1', 'real-2']);
  });

  it('does NOT sort when display_order is missing on any row', () => {
    const local: Row[] = [
      { id: 'temp-1', name: 'X' },
      { id: 'real-1', name: 'A', display_order: 0 },
    ];
    const server: Row[] = [{ id: 'real-1', name: 'A', display_order: 0 }];
    const out = mergeChildArray<Row>(local, server);
    // Server first (from step 1), then local-only appended (step 2).
    expect(out.map(r => r.id)).toEqual(['real-1', 'temp-1']);
  });

  it('returns server rows in server order for rows present on both sides', () => {
    const local: Row[] = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
      { id: '3', name: 'C' },
    ];
    // Server returns them in a different order.
    const server: Row[] = [
      { id: '3', name: 'C' },
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ];
    const out = mergeChildArray<Row>(local, server);
    expect(out.map(r => r.id)).toEqual(['3', '1', '2']);
  });

  it('beacon callback that throws does not break the merge', () => {
    const local: Row[] = [{ id: 'real-orphan', name: 'X' }];
    const server: Row[] = [];
    const beacon = vi.fn(() => { throw new Error('telemetry failure'); });

    // Must not throw.
    const out = mergeChildArray<Row>(local, server, { onLocalOnlyPreserved: beacon });
    expect(out).toEqual(local);
    expect(beacon).toHaveBeenCalled();
  });

  it('empty input + empty server → empty output', () => {
    expect(mergeChildArray<Row>([], [])).toEqual([]);
  });
});
