/**
 * HTML Report Viewer Utility
 * Handles cross-platform HTML report viewing
 */


/**
 * Download HTML report as a file (opens print dialog)
 */
export function downloadHtmlReport(html: string, _filename: string): void {
  try {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      console.error('[HTMLViewer] Popup blocked - cannot open print window');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    const triggerPrint = () => {
      try {
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
