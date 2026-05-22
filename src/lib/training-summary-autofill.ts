/**
 * Pure decision helper for Training Summary submission-field autofill.
 *
 * Inputs come from the current logged-in user (NOT the report creator) so
 * that admins or other trainers submitting on someone else's behalf get
 * their own identity stamped on a blank submission section.
 *
 * Returns only fields that should be written. Existing non-empty values
 * are always preserved — never overwrite a manual entry.
 */

type SummaryLike = {
  person_submitting?: string | null;
  submission_date?: string | null;
} | null | undefined;

type UserLike = { email?: string | null } | null | undefined;
type ProfileLike = { first_name?: string | null; last_name?: string | null } | null | undefined;

export interface AutofillUpdates {
  person_submitting?: string;
  submission_date?: string;
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function computeSummaryAutofill(opts: {
  summary: SummaryLike;
  currentUser: UserLike;
  currentUserProfile: ProfileLike;
  today: string; // yyyy-MM-dd in local tz, injected by caller for testability
}): AutofillUpdates {
  const { summary, currentUser, currentUserProfile, today } = opts;
  const updates: AutofillUpdates = {};

  if (!nonEmpty(summary?.person_submitting)) {
    const fullName = [currentUserProfile?.first_name, currentUserProfile?.last_name]
      .filter(nonEmpty)
      .join(' ')
      .trim();
    if (fullName) {
      updates.person_submitting = fullName;
    } else if (nonEmpty(currentUser?.email)) {
      const prefix = currentUser!.email!.split('@')[0]?.trim();
      if (prefix) updates.person_submitting = prefix;
    }
  }

  if (!nonEmpty(summary?.submission_date) && nonEmpty(today)) {
    updates.submission_date = today;
  }

  return updates;
}
