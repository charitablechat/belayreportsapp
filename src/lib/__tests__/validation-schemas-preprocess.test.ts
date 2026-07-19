import { describe, expect, it } from 'vitest';
import { equipmentSchema, ziplineSchema } from '@/lib/validation-schemas';

const baseIds = {
  id: '11111111-1111-1111-1111-111111111111',
  inspection_id: '22222222-2222-2222-2222-222222222222',
};

describe('equipmentSchema.production_year preprocess (ported from TAG)', () => {
  it.each([
    ['N/A', '0'],
    ['na', '0'],
    ['n.a.', '0'],
    ['unknown', '0'],
    ['UNK', '0'],
  ])('coerces %j -> %j', (input, expected) => {
    const r = equipmentSchema.safeParse({ ...baseIds, production_year: input });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.production_year).toBe(expected);
  });

  it('empty string -> null', () => {
    const r = equipmentSchema.safeParse({ ...baseIds, production_year: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.production_year).toBeNull();
  });

  it('passes plain year and year range through unchanged', () => {
    const a = equipmentSchema.safeParse({ ...baseIds, production_year: '2022' });
    const b = equipmentSchema.safeParse({ ...baseIds, production_year: '2016-2017' });
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (a.success) expect(a.data.production_year).toBe('2022');
    if (b.success) expect(b.data.production_year).toBe('2016-2017');
  });

  it('rejects garbage', () => {
    const r = equipmentSchema.safeParse({ ...baseIds, production_year: 'lol' });
    expect(r.success).toBe(false);
  });
});

describe('ziplineSchema.cable_length preprocess', () => {
  it('coerces -1 and 0 to null', () => {
    const a = ziplineSchema.safeParse({ ...baseIds, cable_length: -1 });
    const b = ziplineSchema.safeParse({ ...baseIds, cable_length: 0 });
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (a.success) expect(a.data.cable_length).toBeNull();
    if (b.success) expect(b.data.cable_length).toBeNull();
  });

  it('passes positive length through unchanged', () => {
    const r = ziplineSchema.safeParse({ ...baseIds, cable_length: 250 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cable_length).toBe(250);
  });
});
