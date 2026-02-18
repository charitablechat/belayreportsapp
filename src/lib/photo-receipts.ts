/**
 * Photo receipt system: lightweight localStorage metadata records that survive
 * IndexedDB eviction. Allows the app to detect when a photo blob was lost
 * due to browser storage pressure and warn the user.
 */

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
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
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
      localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
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
  try {
    const receipts: PhotoReceipt[] = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '[]');
    const filtered = receipts.filter(r => r.id !== photoId);
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(filtered));
  } catch {}
}
