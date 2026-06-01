/**
 * Phase 1 — pinned list of affected training reports.
 *
 * Access rules enforced by the recovery page:
 *  - admins (is_admin_or_above) see all pinned reports;
 *  - non-admin users only see pinned reports whose owner_id matches their own
 *    auth user id;
 *  - everyone else sees nothing.
 *
 * No production writes occur from this module or the page that uses it.
 */

export interface PinnedTrainingRecovery {
  trainingId: string;
  trainerName: string;
  reportLabel: string;
  missingFields: ReadonlyArray<'observations' | 'recommendations'>;
}

export const PINNED_TRAINING_RECOVERIES: ReadonlyArray<PinnedTrainingRecovery> = [
  {
    trainingId: 'd49114c7-6264-4168-859b-900d2bb1c9ea',
    trainerName: 'Art Ortiz',
    reportLabel: 'Camp Blessing',
    missingFields: ['observations', 'recommendations'],
  },
  {
    trainingId: '0c41bebe-eea3-4327-a522-2f922450cbf6',
    trainerName: 'Taylor Maanao',
    reportLabel: 'Vista Camps',
    missingFields: ['observations'],
  },
  {
    trainingId: '67a45e8a-ad94-480f-a16d-4032fbe2a158',
    trainerName: 'Taylor Maanao',
    reportLabel: 'Camp Aranzazu',
    missingFields: ['observations', 'recommendations'],
  },
] as const;

export const FIELD_LABEL: Record<'observations' | 'recommendations', string> = {
  observations: 'Observations',
  recommendations: 'Recommendations',
};
