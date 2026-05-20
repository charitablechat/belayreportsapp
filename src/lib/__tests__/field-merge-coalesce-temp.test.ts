import { describe, it, expect } from 'vitest';
import { mergeChildArray } from '../field-merge';

type Row = { id: string; inspection_id: string; zipline_name: string; display_order?: number };

describe('mergeChildArray coalesceTempByBusinessKey', () => {
  it('drops a temp-id row when it collides with a real-id row on the business key', () => {
    const local: Row[] = [
      { id: 'temp-A', inspection_id: 'ins-1', zipline_name: 'Left Side', display_order: 0 },
    ];
    const server: Row[] = [
      { id: 'real-A', inspection_id: 'ins-1', zipline_name: 'Left Side', display_order: 0 },
    ];
    const out = mergeChildArray(local, server, {
      coalesceTempByBusinessKey: ['inspection_id', 'zipline_name'],
    });
    expect(out.map(r => r.id)).toEqual(['real-A']);
  });

  it('case-insensitive + trims whitespace on the business key', () => {
    const local: Row[] = [
      { id: 'temp-A', inspection_id: 'ins-1', zipline_name: '  left side  ', display_order: 0 },
    ];
    const server: Row[] = [
      { id: 'real-A', inspection_id: 'ins-1', zipline_name: 'Left Side', display_order: 0 },
    ];
    const out = mergeChildArray(local, server, {
      coalesceTempByBusinessKey: ['inspection_id', 'zipline_name'],
    });
    expect(out.map(r => r.id)).toEqual(['real-A']);
  });

  it('NEVER coalesces two real-id rows even if the business key matches', () => {
    const local: Row[] = [
      { id: 'real-A', inspection_id: 'ins-1', zipline_name: 'Left Side', display_order: 0 },
    ];
    const server: Row[] = [
      { id: 'real-B', inspection_id: 'ins-1', zipline_name: 'Left Side', display_order: 0 },
    ];
    const out = mergeChildArray(local, server, {
      coalesceTempByBusinessKey: ['inspection_id', 'zipline_name'],
    });
    expect(out.map(r => r.id).sort()).toEqual(['real-A', 'real-B']);
  });

  it('does NOT coalesce when any business-key field is empty/blank', () => {
    const local: Row[] = [
      { id: 'temp-A', inspection_id: 'ins-1', zipline_name: '', display_order: 0 },
    ];
    const server: Row[] = [
      { id: 'real-A', inspection_id: 'ins-1', zipline_name: '', display_order: 0 },
    ];
    const out = mergeChildArray(local, server, {
      coalesceTempByBusinessKey: ['inspection_id', 'zipline_name'],
    });
    expect(out.map(r => r.id).sort()).toEqual(['real-A', 'temp-A']);
  });

  it('does NOT coalesce when the option is omitted', () => {
    const local: Row[] = [
      { id: 'temp-A', inspection_id: 'ins-1', zipline_name: 'Left Side', display_order: 0 },
    ];
    const server: Row[] = [
      { id: 'real-A', inspection_id: 'ins-1', zipline_name: 'Left Side', display_order: 0 },
    ];
    const out = mergeChildArray(local, server, {});
    expect(out.map(r => r.id).sort()).toEqual(['real-A', 'temp-A']);
  });

  it('handles 3-field equipment key (inspection_id + equipment_category + equipment_type + production_year)', () => {
    type Eq = { id: string; inspection_id: string; equipment_category: string; equipment_type: string; production_year: number; display_order?: number };
    const local: Eq[] = [
      { id: 'temp-X', inspection_id: 'ins-1', equipment_category: 'Helmet', equipment_type: 'Petzl Vertex', production_year: 2024, display_order: 0 },
    ];
    const server: Eq[] = [
      { id: 'real-X', inspection_id: 'ins-1', equipment_category: 'Helmet', equipment_type: 'Petzl Vertex', production_year: 2024, display_order: 0 },
    ];
    const out = mergeChildArray(local, server, {
      coalesceTempByBusinessKey: ['inspection_id', 'equipment_category', 'equipment_type', 'production_year'],
    });
    expect(out.map(r => r.id)).toEqual(['real-X']);
  });
});
