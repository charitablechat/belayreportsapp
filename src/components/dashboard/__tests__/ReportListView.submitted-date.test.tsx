/**
 * Pins the date pill behavior in ReportListView:
 *   - Non-completed reports → show the report's primary date (inspection_date, etc.)
 *   - Completed reports → show submission date (attestation_signed_at || updated_at)
 *   - Completed reports with neither submission field → fall back to primary date
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReportListView } from '../ReportListView';

vi.mock('@/hooks/usePWA', () => ({
  usePWA: () => ({ photosByInspection: {} }),
}));

vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }));

function renderRow(report: Record<string, unknown>) {
  return render(
    <TooltipProvider>
      <ReportListView
        reports={[report]}
        type="inspection"
        onRowClick={() => {}}
        onDelete={() => {}}
      />
    </TooltipProvider>
  );
}

const base = {
  id: 'r1',
  organization: 'Org',
  location: 'Loc',
  inspector_id: 'u1',
  inspector: { first_name: 'A', last_name: 'B', avatar_url: null },
  created_at: '2026-05-01T00:00:00Z',
  synced_at: '2026-05-01T00:00:00Z',
};

describe('ReportListView date pill', () => {
  it('draft → shows inspection_date', () => {
    renderRow({
      ...base,
      status: 'draft',
      inspection_date: '2026-05-10',
      updated_at: '2026-05-20T00:00:00Z',
    });
    expect(screen.getByText('May 10, 2026')).toBeInTheDocument();
  });

  it('completed + attestation_signed_at → shows submission date', () => {
    renderRow({
      ...base,
      status: 'completed',
      inspection_date: '2026-05-10',
      attestation_signed_at: '2026-05-22T15:00:00Z',
      updated_at: '2026-05-30T00:00:00Z',
    });
    expect(screen.getByText('May 22, 2026')).toBeInTheDocument();
    expect(screen.queryByText('May 10, 2026')).not.toBeInTheDocument();
  });

  it('completed + only updated_at → falls back to updated_at', () => {
    renderRow({
      ...base,
      status: 'completed',
      inspection_date: '2026-05-10',
      updated_at: '2026-05-21T15:00:00Z',
    });
    expect(screen.getByText('May 21, 2026')).toBeInTheDocument();
  });

  it('completed + neither submission field → falls back to inspection_date', () => {
    renderRow({
      ...base,
      status: 'completed',
      inspection_date: '2026-05-10',
      updated_at: null,
      attestation_signed_at: null,
    });
    expect(screen.getByText('May 10, 2026')).toBeInTheDocument();
  });
});
