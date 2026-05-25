import { useState } from "react";
import { Send, X, Upload, File as FileIcon, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { usePWA } from "@/hooks/usePWA";
import { toast } from "@/components/ui/sonner";

interface ContactForm {
  subject: string;
  message: string;
  website: string; // Honeypot field - should always be empty
}

interface ContactDeveloperSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactDeveloperSheet({ open, onOpenChange }: ContactDeveloperSheetProps) {
  const { isOnline } = usePWA();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ContactForm>({
    subject: "",
    message: "",
    website: "", // Honeypot field
  });
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (10MB max for all file types)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 10MB.");
      return;
    }

    setAttachedFile(file);
    
    // Only create preview for images
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  };

  const clearFile = () => {
    setAttachedFile(null);
    setFilePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.subject || !form.message) {
      toast.error("Please fill in all required fields.");
      return;
    }

    if (form.message.length > 1000) {
      toast.error("Message is too long. Maximum 1000 characters.");
      return;
    }

    if (!isOnline) {
      toast.error("You're offline. Connect to the internet to send your message.");
      return;
    }

    setLoading(true);

    try {
      let attachmentUrl: string | undefined;
      let attachmentName: string | undefined;
      let attachmentType: string | undefined;

      // Upload file if selected
      if (attachedFile) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("You must be signed in to attach files.");
        const fileName = `${user.id}/${Date.now()}_${attachedFile.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("contact-attachments")
          .upload(fileName, attachedFile, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // Get signed URL (expires in 7 days - enough time for support to review)
        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from("contact-attachments")
          .createSignedUrl(uploadData.path, 60 * 60 * 24 * 7);

        if (signedUrlError) throw signedUrlError;
        attachmentUrl = signedUrlData.signedUrl;
        attachmentName = attachedFile.name;
        attachmentType = attachedFile.type;
      }

      const { error } = await supabase.functions.invoke("send-contact-email", {
        body: {
          name: "Kale Dabling",
          email: "kale@myaisummit.dev",
          subject: form.subject,
          message: form.message,
          attachmentUrl,
          attachmentName,
          attachmentType,
          website: form.website, // Honeypot field
        },
      });

      if (error) throw error;

      toast.success("Message sent successfully!");
      setForm({ subject: "", message: "", website: "" });
      clearFile();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Contact Developer</SheetTitle>
          <SheetDescription>
            Send a message to the developer. We'll get back to you as soon as possible.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label htmlFor="name">Developer Name</Label>
            <Input
              id="name"
              value="Kale Dabling"
              disabled
              className="bg-muted cursor-not-allowed"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Developer Email</Label>
            <Input
              id="email"
              type="email"
              value="kale@myaisummit.dev"
              disabled
              className="bg-muted cursor-not-allowed"
            />
          </div>
          {/* Honeypot field - hidden from real users, bots will fill it */}
          <div className="absolute -left-[9999px]" aria-hidden="true">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              name="website"
              type="text"
              value={form.website}
              onChange={(e) => setForm(prev => ({ ...prev, website: e.target.value }))}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Select
              value={form.subject}
              onValueChange={(value) => setForm(prev => ({ ...prev, subject: value }))}
              required
            >
              <SelectTrigger id="subject">
                <SelectValue placeholder="Select a subject" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bug">Bug Report</SelectItem>
                <SelectItem value="feature">Feature Request</SelectItem>
                <SelectItem value="question">Question</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={form.message}
              onChange={(e) => setForm(prev => ({ ...prev, message: e.target.value }))}
              placeholder="Describe your issue or question..."
              className="min-h-[150px] resize-none"
              maxLength={1000}
              required
            />
            <p className="text-xs text-muted-foreground text-right">
              {form.message.length}/1000 characters
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="attachment">Attach File (Optional)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => document.getElementById("attachment")?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                {attachedFile ? attachedFile.name : "Choose File"}
              </Button>
              <Input
                id="attachment"
                type="file"
                onChange={handleFileSelect}
                className="hidden"
              />
              {attachedFile && (
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="icon"
                  onClick={clearFile}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {attachedFile && (
              <div className="relative mt-2 rounded border bg-muted p-2">
                {filePreview ? (
                  <>
                    <ImageIcon className="h-4 w-4 absolute top-3 left-3 text-muted-foreground" />
                    <img 
                      src={filePreview} 
                      alt="Preview" 
                      className="w-full h-auto max-h-48 object-contain rounded"
                    />
                  </>
                ) : (
                  <div className="flex items-center gap-2 py-2">
                    <FileIcon className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground truncate">{attachedFile.name}</span>
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Max file size: 10MB. All file types accepted (PDF, images, documents, etc.)
            </p>
          </div>
          {!isOnline && (
            <p className="text-sm text-orange-500">
              You're offline. Connect to the internet to send your message.
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={loading || !isOnline}
          >
            {loading ? (
              <>Sending...</>
            ) : (
              <>
                Send Message <Send className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
