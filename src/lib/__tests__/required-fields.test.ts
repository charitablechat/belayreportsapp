import { describe, it, expect } from 'vitest';
import {
  getMissingInspectionFields,
  getMissingTrainingFields,
  getMissingAssessmentFields,
  formatMissingDescription,
} from '@/lib/required-fields';

describe('required-fields gate', () => {
  describe('inspections', () => {
    it('returns [] when all required fields filled', () => {
      expect(getMissingInspectionFields({
        organization: 'Acme', location: 'Site A', inspection_date: '2026-05-01',
      })).toEqual([]);
    });
    it('flags every missing field on a blank row', () => {
      const r = getMissingInspectionFields({});
      expect(r.map(m => m.key)).toEqual(['organization', 'location', 'inspection_date']);
    });
    it('treats whitespace-only as missing', () => {
      const r = getMissingInspectionFields({ organization: '   ', location: 'X', inspection_date: '2026-05-01' });
      expect(r.map(m => m.key)).toEqual(['organization']);
    });
    it('treats null and undefined as missing', () => {
      const r = getMissingInspectionFields({ organization: null, location: undefined, inspection_date: '2026-05-01' });
      expect(r.map(m => m.key)).toEqual(['organization', 'location']);
    });
    it('preserves form display order', () => {
      const r = getMissingInspectionFields({ organization: '', location: '', inspection_date: '' });
      expect(r.map(m => m.key)).toEqual(['organization', 'location', 'inspection_date']);
    });
  });

  describe('trainings', () => {
    it('returns [] when all required fields filled', () => {
      expect(getMissingTrainingFields({
        organization: 'Acme', start_date: '2026-05-01', end_date: '2026-05-03',
      })).toEqual([]);
    });
    it('flags every missing field on a blank row', () => {
      const r = getMissingTrainingFields(null);
      expect(r.map(m => m.key)).toEqual(['organization', 'start_date', 'end_date']);
    });
    it('uses Training site label for organization', () => {
      const r = getMissingTrainingFields({});
      expect(r[0]).toEqual({ key: 'organization', label: 'Training site' });
    });
  });

  describe('daily assessments', () => {
    it('returns [] when all required fields filled', () => {
      expect(getMissingAssessmentFields({
        organization: 'Acme', assessment_date: '2026-05-01',
      })).toEqual([]);
    });
    it('flags every missing field on a blank row', () => {
      const r = getMissingAssessmentFields(undefined);
      expect(r.map(m => m.key)).toEqual(['organization', 'assessment_date']);
    });
    it('treats whitespace-only organization as missing', () => {
      const r = getMissingAssessmentFields({ organization: '   ', assessment_date: '2026-05-01' });
      expect(r.map(m => m.key)).toEqual(['organization']);
    });
    it('treats null assessment_date as missing', () => {
      const r = getMissingAssessmentFields({ organization: 'Acme', assessment_date: null });
      expect(r.map(m => m.key)).toEqual(['assessment_date']);
    });
    it('uses Assessment date label', () => {
      const r = getMissingAssessmentFields({});
      expect(r[1]).toEqual({ key: 'assessment_date', label: 'Assessment date' });
    });
  });

  describe('formatMissingDescription', () => {
    it('returns empty string when nothing is missing', () => {
      expect(formatMissingDescription([])).toBe('');
    });
    it('joins labels in order', () => {
      expect(formatMissingDescription([
        { key: 'a', label: 'Alpha' },
        { key: 'b', label: 'Bravo' },
      ])).toBe('Required fields missing: Alpha, Bravo');
    });
  });
});
