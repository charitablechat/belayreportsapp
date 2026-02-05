/**
 * HTML Report Viewer Component
 * Full-screen modal viewer for HTML reports with download and share options
 */

 import { useEffect, useState } from 'react';
 import { X, Download, Share2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { downloadHtmlReport, shareHtmlReport, canShareHtml } from '@/lib/html-report-viewer';
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
  const canShare = canShareHtml();
   const { isOnline } = useNetworkStatus();
   const [emailDialogOpen, setEmailDialogOpen] = useState(false);
 
   // Only show email button if reportType is provided (for backward compatibility)
   const canEmail = Boolean(reportType) && isOnline;

  // Add mobile base styles to ensure viewport consistency
  const mobileBaseStyles = `
    <style>
      html, body {
        max-width: 100vw !important;
        overflow-x: hidden !important;
      }
      * {
        box-sizing: border-box !important;
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

  const handleShare = async () => {
    const shared = await shareHtmlReport(html, filename, title);
    if (!shared) {
      // Fallback to download if share fails
      handleDownload();
    }
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
               {canEmail && (
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={handleEmail}
                   className="gap-2 border-2 border-foreground hover:bg-foreground hover:text-background transition-colors duration-100"
                   title="Email Report"
                 >
                   <Mail className="h-4 w-4" />
                   <span className="hidden sm:inline">Email</span>
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
               
               {canShare && (
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={handleShare}
                   className="gap-2"
                 >
                   <Share2 className="h-4 w-4" />
                   <span className="hidden sm:inline">Share</span>
                 </Button>
               )}
               
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
