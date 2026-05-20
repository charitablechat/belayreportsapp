/**
 * Photo receipt system: lightweight localStorage metadata records that survive
 * IndexedDB eviction. Allows the app to detect when a photo blob was lost
 * due to browser storage pressure and warn the user.
 */

import { safeSetItem } from '@/lib/safe-local-storage';

const RECEIPTS_KEY = 'photoReceipts';
const MAX_RECEIPTS = 100;

export interface PhotoReceipt {
  id: string;
  inspectionId: string;
  section: string;
  timestamp: number;
  uploaded: boolean;
}

/**
 * Save a receipt after a photo is successfully stored in IndexedDB.
 */
export function savePhotoReceipt(receipt: PhotoReceipt): void {
  try {
    const receipts: PhotoReceipt[] = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]');
    receipts.push(receipt);
    // Keep only the most recent receipts
    if (receipts.length > MAX_RECEIPTS) {
      receipts.splice(0, receipts.length - MAX_RECEIPTS);
    }
    safeSetItem(RECEIPTS_KEY, JSON.stringify(receipts), { scope: 'photo-receipts.save' });
  } catch {
    // localStorage may be full — fail silently
  }
}

/**
 * Mark a receipt as uploaded (synced to cloud).
 */
export function markReceiptUploaded(photoId: string): void {
  try {
    const receipts: PhotoReceipt[] = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]');
    const receipt = receipts.find(r => r.id === photoId);
    if (receipt) {
      receipt.uploaded = true;
      safeSetItem(RECEIPTS_KEY, JSON.stringify(receipts), { scope: 'photo-receipts.markUploaded' });
    }
  } catch {}
}

/**
 * Get all receipts for a given inspection + section.
 */
export function getPhotoReceipts(inspectionId: string, section: string): PhotoReceipt[] {
  try {
    const receipts: PhotoReceipt[] = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]');
    return receipts.filter(r => r.inspectionId === inspectionId && r.section === section);
  } catch {
    return [];
  }
}

/**
 * Remove a receipt (e.g. after user deletes the photo).
 */
export function removePhotoReceipt(photoId: string): void {
  removePhotoReceipts([photoId]);
}

/**
 * Remove multiple receipts in a single localStorage write. Used by the
 * deletion flow so intentionally-deleted photos cannot be re-counted as
 * "lost from local storage".
 */
export function removePhotoReceipts(photoIds: string[]): void {
  if (!photoIds || photoIds.length === 0) return;
  try {
    const ids = new Set(photoIds);
    const receipts: PhotoReceipt[] = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]');
    const filtered = receipts.filter(r => !ids.has(r.id));
    if (filtered.length !== receipts.length) {
      safeSetItem(RECEIPTS_KEY, JSON.stringify(filtered), { scope: 'photo-receipts.remove' });
    }
  } catch {}
}
