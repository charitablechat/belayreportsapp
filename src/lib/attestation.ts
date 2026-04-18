/**
 * Inspector Attestation Helpers
 * 
 * Captures electronic signature evidence for legal defensibility:
 * - Typed name + checkbox = "click-to-sign" model
 * - User agent + IP captured at sign time
 * - Exact attestation text preserved (so future wording changes don't rewrite history)
 * - App version stamped for audit trail
 */

export const APP_VERSION: string =
  (import.meta as any).env?.APP_VERSION || 'unknown';

if (APP_VERSION === 'unknown' && typeof console !== 'undefined') {
  console.warn(
    '[attestation] APP_VERSION is "unknown" — vite-auto-version plugin may have failed to inject define values. ' +
      'Attestation records will be stamped with "unknown" until this is resolved.',
  );
}

export type ReportKind = 'inspection' | 'training' | 'daily_assessment';

const KIND_LABELS: Record<ReportKind, string> = {
  inspection: 'inspection',
  training: 'training',
  daily_assessment: 'daily assessment',
};

export interface AttestationContext {
  kind: ReportKind;
  signerName: string;
  organization: string;
  reportDate: string; // ISO or display-formatted
}

export interface AttestationPayload {
  attestation_signed_at: string;
  attestation_signer_name: string;
  attestation_signer_id: string | null;
  attestation_ip: string | null; // populated server-side; null on client
  attestation_user_agent: string;
  attestation_text: string;
  app_version_at_completion: string;
}

/**
 * Build the canonical attestation statement. Stored verbatim with the report.
 */
export function buildAttestationText(ctx: AttestationContext): string {
  const noun = KIND_LABELS[ctx.kind];
  return `I, ${ctx.signerName}, attest that I personally performed this ${noun} on ${ctx.reportDate} at ${ctx.organization} and that the contents of this report are accurate to the best of my knowledge. I understand this electronic signature has the same legal effect as a handwritten signature.`;
}

/**
 * Build the payload to write to the report row at completion time.
 */
export function buildAttestationPayload(
  ctx: AttestationContext,
  signerId: string | null,
): AttestationPayload {
  return {
    attestation_signed_at: new Date().toISOString(),
    attestation_signer_name: ctx.signerName,
    attestation_signer_id: signerId,
    attestation_ip: null, // edge function fills from request header on first sync
    attestation_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    attestation_text: buildAttestationText(ctx),
    app_version_at_completion: APP_VERSION,
  };
}

/**
 * Normalize names for comparison (case + whitespace insensitive).
 */
export function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return !!a && !!b && norm(a) === norm(b);
}
