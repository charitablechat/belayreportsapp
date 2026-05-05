/**
 * Sprint 1 / C3.5: NetworkStatusBanner renders only when offline and surfaces
 * the unsynced-count copy correctly. Mounted from App.tsx alongside
 * StaleVersionBanner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetworkStatusBanner } from '../NetworkStatusBanner';

const mockUsePWA = vi.fn();

vi.mock('@/hooks/usePWA', () => ({
  usePWA: () => mockUsePWA(),
}));

describe('NetworkStatusBanner (Sprint 1 / C3.5)', () => {
  beforeEach(() => {
    mockUsePWA.mockReset();
  });

  it('renders nothing when online', () => {
    mockUsePWA.mockReturnValue({ isOnline: true, unsyncedCount: 0 });
    const { container } = render(<NetworkStatusBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when online even if there is a queued count', () => {
    // Online + nonzero queue is normal post-reconnect during drain; banner
    // must NOT flash because the user is already back on the network.
    mockUsePWA.mockReturnValue({ isOnline: true, unsyncedCount: 5 });
    const { container } = render(<NetworkStatusBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the offline banner when offline with no queue', () => {
    mockUsePWA.mockReturnValue({ isOnline: false, unsyncedCount: 0 });
    render(<NetworkStatusBanner />);
    const banner = screen.getByTestId('network-status-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Working offline');
    expect(banner.textContent).toContain('Changes will sync when you reconnect');
  });

  it('renders singular item count', () => {
    mockUsePWA.mockReturnValue({ isOnline: false, unsyncedCount: 1 });
    render(<NetworkStatusBanner />);
    expect(screen.getByTestId('network-status-banner').textContent).toContain('1 item queued');
  });

  it('renders plural item count', () => {
    mockUsePWA.mockReturnValue({ isOnline: false, unsyncedCount: 7 });
    render(<NetworkStatusBanner />);
    expect(screen.getByTestId('network-status-banner').textContent).toContain('7 items queued');
  });

  it('exposes role=status for screen readers', () => {
    mockUsePWA.mockReturnValue({ isOnline: false, unsyncedCount: 0 });
    render(<NetworkStatusBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });
});
