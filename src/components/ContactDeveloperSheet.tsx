import { useState } from "react";
import { Send, X, Upload, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { usePWA } from "@/hooks/usePWA";

interface ContactForm {
  subject: string;
  message: string;
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
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.subject || !form.message) {
      return;
    }

    if (form.message.length > 1000) {
      return;
    }

    if (!isOnline) {
      return;
    }

    setLoading(true);

    try {
      let imageUrl: string | undefined;

      // Upload image if selected
      if (imageFile) {
        const fileName = `${Date.now()}_${imageFile.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("contact-attachments")
          .upload(fileName, imageFile, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // Get signed URL (expires in 7 days - enough time for support to review)
        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from("contact-attachments")
          .createSignedUrl(uploadData.path, 60 * 60 * 24 * 7);

        if (signedUrlError) throw signedUrlError;
        imageUrl = signedUrlData.signedUrl;
      }

      const { error } = await supabase.functions.invoke("send-contact-email", {
        body: {
          name: "Kale Dabling",
          email: "kale@myaisummit.dev",
          subject: form.subject,
          message: form.message,
          imageUrl,
        },
      });

      if (error) throw error;

      setForm({ subject: "", message: "" });
      clearImage();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending message:", error);
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
            <Label htmlFor="image">Attach Image (Optional)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => document.getElementById("image")?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                {imageFile ? imageFile.name : "Choose Image"}
              </Button>
              <Input
                id="image"
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
              {imageFile && (
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="icon"
                  onClick={clearImage}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {imagePreview && (
              <div className="relative mt-2 rounded border bg-muted p-2">
                <ImageIcon className="h-4 w-4 absolute top-3 left-3 text-muted-foreground" />
                <img 
                  src={imagePreview} 
                  alt="Preview" 
                  className="w-full h-auto max-h-48 object-contain rounded"
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Max file size: 5MB. Formats: JPG, PNG, GIF, WebP
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
