/**
 * M4 polish: ReportCard's 3-state sync badge reads pending-photo counts from
 * the shared PWAContext (`usePWA().photosByInspection`) instead of running
 * a per-card `useUnsyncedPhotos` subscription. These tests pin the badge
 * state-machine so future Lovable regens can't silently regress the
 * "Synced — N photo(s) uploading" mid-state introduced in commit 0080ae4a.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReportCard } from '../ReportCard';

const mockUsePWA = vi.fn();

vi.mock('@/hooks/usePWA', () => ({
  usePWA: () => mockUsePWA(),
}));

vi.mock('@/lib/haptics', () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock('@/lib/confetti', () => ({
  triggerSuccessConfetti: vi.fn(),
}));

vi.mock('@/components/christmas/Sparkles', () => ({
  useClickAndHoverSparkles: () => ({
    sparkles: [],
    triggerSparkles: vi.fn(),
    handleMouseMove: vi.fn(),
  }),
  SparkleContainer: () => null,
}));

interface InspectionReportShape {
  id: string;
  inspection_date: string;
  organization: string | null;
  location: string | null;
  status: string;
  synced_at: string | null;
  created_at: string;
  inspector_id: string | null;
  inspector: { first_name: string; last_name: string; avatar_url: null } | null;
}

function makeReport(overrides: Partial<InspectionReportShape> = {}): InspectionReportShape {
  return {
    id: 'insp-1',
    inspection_date: '2026-01-01',
    organization: 'Acme Co',
    location: 'Plant A',
    status: 'completed',
    synced_at: null,
    created_at: '2026-01-01T00:00:00Z',
    inspector_id: 'user-1',
    inspector: { first_name: 'Test', last_name: 'User', avatar_url: null },
    ...overrides,
  };
}

function renderCard(report: InspectionReportShape) {
  return render(
    <TooltipProvider>
      <ReportCard
        report={report}
        type="inspection"
        onDelete={vi.fn()}
        onClick={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe('ReportCard sync badge (M4 polish — shared PWAContext subscription)', () => {
  beforeEach(() => {
    mockUsePWA.mockReset();
    mockUsePWA.mockReturnValue({ photosByInspection: {} });
  });

  it('shows the gray "Local" badge when synced_at is null', () => {
    renderCard(makeReport({ synced_at: null }));
    expect(screen.getByText('Local')).toBeTruthy();
    expect(screen.queryByText('Synced')).toBeNull();
    expect(screen.queryByText(/uploading/)).toBeNull();
  });

  it('shows the green "Synced" badge when synced_at is set and no photos pending', () => {
    mockUsePWA.mockReturnValue({ photosByInspection: { 'insp-1': 0 } });
    renderCard(makeReport({ synced_at: '2026-01-02T00:00:00Z' }));
    expect(screen.getByText('Synced')).toBeTruthy();
    expect(screen.queryByText('Local')).toBeNull();
    expect(screen.queryByText(/uploading/)).toBeNull();
  });

  it('shows the green "Synced" badge when the inspection id is missing from the map', () => {
    mockUsePWA.mockReturnValue({ photosByInspection: { 'other-inspection': 5 } });
    renderCard(makeReport({ synced_at: '2026-01-02T00:00:00Z' }));
    expect(screen.getByText('Synced')).toBeTruthy();
    expect(screen.queryByText(/uploading/)).toBeNull();
  });

  it('shows the amber "Synced — 1 photo uploading" badge when synced_at && pendingPhotoCount === 1', () => {
    mockUsePWA.mockReturnValue({ photosByInspection: { 'insp-1': 1 } });
    renderCard(makeReport({ synced_at: '2026-01-02T00:00:00Z' }));
    expect(screen.getByText(/Synced — 1 photo uploading/)).toBeTruthy();
    expect(screen.queryByText(/photos uploading/)).toBeNull();
  });

  it('shows the amber "Synced — N photos uploading" badge with plural copy when synced_at && pendingPhotoCount > 1', () => {
    mockUsePWA.mockReturnValue({ photosByInspection: { 'insp-1': 7 } });
    renderCard(makeReport({ synced_at: '2026-01-02T00:00:00Z' }));
    expect(screen.getByText(/Synced — 7 photos uploading/)).toBeTruthy();
  });

  it('falls back to "Local" when synced_at is null even if photos are pending', () => {
    // Defensive: pending-photo count is irrelevant before the parent has
    // ever synced. Badge must still read "Local".
    mockUsePWA.mockReturnValue({ photosByInspection: { 'insp-1': 3 } });
    renderCard(makeReport({ synced_at: null }));
    expect(screen.getByText('Local')).toBeTruthy();
    expect(screen.queryByText(/uploading/)).toBeNull();
  });

  it('reads from the shared PWAContext, not a per-card useUnsyncedPhotos subscription', () => {
    // Calling render must invoke usePWA at least once. This pins the
    // contract that the card reads from context, not from a private hook
    // (which would re-instantiate a separate IDB subscription per card).
    mockUsePWA.mockReturnValue({ photosByInspection: {} });
    renderCard(makeReport());
    expect(mockUsePWA).toHaveBeenCalled();
  });
});
