import { describe, it, expect } from 'vitest';
import { format } from 'date-fns';
import { parseLocalYmd } from '../date-utils';

describe('parseLocalYmd', () => {
  it('returns local-midnight Date for YYYY-MM-DD', () => {
    const d = parseLocalYmd('2026-05-22')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getDate()).toBe(22);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('round-trips through date-fns format yyyy-MM-dd', () => {
    expect(format(parseLocalYmd('2026-05-22')!, 'yyyy-MM-dd')).toBe('2026-05-22');
    expect(format(parseLocalYmd('2026-01-01')!, 'yyyy-MM-dd')).toBe('2026-01-01');
    expect(format(parseLocalYmd('2026-12-31')!, 'yyyy-MM-dd')).toBe('2026-12-31');
  });

  it('returns undefined for empty / nullish / malformed input', () => {
    expect(parseLocalYmd('')).toBeUndefined();
    expect(parseLocalYmd(null)).toBeUndefined();
    expect(parseLocalYmd(undefined)).toBeUndefined();
    expect(parseLocalYmd('not-a-date')).toBeUndefined();
    expect(parseLocalYmd('2026/05/22')).toBeUndefined();
    expect(parseLocalYmd('2026-13-01')).toBeUndefined();
    expect(parseLocalYmd('2026-02-30')).toBeUndefined();
  });
});
