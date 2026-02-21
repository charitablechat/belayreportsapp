/**
 * HTML Report Viewer Component
 * Full-screen modal viewer for HTML reports with download and share options
 */

 import { useEffect, useState } from 'react';
 import { X, Download, Mail, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { downloadHtmlReport, generateSmsLink, canShareViaSms } from '@/lib/html-report-viewer';
 import { EmailReportDialog } from './EmailReportDialog';
 import { useNetworkStatus } from '@/hooks/useNetworkStatus';

interface HtmlReportViewerProps {
  html: string;
  title: string;
  filename: string;
  isOpen: boolean;
  onClose: () => void;
   // Props for email feature
   reportType?: 'inspection' | 'training' | 'daily_assessment';
   organization?: string;
   date?: string;
}

export function HtmlReportViewer({
  html,
  title,
  filename,
  isOpen,
  onClose,
   reportType,
   organization,
   date,
}: HtmlReportViewerProps) {
  const canSms = canShareViaSms();
   const { isOnline } = useNetworkStatus();
   const [emailDialogOpen, setEmailDialogOpen] = useState(false);
 
   // Only show email button if reportType is provided (for backward compatibility)
   const canEmail = Boolean(reportType) && isOnline;
  
  // Generate SMS link if we have report metadata
  const smsLink = reportType && organization && date 
    ? generateSmsLink(reportType, organization, date)
    : null;

  const handleSms = () => {
    if (smsLink) {
      window.open(smsLink, '_self');
    }
  };

  // Comprehensive mobile styles to ensure viewport consistency and prevent overlap/clipping
  const mobileBaseStyles = `
    <style>
      /* Base reset */
      html, body {
        max-width: 100vw !important;
        overflow-x: hidden !important;
      }
      * {
        box-sizing: border-box !important;
      }
      
      /* Mobile viewport fixes (< 600px) - Minimal Brutalism style */
      @media screen and (max-width: 600px) {
        /* Global overflow prevention */
        html, body, .page, .page-content {
          max-width: 100vw !important;
          overflow-x: hidden !important;
          overflow-wrap: break-word !important;
          word-wrap: break-word !important;
        }
        
        /* Header: Stack vertically to prevent overlap */
        .page-header {
          flex-direction: column !important;
          align-items: center !important;
          gap: 8px !important;
          padding-bottom: 10px !important;
          min-height: auto !important;
          max-height: none !important;
        }
        
        .header-left, .header-right, .header-center {
          position: static !important;
          transform: none !important;
          text-align: center !important;
          width: 100% !important;
        }
        
        .header-title {
          max-width: 100% !important;
          font-size: 8pt !important;
          white-space: normal !important;
        }
        
        /* Table-based header logos - stack on mobile */
        .header-logo-table {
          table-layout: auto !important;
        }
        
        .header-logo-table tr {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          gap: 8px !important;
        }
        
        .header-cell-left, .header-cell-right {
          display: block !important;
          width: 100% !important;
          text-align: center !important;
          padding: 4px 0 !important;
        }
        
        /* Info grid: Single column with clear separation */
        .info-grid {
          display: block !important;
        }
        
        .info-cell, .info-item {
          display: block !important;
          margin-bottom: 12px !important;
          border-bottom: 1px solid #e5e7eb !important;
          padding-bottom: 8px !important;
        }
        
        .info-label {
          display: block !important;
          white-space: normal !important;
          margin-bottom: 4px !important;
          font-weight: 700 !important;
        }
        
        .info-value {
          display: block !important;
          word-break: break-word !important;
          border-bottom: none !important;
        }
        
        /* Tables: Prevent content overlap */
        table {
          font-size: 8pt !important;
          table-layout: auto !important;
          width: 100% !important;
        }
        
        th, td {
          padding: 4px 6px !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
          white-space: normal !important;
          max-width: none !important;
        }
        
        .result-checkbox {
          white-space: normal !important;
          font-size: 7pt !important;
          line-height: 1.3 !important;
        }
        
        /* Footer: Full width, no clipping */
        .page-footer {
          margin-top: 16px !important;
        }
        
        .disclaimer, .footer-disclaimer {
          max-width: 100% !important;
          font-size: 7pt !important;
          padding: 0 4px !important;
          text-align: center !important;
        }
        
        /* Typography: Prevent clipping */
        h1 { 
          font-size: 16pt !important; 
          word-break: break-word !important;
          line-height: 1.3 !important;
        }
        h2 { 
          font-size: 12pt !important; 
          padding: 6px 8px !important;
          word-break: break-word !important;
        }
        h3 { 
          font-size: 10pt !important;
          word-break: break-word !important;
        }
        
        /* Text containers */
        .text-block, .text-content, .key-section, .critical-box, .standards-box {
          word-break: break-word !important;
          overflow-wrap: break-word !important;
          padding: 8px !important;
        }
        
        /* Bullet lists */
        .bullet-list, .summary-list, ul {
          padding-left: 16px !important;
          margin-left: 0 !important;
        }
        
        .bullet-list li, .summary-list li, ul li {
          word-break: break-word !important;
          font-size: 9pt !important;
          line-height: 1.4 !important;
        }
        
        /* Photo gallery: Single column */
        .photo-gallery {
          grid-template-columns: 1fr !important;
          gap: 12px !important;
        }
        
        .photo-item {
          width: 100% !important;
        }
        
        /* Systems/checklist grids */
        .systems-grid {
          grid-template-columns: 1fr !important;
        }
      }
    </style>
  `;

  // Inject before </head> in the html prop
  const enhancedHtml = html.replace('</head>', `${mobileBaseStyles}</head>`);

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

  const handleDownload = () => {
    downloadHtmlReport(html, filename);
  };

   const handleEmail = () => {
     setEmailDialogOpen(true);
   };
 
  return (
     <>
       <Dialog open={isOpen} onOpenChange={onClose}>
         <DialogContent hideDefaultClose className="fixed inset-0 max-w-none max-h-none h-[100dvh] w-screen p-0 gap-0 translate-x-0 translate-y-0 flex flex-col">
           {/* Header */}
           <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b bg-background">
             <h2 className="text-lg font-semibold truncate flex-1">{title}</h2>
             <div className="flex items-center gap-2 ml-4">
              {Boolean(reportType) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="gap-2 opacity-50 cursor-not-allowed"
                    title="Email Report (coming soon)"
                  >
                    <Mail className="h-4 w-4" />
                    <span className="hidden sm:inline">Email</span>
                  </Button>
                )}
               
               {canSms && smsLink && (
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={handleSms}
                   className="gap-2 border-2 border-foreground hover:bg-foreground hover:text-background transition-colors duration-100"
                   title="Share via Text"
                 >
                   <MessageSquare className="h-4 w-4" />
                   <span className="hidden sm:inline">Text</span>
                 </Button>
               )}
               
              <Button
                variant="outline"
                size="sm"
                 onClick={handleDownload}
                className="gap-2"
              >
                 <Download className="h-4 w-4" />
                 <span className="hidden sm:inline">Download</span>
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
               srcDoc={enhancedHtml}
               title={title}
               className="w-full h-full border-0"
               sandbox="allow-same-origin"
               style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
             />
           </div>
         </DialogContent>
       </Dialog>
       
       {/* Email Dialog */}
       {reportType && (
         <EmailReportDialog
           isOpen={emailDialogOpen}
           onClose={() => setEmailDialogOpen(false)}
           html={html}
           reportType={reportType}
           title={title}
           organization={organization}
           date={date}
         />
       )}
     </>
  );
}
