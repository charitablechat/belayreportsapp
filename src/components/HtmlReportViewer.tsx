/**
 * HTML Report Viewer Component
 * Full-screen modal viewer for HTML reports with Save PDF and Close options
 */

import { useEffect, useRef } from 'react';
import { X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { downloadHtmlReport } from '@/lib/html-report-viewer';

interface HtmlReportViewerProps {
  html: string;
  title: string;
  filename: string;
  isOpen: boolean;
  onClose: () => void;
}

export function HtmlReportViewer({
  html,
  title,
  filename,
  isOpen,
  onClose,
}: HtmlReportViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleSavePdf = () => {
    downloadHtmlReport(enhancedHtml, filename);
  };

  // Comprehensive mobile styles to ensure viewport consistency and prevent overlap/clipping
  const mobileBaseStyles = `
    <style>
      /* Base reset — viewer-specific overrides only */
      html, body {
        max-width: 100vw !important;
        overflow-x: hidden !important;
      }
      * {
        box-sizing: border-box !important;
      }
      
      @media screen and (max-width: 768px) {
        /* Viewport overflow prevention */
        html, body, .page, .page-content {
          max-width: 100vw !important;
          overflow-x: hidden !important;
        }
        
        /* Thumbnail scaling for viewer context */
        .item-thumbnail {
          width: 40px !important;
          height: 40px !important;
        }
        
        /* Photo gallery full width in viewer */
        .photo-gallery {
          max-width: 100% !important;
          padding: 0 !important;
          grid-template-columns: 1fr !important;
          margin: 16px 0 !important;
        }
        
        .inspection-photo {
          max-height: 220px !important;
          object-fit: contain !important;
          max-width: 100% !important;
        }

        .photo-item {
          padding: 8px !important;
        }
        
        /* Report-agnostic: collapse grids to single column */
        .info-grid, .systems-grid {
          grid-template-columns: 1fr !important;
        }
        
        /* Prevent full-width span overflow on single-column grids */
        .info-item, .info-cell {
          grid-column: span 1 !important;
        }

        /* Inspection info-cell block display */
        .info-cell {
          display: block !important;
        }

        .info-value {
          display: block !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }

        /* Header center: reset absolute positioning */
        .header-center {
          position: static !important;
          transform: none !important;
          width: 100% !important;
        }
        
        /* Training photo grid: single column */
        [style*="grid-template-columns: 1fr 1fr"],
        .photo-grid {
          grid-template-columns: 1fr !important;
        }

        /* Per-table minimum widths for horizontal scroll readability */
        .systems-table { min-width: 600px !important; }
        .equipment-table { min-width: 550px !important; }
        .ziplines-table { min-width: 900px !important; }
        .standards-table { min-width: 500px !important; }

        /* Force table cell wrapping */
        th, td {
          white-space: normal !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }

        /* Table scroll container */
        .table-wrapper {
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
          max-width: 100% !important;
        }
        
        /* Text wrapping safety */
        .notes-content, .item-label, .info-label,
        .comment-bullets, .comment-bullets li,
        .summary-list, .summary-list li,
        .text-content, .text-block {
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
      }

      @media screen and (max-width: 480px) {
        .item-thumbnail {
          width: 30px !important;
          height: 30px !important;
        }
        table {
          font-size: 7pt !important;
        }
      }
    </style>
  `;

  // Inject filename as <title> so browser print dialog uses it as the PDF name
  const pdfTitle = filename.replace(/\.\w+$/, '');
  let enhancedHtml = html.replace(/<title>[^<]*<\/title>/, `<title>${pdfTitle}</title>`);
  if (!/<title>/.test(enhancedHtml)) {
    enhancedHtml = enhancedHtml.replace('</head>', `<title>${pdfTitle}</title></head>`);
  }
  // Inject mobile styles before </head>
  enhancedHtml = enhancedHtml.replace('</head>', `${mobileBaseStyles}</head>`);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent hideDefaultClose className="fixed inset-0 max-w-none max-h-none h-[100dvh] w-screen p-0 gap-0 translate-x-0 translate-y-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b bg-background print:hidden">
          <h2 className="text-lg font-semibold truncate flex-1">{title}</h2>
          <div className="flex items-center gap-2 ml-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSavePdf}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Save PDF</span>
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="gap-2"
            >
              <X className="h-4 w-4" />
              <span className="hidden sm:inline">Close</span>
            </Button>
          </div>
        </div>

        {/* Report Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <iframe
            ref={iframeRef}
            srcDoc={enhancedHtml}
            title={title}
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-modals"
            style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
