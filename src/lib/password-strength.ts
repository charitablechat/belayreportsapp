/**
 * M14: Client-side password strength meter using zxcvbn-ts.
 * Mirrors the server-side floor in supabase/functions/admin-manage-user/index.ts
 * (8 chars + alpha-numeric composition + common-password blocklist) and adds
 * an entropy-based score for UX feedback.
 */
import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  zxcvbnOptions.setOptions({
    dictionary: { ...zxcvbnCommonPackage.dictionary },
    graphs: zxcvbnCommonPackage.adjacencyGraphs,
  });
  configured = true;
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '123456789', '12345678',
  'qwerty', 'qwerty123', 'abc123', 'abcd1234', 'letmein', 'welcome',
  'welcome1', 'admin', 'admin123', 'iloveyou', 'monkey', 'football',
  'dragon', 'baseball', 'master', 'sunshine', 'princess', 'solo',
  'starwars', 'ropeworks', 'ropeworks123', 'changeme', 'password!',
]);

export interface PasswordStrengthResult {
  /** zxcvbn score 0-4 (0 = weakest, 4 = strongest) */
  score: 0 | 1 | 2 | 3 | 4;
  /** True if password passes the minimum acceptable bar (server floor + score >= 2) */
  acceptable: boolean;
  /** Short user-facing label */
  label: string;
  /** Specific blocking reason (if any) */
  reason: string | null;
}

export function evaluatePassword(rawPassword: string): PasswordStrengthResult {
  ensureConfigured();
  const pw = (rawPassword || '').trim();

  if (pw.length === 0) {
    return { score: 0, acceptable: false, label: '', reason: null };
  }
  if (pw.length < 8) {
    return { score: 0, acceptable: false, label: 'Too short', reason: 'Must be at least 8 characters' };
  }
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    return { score: 0, acceptable: false, label: 'Too common', reason: 'This password is too common' };
  }
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) {
    return { score: 1, acceptable: false, label: 'Weak', reason: 'Add at least one letter and one number' };
  }

  const result = zxcvbn(pw);
  const score = result.score as 0 | 1 | 2 | 3 | 4;
  const labels: Record<number, string> = {
    0: 'Very weak',
    1: 'Weak',
    2: 'Fair',
    3: 'Strong',
    4: 'Very strong',
  };
  return {
    score,
    acceptable: score >= 2,
    label: labels[score],
    reason: score < 2 ? 'Try a longer or less predictable password' : null,
  };
}
