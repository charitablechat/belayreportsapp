/**
 * HTML Report Viewer Component
 * Full-screen modal viewer for HTML reports with download and share options
 */

 import { useEffect, useRef, useState } from 'react';
 import { X, Download, Share2, Mail, MessageSquare, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { downloadHtmlReport, shareHtmlReport, printFromIframe, generateSmsLink, canShareViaSms } from '@/lib/html-report-viewer';
 import { copyShareLink } from '@/lib/og-share';
 import { EmailReportDialog } from './EmailReportDialog';
 import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { isMobile, isPWA } from '@/lib/mobile-detection';
import { toast } from 'sonner';

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
   reportId?: string;
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
   reportId,
}: HtmlReportViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isMobileOrPWA = isMobile() || isPWA();
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

  const handleCopyShareLink = async () => {
    if (!reportType || !reportId) return;
    const success = await copyShareLink(reportType, reportId);
    if (success) {
      toast.success('Share link copied to clipboard');
    } else {
      toast.error('Failed to copy link');
    }
  };

  const handleSavePdf = () => {
    if (iframeRef.current) {
      printFromIframe(iframeRef.current);
    }
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
      
      @media screen and (max-width: 600px) {
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
        }
        
        .inspection-photo {
          max-height: 220px !important;
          object-fit: contain !important;
          max-width: 100% !important;
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

  const handleDownload = async () => {
    if (isMobileOrPWA) {
      // Try Web Share API first (native share sheet)
      const shared = await shareHtmlReport(html, filename, title);
      if (shared) return;

      // Fallback: print from existing iframe
      if (iframeRef.current) {
        printFromIframe(iframeRef.current);
        return;
      }
    }
    // Desktop: existing window.open + print behavior
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
           <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))] border-b bg-background print:hidden">
             <h2 className="text-lg font-semibold truncate flex-1">{title}</h2>
             <div className="flex items-center gap-2 ml-4">
              {Boolean(reportType && reportId) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyShareLink}
                    className="gap-2 border-2 border-foreground hover:bg-foreground hover:text-background transition-colors duration-100"
                    title="Copy shareable link with rich preview"
                  >
                    <Link2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Share Link</span>
                  </Button>
                )}

              {Boolean(reportType) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="hidden md:inline-flex gap-2 opacity-50 cursor-not-allowed"
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
                    className="hidden md:inline-flex gap-2 border-2 border-foreground hover:bg-foreground hover:text-background transition-colors duration-100"
                    title="Share via Text"
                  >
                    <MessageSquare className="h-4 w-4" />
                    <span className="hidden sm:inline">Text</span>
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSavePdf}
                  className="md:hidden gap-2 print:hidden"
                  title="Download as PDF"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Save PDF</span>
                </Button>
                
               <Button
                 variant="outline"
                 size="sm"
                  onClick={handleDownload}
                className="gap-2"
              >
                  {isMobileOrPWA ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  <span className="hidden sm:inline">{isMobileOrPWA ? 'Share' : 'Save PDF'}</span>
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
