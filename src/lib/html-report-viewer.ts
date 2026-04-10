/**
 * HTML Report Viewer Utility
 * Handles cross-platform HTML report viewing
 */

import { pdfTitleFromFilename, injectHtmlTitle } from '@/lib/report-naming';

/**
 * Download HTML report as a file (opens print dialog in a new window).
 * The injected <title> tells the browser what filename to suggest for
 * "Save as PDF".
 */
export function downloadHtmlReport(html: string, filename: string): void {
  try {
    const pdfTitle = pdfTitleFromFilename(filename);
    const enhancedHtml = injectHtmlTitle(html, pdfTitle);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      console.error('[HTMLViewer] Popup blocked - cannot open print window');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(enhancedHtml);
    printWindow.document.close();

    // Explicitly set document.title in case the written HTML didn't take effect
    printWindow.document.title = pdfTitle;

    const triggerPrint = () => {
      try {
        // Re-assert title right before print in case the browser reset it
        printWindow.document.title = pdfTitle;
        printWindow.focus();
        printWindow.print();
      } catch (e) {
        console.error('[HTMLViewer] Print failed:', e);
      }
    };

    if (printWindow.document.readyState === 'complete') {
      setTimeout(triggerPrint, 300);
    } else {
      printWindow.onload = () => setTimeout(triggerPrint, 300);
      setTimeout(triggerPrint, 3000);
    }
  } catch (error) {
    console.error('[HTMLViewer] Failed to open print dialog:', error);
  }
}

/**
 * Print directly from an existing iframe element
 */
export function printFromIframe(iframe: HTMLIFrameElement): boolean {
  try {
    const contentWindow = iframe.contentWindow;
    if (!contentWindow) {
      console.error('[HTMLViewer] No contentWindow on iframe');
      return false;
    }
    contentWindow.focus();
    contentWindow.print();
    return true;
  } catch (error) {
    console.error('[HTMLViewer] Failed to print from iframe:', error);
    return false;
  }
}
