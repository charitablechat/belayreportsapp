import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

interface PdfPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfUrl: string;
  fileName: string;
  onDownload: () => void;
}

export default function PdfPreviewDialog({ 
  open, 
  onOpenChange, 
  pdfUrl, 
  fileName,
  onDownload 
}: PdfPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>PDF Preview - {fileName}</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden rounded-lg border bg-muted">
          <iframe
            src={pdfUrl}
            className="w-full h-full"
            title="PDF Preview"
            style={{ border: 'none' }}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
          >
            <X className="mr-2 h-4 w-4" />
            Close
          </Button>
          <Button 
            onClick={onDownload}
          >
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
