 /**
  * Email Report Dialog Component
  * Reusable dialog for sending HTML reports via email
  */
 
 import { useState } from 'react';
 import { Loader2, Mail, Send } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
 import { Textarea } from '@/components/ui/textarea';
 import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
 } from '@/components/ui/dialog';
 import { supabase } from '@/integrations/supabase/client';
 import { toast } from '@/hooks/use-toast';
 
 export interface EmailReportDialogProps {
   isOpen: boolean;
   onClose: () => void;
   html: string;
   reportType: 'inspection' | 'training' | 'daily_assessment';
   title: string;
   organization?: string;
   date?: string;
 }
 
 export function EmailReportDialog({
   isOpen,
   onClose,
   html,
   reportType,
   title,
   organization,
   date,
 }: EmailReportDialogProps) {
   const [recipientEmail, setRecipientEmail] = useState('');
   const [recipientName, setRecipientName] = useState('');
   const [message, setMessage] = useState('');
   const [isSending, setIsSending] = useState(false);
 
   // Basic email validation
   const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
 
   const handleSend = async () => {
     if (!recipientEmail.trim()) {
       toast({
         title: 'Email required',
         description: 'Please enter a recipient email address.',
         variant: 'destructive',
       });
       return;
     }
 
     if (!isValidEmail(recipientEmail.trim())) {
       toast({
         title: 'Invalid email',
         description: 'Please enter a valid email address.',
         variant: 'destructive',
       });
       return;
     }
 
     setIsSending(true);
 
     try {
       const { data, error } = await supabase.functions.invoke('send-report-email', {
         body: {
           html,
           recipientEmail: recipientEmail.trim(),
           recipientName: recipientName.trim() || undefined,
           message: message.trim() || undefined,
           reportType,
           title,
           organization,
           date,
         },
       });
 
       if (error) throw error;
 
       if (!data?.success) {
         // Handle rate limit
         if (data?.error?.includes('Rate limit')) {
           toast({
             title: 'Rate limit exceeded',
             description: `Please wait before sending another email. ${data.retryAfter ? `Try again in ${Math.ceil(data.retryAfter / 60)} minutes.` : ''}`,
             variant: 'destructive',
           });
           return;
         }
         throw new Error(data?.error || 'Failed to send email');
       }
 
       toast({
         title: 'Email sent!',
         description: `Report sent to ${recipientEmail}`,
       });
 
       // Reset form and close
       setRecipientEmail('');
       setRecipientName('');
       setMessage('');
       onClose();
     } catch (error: any) {
       console.error('[EmailReportDialog] Error sending email:', error);
       toast({
         title: 'Failed to send email',
         description: error.message || 'An error occurred while sending the email.',
         variant: 'destructive',
       });
     } finally {
       setIsSending(false);
     }
   };
 
   const handleClose = () => {
     if (!isSending) {
       onClose();
     }
   };
 
   return (
     <Dialog open={isOpen} onOpenChange={handleClose}>
       <DialogContent className="sm:max-w-md">
         <DialogHeader>
           <DialogTitle className="flex items-center gap-2">
             <Mail className="h-5 w-5" />
             Email Report
           </DialogTitle>
           <DialogDescription>
             Send this report directly to someone's email inbox.
           </DialogDescription>
         </DialogHeader>
 
         <div className="space-y-4 py-4">
           <div className="space-y-2">
             <Label htmlFor="recipientEmail">
               Recipient Email <span className="text-destructive">*</span>
             </Label>
             <Input
               id="recipientEmail"
               type="email"
               placeholder="recipient@example.com"
               value={recipientEmail}
               onChange={(e) => setRecipientEmail(e.target.value)}
               disabled={isSending}
               autoComplete="email"
             />
           </div>
 
           <div className="space-y-2">
             <Label htmlFor="recipientName">Recipient Name (optional)</Label>
             <Input
               id="recipientName"
               type="text"
               placeholder="John Smith"
               value={recipientName}
               onChange={(e) => setRecipientName(e.target.value)}
               disabled={isSending}
               autoComplete="name"
             />
           </div>
 
           <div className="space-y-2">
             <Label htmlFor="message">Personal Message (optional)</Label>
             <Textarea
               id="message"
               placeholder="Add a personal note to include with the report..."
               value={message}
               onChange={(e) => setMessage(e.target.value)}
               disabled={isSending}
               rows={3}
             />
           </div>
         </div>
 
         <DialogFooter className="flex gap-2 sm:gap-0">
           <Button variant="outline" onClick={handleClose} disabled={isSending}>
             Cancel
           </Button>
           <Button onClick={handleSend} disabled={isSending || !recipientEmail.trim()}>
             {isSending ? (
               <>
                 <Loader2 className="h-4 w-4 animate-spin" />
                 Sending...
               </>
             ) : (
               <>
                 <Send className="h-4 w-4" />
                 Send Email
               </>
             )}
           </Button>
         </DialogFooter>
       </DialogContent>
     </Dialog>
   );
 }