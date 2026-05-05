/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteFallback } from '../RouteFallback';

describe('RouteFallback (Audit C3.8)', () => {
  it('renders a status region with a "Loading…" label', () => {
    render(<RouteFallback />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/loading/i);
  });

  it('exposes a stable test hook for chunk-load smoke checks', () => {
    render(<RouteFallback />);
    expect(screen.getByTestId('route-fallback')).toBeInTheDocument();
  });
});
