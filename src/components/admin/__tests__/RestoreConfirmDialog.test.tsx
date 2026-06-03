/**
 * Slice 5B — RestoreConfirmDialog behaviour.
 *
 * Renders the dialog with each variant + canProceed combination and
 * asserts the resulting copy + button wiring. Uses synthetic props only;
 * no real Supabase, no real IDB, no real production snapshots.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RestoreConfirmDialog } from '@/components/admin/RestoreConfirmDialog';
import type { RestoreGateConfirmVariant } from '@/lib/recovery/restore-gate';

afterEach(() => cleanup());

function setup(variant: RestoreGateConfirmVariant, canProceed: boolean) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <RestoreConfirmDialog
      open
      variant={variant}
      canProceed={canProceed}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe('RestoreConfirmDialog', () => {
  it('renders proceed + cancel for confirm_normal', () => {
    const { onConfirm, onCancel } = setup('confirm_normal', true);
    fireEvent.click(screen.getByTestId('restore-confirm-proceed'));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancel button calls onCancel', () => {
    const { onConfirm, onCancel } = setup('confirm_normal', true);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows stale wording for confirm_stale', () => {
    setup('confirm_stale', true);
    expect(screen.getByText(/older than/i)).toBeInTheDocument();
  });

  it('shows locked wording for confirm_locked (admin)', () => {
    setup('confirm_locked', true);
    expect(screen.getByText(/marked complete/i)).toBeInTheDocument();
    expect(screen.getByTestId('restore-confirm-proceed')).toBeInTheDocument();
  });

  it('shows stale + locked wording for confirm_stale_and_locked (admin)', () => {
    setup('confirm_stale_and_locked', true);
    expect(screen.getByText(/complete and the backup may be older/i)).toBeInTheDocument();
  });

  it('hard-blocks non-admin (canProceed=false): no proceed button, ack calls onCancel', () => {
    const { onConfirm, onCancel } = setup('confirm_locked', false);
    expect(screen.queryByTestId('restore-confirm-proceed')).toBeNull();
    expect(screen.getByText(/only an admin/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('restore-confirm-ack'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('contains NO sensitive fields in any variant (org/location/notes/photo URLs/report ids)', () => {
    for (const variant of ['confirm_normal', 'confirm_stale', 'confirm_locked', 'confirm_stale_and_locked'] as const) {
      const { container } = render(
        <RestoreConfirmDialog open variant={variant} canProceed onConfirm={() => {}} onCancel={() => {}} />,
      );
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(text.toLowerCase()).not.toContain('organization');
      expect(text.toLowerCase()).not.toContain('location');
      expect(text.toLowerCase()).not.toContain('photo_url');
      expect(text.toLowerCase()).not.toContain('client_name');
      cleanup();
    }
  });
});
