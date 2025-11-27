/**
 * HTML Report Viewer Utility
 * Handles cross-platform HTML report viewing with mobile-first approach
 */

import { isMobile, isPWA } from './mobile-detection';

export interface ViewerOptions {
  html: string;
  filename: string;
  title: string;
}

/**
 * Open HTML report with appropriate method based on platform
 * Returns true if viewer was opened successfully, false otherwise
 */
export function openHtmlReport(options: ViewerOptions): boolean {
  const { html, filename, title } = options;
  
  // On mobile/PWA: always use in-app viewer (will be handled by React component)
  // This function just returns false to indicate React component should handle it
  if (isMobile() || isPWA()) {
    return false; // Signal to use React component
  }

  // On desktop: try window.open with fallback
  try {
    const newWindow = window.open('', '_blank');
    
    if (!newWindow) {
      // Popup blocked - signal to use React component
      return false;
    }

    // Write HTML content to new window
    newWindow.document.open();
    newWindow.document.write(html);
    newWindow.document.close();
    
    // Set title
    if (newWindow.document.title) {
      newWindow.document.title = title;
    }

    return true;
  } catch (error) {
    console.error('[HTMLViewer] Failed to open in new window:', error);
    return false;
  }
}

/**
 * Download HTML report as a file
 */
export function downloadHtmlReport(html: string, filename: string): void {
  try {
    const blob = new Blob([html], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('[HTMLViewer] Failed to download:', error);
  }
}

/**
 * Check if Web Share API is available and can share HTML files
 */
export function canShareHtml(): boolean {
  return 'share' in navigator && 'canShare' in navigator;
}

/**
 * Share HTML report using Web Share API (mobile)
 */
export async function shareHtmlReport(html: string, filename: string, title: string): Promise<boolean> {
  if (!canShareHtml()) {
    return false;
  }

  try {
    const blob = new Blob([html], { type: 'text/html' });
    const file = new File([blob], filename, { type: 'text/html' });
    
    const shareData = {
      title,
      files: [file],
    };

    if (navigator.canShare && !navigator.canShare(shareData)) {
      return false;
    }

    await navigator.share(shareData);
    return true;
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.error('[HTMLViewer] Failed to share:', error);
    }
    return false;
  }
}
