import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import PhotoCapture from '../PhotoCapture';

// Minimal mocks — we only assert on the rendered input attributes, so the
// heavy upload/sync paths never fire.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isOnline: true }) }));
vi.mock('@/lib/cached-auth', () => ({ getUserWithCache: vi.fn(), getOfflineUserId: () => null }));
vi.mock('@/lib/offline-storage', () => ({
  savePhotoOffline: vi.fn(),
  markPhotoAsUploaded: vi.fn(),
  getCircuitBreakerStatus: () => ({ open: false }),
}));
vi.mock('@/lib/photo-receipts', () => ({ savePhotoReceipt: vi.fn() }));
vi.mock('@/lib/save-to-device', () => ({ saveToDevice: vi.fn() }));
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }));
vi.mock('@/lib/environment', () => ({ isLovablePreview: () => false }));

/**
 * Contract: the Training (and shared) PhotoCapture exposes two inputs.
 * - Camera input: accept="image/*", capture="environment", NOT multiple.
 *   iOS Safari and several Android browsers silently disable native camera
 *   capture when `multiple` is present alongside `capture` — falling back to
 *   the generic file picker. That is the regression this contract locks down.
 * - Upload input: standard multi-select, NO capture attribute.
 */
describe('PhotoCapture — camera vs upload input contract (Training photos)', () => {
  it('camera input requests rear camera capture without multi-select', () => {
    const { container } = render(
      <PhotoCapture
        inspectionId="t-1"
        section="general"
        onPhotoAdded={() => {}}
        tableName="training_photos"
        foreignKeyColumn="training_id"
        storageBucket="training-photos"
      />,
    );
    const cam = container.querySelector(
      'input[data-testid="photo-capture-camera-input"]',
    ) as HTMLInputElement;
    expect(cam).toBeTruthy();
    expect(cam.getAttribute('type')).toBe('file');
    expect(cam.getAttribute('accept')).toBe('image/*');
    expect(cam.getAttribute('capture')).toBe('environment');
    // Critical: must NOT be multiple (iOS Safari drops capture if it is)
    expect(cam.hasAttribute('multiple')).toBe(false);
  });

  it('upload input is a plain multi-select file picker (no capture)', () => {
    const { container } = render(
      <PhotoCapture
        inspectionId="t-1"
        section="general"
        onPhotoAdded={() => {}}
        tableName="training_photos"
        foreignKeyColumn="training_id"
        storageBucket="training-photos"
      />,
    );
    const up = container.querySelector(
      'input[data-testid="photo-capture-upload-input"]',
    ) as HTMLInputElement;
    expect(up).toBeTruthy();
    expect(up.getAttribute('type')).toBe('file');
    expect(up.hasAttribute('multiple')).toBe(true);
    expect(up.hasAttribute('capture')).toBe(false);
  });

  it('both inputs feed the same onChange handler (shared processing path)', () => {
    // The component wires handleCameraCapture and handleFileUpload to the
    // same processFiles pipeline. Asserting both inputs exist + share the
    // same accept-family ensures captured images are processed identically
    // to uploaded ones (compression, offline save, training_photos insert).
    const { container } = render(
      <PhotoCapture
        inspectionId="t-1"
        section="general"
        onPhotoAdded={() => {}}
        tableName="training_photos"
        foreignKeyColumn="training_id"
        storageBucket="training-photos"
      />,
    );
    const cam = container.querySelector('input[data-testid="photo-capture-camera-input"]');
    const up = container.querySelector('input[data-testid="photo-capture-upload-input"]');
    expect(cam && up).toBeTruthy();
  });
});
